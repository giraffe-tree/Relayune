// Run with: node mobile/tool/flutter.mjs test tool/startup_morph_benchmark.dart
// Measures Dart/UI display-list recording only, not device GPU or frame rate.
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/widgets/startup_morph.dart';

// The approved fixture retains the original animation computation.
// ignore: avoid_relative_lib_imports
import '../../docs/design/startup-effects-preview/lib/eclipse_formation.dart';
// ignore: avoid_relative_lib_imports
import '../../docs/design/startup-effects-preview/lib/startup_morph.dart'
    as approved;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('startup morph UI recording comparison', () async {
    final data = await StartupMorphData.load();
    final reference = await approved.StartupMorphData.load();
    void paint(CustomPainter painter) {
      final recorder = ui.PictureRecorder();
      painter.paint(Canvas(recorder), const Size(400, 240));
      recorder.endRecording().dispose();
    }

    double measure(CustomPainter painter) {
      final clock = Stopwatch()..start();
      for (var i = 0; i < 300; i++) {
        paint(painter);
      }
      return clock.elapsedMicroseconds / 300;
    }

    for (final progress in [.04, .30, .72, 1.0]) {
      final entrance = AlwaysStoppedAnimation(.16 + .78 * progress);
      const idle = AlwaysStoppedAnimation(.5);
      final actual = StartupMorphPainter(
        data: data,
        entrance: entrance,
        idle: idle,
        positionsBuffer: Float32List(data.count * 2),
      );
      final old = approved.StartupMorphPainter(
        data: reference,
        formation: EclipseFormation.drops,
        entrance: entrance,
        idle: idle,
        positionsBuffer: Float32List(reference.count * 2),
      );
      for (var i = 0; i < 100; i++) {
        paint(actual);
        paint(old);
      }
      final before = <double>[];
      final after = <double>[];
      for (var round = 0; round < 5; round++) {
        // Alternate order to reduce warm-up / GC bias.
        if (round.isEven) {
          before.add(measure(old));
          after.add(measure(actual));
        } else {
          after.add(measure(actual));
          before.add(measure(old));
        }
      }
      before.sort();
      after.sort();
      // Fixed metadata and timing values only; no account / conversation data.
      // ignore: avoid_print
      print(
        jsonEncode({
          'progress': progress,
          'before_ui_us': before[2],
          'after_ui_us': after[2],
          'ratio': after[2] / before[2],
        }),
      );
    }
  });
}
