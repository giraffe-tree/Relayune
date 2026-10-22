import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart' show compute;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

part 'startup_morph_drops.dart';
part 'startup_morph_surfaces.dart';
part 'startup_morph_endpoint.dart';

// Promoted from the approved ink-drops study. Endpoint samples describe the
// word's glyph geometry; the animation is painted with connected vector paths.
class StartupMorphData {
  StartupMorphData._(this.pairs, this.wordmark, this.moon);

  final Float32List pairs;
  final ui.Image wordmark;
  final ui.Image moon;
  late final ui.Picture _disc;
  late final ui.Picture _settled;
  int get count => pairs.length ~/ 4;
  static Future<StartupMorphData>? _cached;

  static Future<StartupMorphData> load() => _cached ??= _load();

  static Future<ui.Image> _image(String name) async {
    final bytes = await rootBundle.load('assets/opening/$name');
    final codec = await ui.instantiateImageCodec(bytes.buffer.asUint8List());
    try {
      return (await codec.getNextFrame()).image;
    } finally {
      codec.dispose();
    }
  }

  static Future<StartupMorphData> _load() async {
    final bytes = await rootBundle.load('assets/opening/wordmark-morph.bin');
    final (geometry, images) = await (
      compute(
        _prepareStartupMorph,
        bytes,
        debugLabel: 'startup-morph-geometry',
      ),
      Future.wait([_image('morph-wordmark.png'), _image('morph-moon.png')]),
    ).wait;
    final data = StartupMorphData._(geometry.$1, images[0], images[1]);
    geometry.$2.wordMesh = _OfEndpointMesh(data, geometry.$4);
    _effCaches[data] = geometry.$2;
    // dart:ui resources stay on the UI isolate. Record the fixed disc and
    // complete logo once; motion / idle never rebuild their 733 surface patches.
    final disc = ui.PictureRecorder();
    _surfacesDisc(Canvas(disc), geometry.$3.disc, 1, 0, 0, 0);
    data._disc = disc.endRecording();
    final settled = ui.PictureRecorder();
    _paintEclipse(Canvas(settled), data, 1);
    data._settled = settled.endRecording();
    return data;
  }
}

// Only Dart values cross the isolate boundary: no images, paths, shaders,
// controllers or rootBundle access in this worker.
(Float32List, _EffCache, _SurfacesMapping, _OfEndpointTopology)
_prepareStartupMorph(ByteData bytes) {
  if (bytes.lengthInBytes < 8 || bytes.getUint32(0) != 0x52594d31) {
    throw const FormatException('Invalid startup morph asset');
  }
  final count = bytes.getUint32(4, Endian.little);
  if (count == 0 || count > 20000 || bytes.lengthInBytes != 8 + count * 16) {
    throw const FormatException('Invalid startup morph sample count');
  }
  final pairs = Float32List(count * 4);
  for (var i = 0; i < pairs.length; i++) {
    final value = bytes.getFloat32(8 + i * 4, Endian.little);
    if (!value.isFinite || value < 0 || value > (i.isEven ? 400 : 240)) {
      throw const FormatException('Invalid startup morph position');
    }
    pairs[i] = value;
  }
  return (
    pairs,
    _EffCache(pairs),
    _SurfacesMapping(pairs),
    _OfEndpointTopology(pairs),
  );
}

class StartupMorphPainter extends CustomPainter {
  StartupMorphPainter({
    required this.data,
    required this.entrance,
    required this.idle,
    required this.positionsBuffer,
  }) : super(repaint: Listenable.merge([entrance, idle]));

  final StartupMorphData data;
  final Animation<double> entrance;
  final Animation<double> idle;
  final Float32List positionsBuffer;

  double get progress => ((entrance.value - .16) / .78).clamp(0.0, 1.0);

  @override
  void paint(Canvas canvas, Size size) {
    final p = progress;
    final breathing = p == 1 ? math.pow(math.sin(math.pi * idle.value), 2) : 0;
    final scale = math.min(size.width / 400, size.height / 240);
    canvas.save();
    canvas.translate(size.width / 2, size.height / 2);
    canvas.scale(scale);
    canvas.translate(-200, -120);
    const bounds = Rect.fromLTWH(0, 0, 400, 240);
    if (breathing > 0) {
      canvas.saveLayer(
        bounds,
        Paint()..color = Colors.white.withValues(alpha: 1 - .06 * breathing),
      );
    }
    if (p == 0) {
      canvas.drawImageRect(
        data.wordmark,
        Rect.fromLTWH(
          0,
          0,
          data.wordmark.width.toDouble(),
          data.wordmark.height.toDouble(),
        ),
        bounds,
        Paint()..filterQuality = FilterQuality.medium,
      );
    } else if (p == 1) {
      canvas.drawPicture(data._settled);
    } else if (p >= .53 - 1e-12) {
      // Use the same SVG geometry all the way into idle: no endpoint swap,
      // radius compensation, channel narrowing, or scale-based breathing.
      _paintEclipse(canvas, data, p);
    } else {
      _paintFormationDrops(canvas, data, p / .53, positionsBuffer);
    }
    if (breathing > 0) canvas.restore();
    canvas.restore();
  }

  @override
  bool shouldRepaint(StartupMorphPainter oldDelegate) =>
      data != oldDelegate.data ||
      entrance != oldDelegate.entrance ||
      idle != oldDelegate.idle;
}
