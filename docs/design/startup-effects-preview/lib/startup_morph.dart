import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'startup_effect.dart';
import 'eclipse_formation.dart';

part 'startup_morph_filaments.dart';
part 'startup_morph_surfaces.dart';
part 'eclipse_formation_ribbons.dart';
part 'eclipse_formation_fluid.dart';
part 'eclipse_formation_soft.dart';

/// Bundled endpoint samples, spatially paired ahead of time. Both the wordmark
/// and the moon are painted by these same particles throughout the entrance.
class StartupMorphData {
  StartupMorphData._(this.pairs, this.wordmark, this.moon) {
    flow = Float32List(count * 2);
    for (var i = 0; i < count; i++) {
      final x = pairs[i * 4] - 200;
      final y = pairs[i * 4 + 1] - 120;
      final variation = math.sin(i * 2.399963);
      flow[i * 2] = x * .16 + variation * 7;
      flow[i * 2 + 1] =
          math.sin(x / 58) * 26 + y * .35 + math.cos(i * 2.399963) * 9;
    }
  }

  final Float32List pairs;
  final ui.Image wordmark;
  final ui.Image moon;
  late final Float32List flow;
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
    final images = await Future.wait([
      _image('morph-wordmark.png'),
      _image('morph-moon.png'),
    ]);
    return StartupMorphData._(pairs, images[0], images[1]);
  }

  /// One smooth, reversible trajectory per particle, with zero velocity at
  /// both ends. No per-frame randomness, correspondence changes or logo swap.
  void positions(double progress, Float32List output) {
    final p = progress.clamp(0.0, 1.0);
    final t = p * p * p * (p * (p * 6 - 15) + 10);
    final spread = math.pow(math.sin(math.pi * t), 2).toDouble();
    for (var i = 0; i < count; i++) {
      final from = i * 4;
      final to = i * 2;
      output[to] =
          pairs[from] * (1 - t) + pairs[from + 2] * t + flow[to] * spread;
      output[to + 1] =
          pairs[from + 1] * (1 - t) +
          pairs[from + 3] * t +
          flow[to + 1] * spread;
    }
  }
}

class StartupMorphPainter extends CustomPainter {
  StartupMorphPainter({
    required this.data,
    this.effect = StartupEffect.stardust,
    this.formation,
    required this.entrance,
    required this.idle,
    required this.positionsBuffer,
  }) : super(repaint: Listenable.merge([entrance, idle]));

  final StartupMorphData data;
  final StartupEffect effect;
  final EclipseFormation? formation;
  final Animation<double> entrance;
  final Animation<double> idle;
  final Float32List positionsBuffer;

  double get progress => ((entrance.value - .16) / .78).clamp(0.0, 1.0);

  static double _smooth(double value) {
    final t = value.clamp(0.0, 1.0);
    return t * t * (3 - 2 * t);
  }

  @override
  void paint(Canvas canvas, Size size) {
    final p = progress;
    final breathing = p == 1 ? math.pow(math.sin(math.pi * idle.value), 2) : 0;
    final stableMoon = formation != null;
    final scale = math.min(size.width / 400, size.height / 240);
    canvas.save();
    canvas.translate(size.width / 2, size.height / 2);
    canvas.scale(scale * (stableMoon ? 1 : 1 + .012 * breathing));
    canvas.translate(-200, -120);
    const bounds = Rect.fromLTWH(0, 0, 400, 240);
    final dimMoon = stableMoon && breathing > 0;
    if (dimMoon) {
      canvas.saveLayer(
        bounds,
        Paint()..color = Colors.white.withValues(alpha: 1 - .06 * breathing),
      );
    }
    if (p == 1 && stableMoon) {
      // Keep the same SVG geometry after the cut; do not swap to a raster
      // endpoint with slightly different tip coverage on the last frame.
      _paintEclipse(canvas, data, p, positionsBuffer, stableEnding: true);
    } else if (p == 0 || p == 1) {
      final image = p == 0 ? data.wordmark : data.moon;
      canvas.drawImageRect(
        image,
        Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()),
        bounds,
        Paint()..filterQuality = FilterQuality.medium,
      );
    } else if (formation != null) {
      // Keep the accepted cutting trajectory, but fix its radius and width
      // through the ending so the moon's tips cannot extend and retract.
      if (p >= .53 - 1e-12) {
        _paintEclipse(canvas, data, p, positionsBuffer, stableEnding: true);
      } else {
        final q = p / .53;
        switch (formation!) {
          case EclipseFormation.roll:
            _paintFormationRoll(canvas, data, q, positionsBuffer);
          case EclipseFormation.ring:
            _paintFormationRing(canvas, data, q, positionsBuffer);
          case EclipseFormation.ribbon:
            _paintFormationRibbon(canvas, data, q, positionsBuffer);
          case EclipseFormation.drops:
            _paintFormationDrops(canvas, data, q, positionsBuffer);
          case EclipseFormation.tide:
            _paintFormationTide(canvas, data, q, positionsBuffer);
          case EclipseFormation.elastic:
            _paintFormationElastic(canvas, data, q, positionsBuffer);
        }
      }
    } else {
      switch (effect) {
        case StartupEffect.stardust:
          _paintStardust(canvas, p);
        case StartupEffect.orbit:
          _paintOrbit(canvas, data, p, positionsBuffer);
        case StartupEffect.liquid:
          _paintLiquid(canvas, data, p, positionsBuffer);
        case StartupEffect.filaments:
          _paintFilaments(canvas, data, p, positionsBuffer);
        case StartupEffect.raster:
          _paintRaster(canvas, data, p, positionsBuffer);
        case StartupEffect.eclipse:
          _paintEclipse(canvas, data, p, positionsBuffer);
      }
    }
    if (dimMoon) canvas.restore();
    canvas.restore();
  }

  void _paintStardust(Canvas canvas, double p) {
    const bounds = Rect.fromLTWH(0, 0, 400, 240);
    data.positions(p, positionsBuffer);
    final departure = 1 - _smooth(p / .12);
    final arrival = _smooth((p - .86) / .14);
    final mask = math.max(departure, arrival);
    if (mask > 0) canvas.saveLayer(bounds, Paint());
    // A single batched native draw keeps thousands of samples inexpensive.
    // Points overlap at the endpoints, then the original alpha silhouette
    // trims their edges. The final image never fades in over a different shape.
    canvas.drawRawPoints(
      ui.PointMode.points,
      positionsBuffer,
      Paint()
        ..color = const Color(0xFFF6F8F5).withValues(alpha: 1)
        ..strokeCap = StrokeCap.round
        ..strokeWidth = 2.8 - 1.65 * math.sin(math.pi * p),
    );
    if (mask > 0) {
      // Build one continuous alpha mask: endpoint silhouette -> unrestricted
      // particles -> endpoint silhouette, without clipping a moving point.
      canvas.saveLayer(bounds, Paint()..blendMode = BlendMode.dstIn);
      canvas.drawRect(
        bounds,
        Paint()..color = Colors.white.withValues(alpha: 1 - mask),
      );
      final image = departure > arrival ? data.wordmark : data.moon;
      canvas.drawImageRect(
        image,
        Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()),
        bounds,
        Paint()
          ..color = Colors.white.withValues(alpha: mask)
          ..filterQuality = FilterQuality.medium,
      );
      canvas.restore();
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(StartupMorphPainter oldDelegate) =>
      data != oldDelegate.data ||
      effect != oldDelegate.effect ||
      formation != oldDelegate.formation ||
      entrance != oldDelegate.entrance ||
      idle != oldDelegate.idle;
}
