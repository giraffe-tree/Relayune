import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/widgets/startup_morph.dart';

// The approved standalone study is the visual contract for this promotion.
// Production has no dependency on the study or its other five alternatives.
// These imports intentionally read the external visual fixture, not app lib.
// ignore: avoid_relative_lib_imports
import '../../../docs/design/startup-effects-preview/lib/eclipse_formation.dart';
// ignore: avoid_relative_lib_imports
import '../../../docs/design/startup-effects-preview/lib/startup_morph.dart'
    as approved;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'production matches the approved ink-drops preview, including idle',
    () async {
      final data = await StartupMorphData.load();
      final reference = await approved.StartupMorphData.load();
      Future<Uint8List> pixels(CustomPainter painter) async {
        final recorder = ui.PictureRecorder();
        painter.paint(Canvas(recorder), const Size(400, 240));
        final picture = recorder.endRecording();
        final image = await picture.toImage(400, 240);
        final bytes = (await image.toByteData())!.buffer.asUint8List();
        image.dispose();
        picture.dispose();
        return bytes;
      }

      for (final p in [
        0.0,
        .0001,
        .04,
        .10,
        .20,
        .30,
        .40,
        .48,
        .5299,
        .53,
        .57,
        .64,
        .72,
        .86,
        .92,
        .98,
        .9999,
        1.0,
      ]) {
        for (final idle in p == 1 ? [0.0, .25, .5, .75, 1.0] : [0.0]) {
          final entrance = AlwaysStoppedAnimation(.16 + .78 * p);
          final breathing = AlwaysStoppedAnimation(idle);
          final actual = await pixels(
            StartupMorphPainter(
              data: data,
              entrance: entrance,
              idle: breathing,
              positionsBuffer: Float32List(data.count * 2),
            ),
          );
          final expected = await pixels(
            approved.StartupMorphPainter(
              data: reference,
              formation: EclipseFormation.drops,
              entrance: entrance,
              idle: breathing,
              positionsBuffer: Float32List(reference.count * 2),
            ),
          );
          var difference = 0;
          for (var i = 0; i < actual.length; i++) {
            difference += (actual[i] - expected[i]).abs();
          }
          expect(
            difference,
            0,
            reason: 'Approved effect changed at $p / idle $idle',
          );
        }
      }
    },
  );
}
