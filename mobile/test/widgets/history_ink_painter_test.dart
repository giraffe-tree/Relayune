import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/widgets/history_ink_painter.dart';
import 'package:relayune_mobile/src/widgets/startup_morph.dart';

Future<Uint8List> _render(
  void Function(Canvas) paint, [
  Size size = const Size(260, 156),
]) async {
  final recorder = ui.PictureRecorder();
  paint(Canvas(recorder));
  final picture = recorder.endRecording();
  final image = await picture.toImage(size.width.toInt(), size.height.toInt());
  try {
    final bytes = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    return bytes!.buffer.asUint8List();
  } finally {
    image.dispose();
    picture.dispose();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late StartupMorphData data;
  late Float32List buffer;

  setUpAll(() async {
    data = await StartupMorphData.load();
    // Match the caller's ordering: assets, synchronous preparation, animation.
    prepareHistoryInk(data);
    buffer = Float32List(data.count * 2);
  });

  HistoryInkPainter painter(
    double progress, {
    bool compact = false,
    double idle = 0,
  }) => HistoryInkPainter(
    data: data,
    entrance: AlwaysStoppedAnimation(.16 + .78 * progress),
    idle: AlwaysStoppedAnimation(idle),
    positionsBuffer: buffer,
    compact: compact,
  );

  Future<Uint8List> frame(double progress) => _render(
    (canvas) => painter(progress).paint(canvas, const Size(260, 156)),
  );

  test('entrance retains the exact bundled wordmark', () async {
    final image = data.wordmark;
    final expected = await _render((canvas) {
      canvas.translate(130, 78);
      canvas.scale(.65);
      canvas.translate(-200, -120);
      canvas.drawImageRect(
        image,
        Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()),
        const Rect.fromLTWH(0, 0, 400, 240),
        Paint()..filterQuality = FilterQuality.medium,
      );
    });
    expect(await frame(0), orderedEquals(expected));
    expect(painter(-1).progress, 0);
    expect(painter(2).progress, 1);
  });

  test('completed SVG cut stays identical through the final frame', () async {
    final expected = await frame(.93);
    for (final p in [.94, .96, .98, .999999, 1.0]) {
      expect(await frame(p), orderedEquals(expected), reason: 'p=$p');
    }
  });

  test('full and compact moon breathe with only six percent opacity', () async {
    for (final compact in [false, true]) {
      final size = compact ? const Size(38, 38) : const Size(260, 156);
      Future<Uint8List> at(double idle) => _render(
        (canvas) =>
            painter(1, compact: compact, idle: idle).paint(canvas, size),
        size,
      );
      final rest = await at(0);
      final dim = await at(.5);
      var ink = 0;
      for (var i = 3; i < rest.length; i += 4) {
        ink += rest[i];
        // Uniform attenuation preserves tip geometry, including antialias
        // coverage. Allow byte rounding when the layer opacity is quantized.
        expect(
          (dim[i] - rest[i] * .94).abs(),
          lessThanOrEqualTo(1.5),
          reason: 'compact=$compact pixel=${i ~/ 4}',
        );
      }
      expect(ink, greaterThan(0));
      expect(dim, isNot(orderedEquals(rest)));
      expect(await at(1), orderedEquals(rest));
    }
  });

  test(
    'boundary transitions stay within approved ink coverage budgets',
    () async {
      // First-act budgets measured against approved 650680c; 67ec278 keeps
      // those transitions and replaces only the ending with stable SVG geometry.
      // p=0 switches image sampling to the transported endpoint mesh (~13.1%).
      // p=.53 enters Eclipse with its cut already underway (~2.42%). Preserve
      // those approved transitions rather than asserting idealized continuity.
      for (final entry in [(0.0, .14), (.53, .03), (.86, .002), (1.0, .003)]) {
        final boundary = entry.$1;
        final before = await frame((boundary - .000001).clamp(0.0, 1.0));
        final after = await frame((boundary + .000001).clamp(0.0, 1.0));
        var alphaDifference = 0;
        var ink = 0;
        for (var i = 3; i < before.length; i += 4) {
          alphaDifference += (after[i] - before[i]).abs();
          ink += before[i];
        }
        expect(ink, greaterThan(0));
        // Measure against the visible ink, not the mostly transparent canvas.
        expect(
          alphaDifference / ink,
          lessThan(entry.$2),
          reason: 'p=$boundary',
        );
      }
    },
  );

  test('preparation and interleaved painters do not change replay', () async {
    for (final p in [.01, .08, .3, .52, .7, .93]) {
      final expected = await frame(p);
      await frame(.99);
      await frame(.02);
      prepareHistoryInk(data);
      expect(await frame(p), orderedEquals(expected), reason: 'p=$p');
    }
  });

  test('compact starts at moon and only breathes within its square', () async {
    const size = Size(38, 38);
    Future<Uint8List> compact(double p, double idle) => _render(
      (canvas) => painter(p, compact: true, idle: idle).paint(canvas, size),
      size,
    );
    expect(painter(0, compact: true).progress, 1);
    final start = await compact(0, 0);
    expect(await compact(1, 0), orderedEquals(start));
    expect(await compact(0, 1), orderedEquals(start));
    expect(await compact(0, .5), isNot(orderedEquals(start)));
    var left = 38, top = 38, right = 0, bottom = 0;
    for (var y = 0; y < 38; y++) {
      for (var x = 0; x < 38; x++) {
        if (start[(y * 38 + x) * 4 + 3] <= 127) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    // The S-cut artwork is slightly narrower than its nominal lunar disc.
    expect(right - left + 1, inInclusiveRange(24, 26));
    expect(bottom - top + 1, inInclusiveRange(25, 27));
    expect(left, greaterThan(0));
    expect(top, greaterThan(0));
    expect(right, lessThan(37));
    expect(bottom, lessThan(37));
  });
}
