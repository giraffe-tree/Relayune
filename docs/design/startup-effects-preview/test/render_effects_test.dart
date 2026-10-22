import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_startup_studies/startup_effect.dart';
import 'package:relayune_startup_studies/startup_morph.dart';

// Contact sheet from the production native painters, not an app playback asset.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'six native effects retain their silhouettes and have distinct midframes',
    () async {
      final data = await StartupMorphData.load();
      final positions = Float32List(data.count * 2);
      const progress = [0.0, .12, .3, .5, .7, .88, 1.0];
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder);
      canvas.drawColor(const Color(0xFF0B1220), BlendMode.src);
      final endpoints = <int, Uint8List>{};
      final midframes = <Uint8List>[];
      for (final effect in StartupEffect.values) {
        for (var frame = 0; frame < progress.length; frame++) {
          final p = progress[frame];
          final cellRecorder = ui.PictureRecorder();
          final cell = Canvas(cellRecorder);
          StartupMorphPainter(
            data: data,
            effect: effect,
            entrance: AlwaysStoppedAnimation(.16 + .78 * p),
            idle: const AlwaysStoppedAnimation(0),
            positionsBuffer: positions,
          ).paint(cell, const Size(400, 240));
          final picture = cellRecorder.endRecording();
          final image = await picture.toImage(400, 240);
          final rgba = (await image.toByteData())!.buffer.asUint8List();
          final ink = [
            for (var i = 3; i < rgba.length; i += 4) rgba[i],
          ].fold<int>(0, (a, b) => a + b);
          expect(
            ink,
            greaterThan(50000),
            reason: '${effect.name} vanished at $p',
          );
          if (frame == 0 || frame == 6) {
            if (endpoints.containsKey(frame)) {
              expect(
                rgba,
                orderedEquals(endpoints[frame]!),
                reason: '${effect.name} endpoint changed',
              );
            } else {
              endpoints[frame] = Uint8List.fromList(rgba);
            }
          }
          if (frame == 3) midframes.add(Uint8List.fromList(rgba));
          canvas.drawImage(
            image,
            Offset(frame * 400.0, effect.index * 270.0 + 30),
            Paint(),
          );
          image.dispose();
          picture.dispose();
        }
        final label = TextPainter(
          text: TextSpan(
            text: '${effect.index + 1}. ${effect.en}',
            style: const TextStyle(color: Colors.white, fontSize: 18),
          ),
          textDirection: TextDirection.ltr,
        )..layout();
        label.paint(canvas, Offset(20, effect.index * 270.0 + 12));
      }
      for (var a = 0; a < midframes.length; a++) {
        for (var b = a + 1; b < midframes.length; b++) {
          var difference = 0;
          for (var i = 3; i < midframes[a].length; i += 4) {
            difference += (midframes[a][i] - midframes[b][i]).abs();
          }
          expect(
            difference,
            greaterThan(50000),
            reason: 'Effects $a and $b must visibly differ',
          );
        }
      }
      final picture = recorder.endRecording();
      final image = await picture.toImage(2800, 1620);
      final png = await image.toByteData(format: ui.ImageByteFormat.png);
      await File(
        '/tmp/relayune-six-native-effects.png',
      ).writeAsBytes(png!.buffer.asUint8List());
      image.dispose();
      picture.dispose();
    },
  );
}
