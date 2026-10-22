import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_startup_studies/eclipse_formation.dart';
import 'package:relayune_startup_studies/startup_effect.dart';
import 'package:relayune_startup_studies/startup_morph.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late StartupMorphData data;
  setUpAll(() async => data = await StartupMorphData.load());

  Future<ui.Image> render(
    double p,
    EclipseFormation? formation, {
    double idle = 0,
  }) async {
    final recorder = ui.PictureRecorder();
    StartupMorphPainter(
      data: data,
      effect: StartupEffect.eclipse,
      formation: formation,
      entrance: AlwaysStoppedAnimation(.16 + .78 * p),
      idle: AlwaysStoppedAnimation(idle),
      positionsBuffer: Float32List(data.count * 2),
    ).paint(Canvas(recorder), const Size(400, 240));
    final picture = recorder.endRecording();
    final image = await picture.toImage(400, 240);
    picture.dispose();
    return image;
  }

  Future<Uint8List> pixels(double p, EclipseFormation? formation) async {
    final image = await render(p, formation);
    final bytes = (await image.toByteData())!.buffer.asUint8List();
    image.dispose();
    return bytes;
  }

  int difference(Uint8List a, Uint8List b) {
    var difference = 0;
    for (var i = 3; i < a.length; i += 4) {
      difference += (a[i] - b[i]).abs();
    }
    return difference;
  }

  test(
    'moon tips stay fixed from the completed cut through the final frame',
    () async {
      final settled = await pixels(1, EclipseFormation.drops);
      for (final formation in EclipseFormation.values) {
        for (final p in [.92, .94, .96, .98, .9999, 1.0]) {
          expect(
            difference(await pixels(p, formation), settled),
            0,
            reason: '${formation.name}: silhouette moves after the cut at $p',
          );
        }
      }
    },
  );

  test(
    'loading breath changes opacity without moving the silhouette',
    () async {
      final base = await pixels(1, EclipseFormation.drops);
      final image = await render(1, EclipseFormation.drops, idle: .5);
      final breathing = (await image.toByteData())!.buffer.asUint8List();
      image.dispose();
      var maxError = 0.0;
      for (var i = 3; i < base.length; i += 4) {
        final error = (breathing[i] - base[i] * .94).abs();
        if (error > maxError) maxError = error;
      }
      expect(
        maxError,
        lessThanOrEqualTo(2),
        reason: 'Breathing must only dim the same pixels, with no scale',
      );
    },
  );

  test(
    'accepted water trajectory is unchanged before the old endpoint guard',
    () async {
      for (final p in [.53, .57, .64, .72, .85, .86]) {
        final original = await pixels(p, null);
        for (final formation in EclipseFormation.values) {
          expect(
            await pixels(p, formation),
            orderedEquals(original),
            reason: '${formation.name} changed the accepted ending at $p',
          );
        }
      }
    },
  );

  test(
    'settled vector matches the canonical icon within edge antialiasing',
    () async {
      final reference = await pixels(1, null);
      final actual = await pixels(1, EclipseFormation.drops);
      // Compare occupied pixels in both directions. A 1px neighborhood allows
      // the bundled 2x raster's resampling, not a shifted silhouette or tip.
      for (final pair in [(actual, reference), (reference, actual)]) {
        var displaced = 0;
        for (var y = 1; y < 239; y++) {
          for (var x = 1; x < 399; x++) {
            if (pair.$1[(y * 400 + x) * 4 + 3] < 128) continue;
            var neighbor = false;
            for (var dy = -1; dy <= 1; dy++) {
              for (var dx = -1; dx <= 1; dx++) {
                if (pair.$2[((y + dy) * 400 + x + dx) * 4 + 3] >= 128)
                  neighbor = true;
              }
            }
            if (!neighbor) displaced++;
          }
        }
        expect(
          displaced,
          0,
          reason: 'Vector silhouette differs from the app icon',
        );
      }
      expect(difference(actual, reference) / (255 * 120 * 120), lessThan(.01));
    },
  );

  test('render enlarged ending comparison for visual review', () async {
    const moments = [.86, .9, .94, .98, 1.0];
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)
      ..drawColor(const Color(0xFF0B1220), BlendMode.src);
    for (var row = 0; row < 2; row++) {
      for (var col = 0; col < moments.length; col++) {
        canvas.save();
        canvas.translate(col * 300.0, row * 340.0 + 34);
        canvas.scale(2.5);
        canvas.translate(-140, -60);
        StartupMorphPainter(
          data: data,
          effect: StartupEffect.eclipse,
          formation: row == 0 ? null : EclipseFormation.drops,
          entrance: AlwaysStoppedAnimation(.16 + .78 * moments[col]),
          idle: const AlwaysStoppedAnimation(0),
          positionsBuffer: Float32List(data.count * 2),
        ).paint(canvas, const Size(400, 240));
        canvas.restore();
        final label = TextPainter(
          text: TextSpan(
            text: '${row == 0 ? "BEFORE" : "FIXED"}  ${moments[col]}',
            style: const TextStyle(color: Colors.white, fontSize: 18),
          ),
          textDirection: TextDirection.ltr,
        )..layout();
        label.paint(canvas, Offset(col * 300.0 + 20, row * 340.0 + 8));
      }
    }
    final picture = recorder.endRecording();
    final image = await picture.toImage(1500, 680);
    final png = await image.toByteData(format: ui.ImageByteFormat.png);
    await File(
      '/tmp/relayune-eclipse-tip-check.png',
    ).writeAsBytes(png!.buffer.asUint8List());
    image.dispose();
    picture.dispose();
  });

  test(
    'new openings have continuous endpoint joins and distinct material paths',
    () async {
      final beginning = await pixels(0, null);
      final disc = await pixels(.53, null);
      final middles = <Uint8List>[];
      for (final formation in EclipseFormation.values) {
        expect(
          difference(beginning, await pixels(.0001, formation)) /
              (255 * 400 * 240),
          lessThan(.003),
          reason: '${formation.name} jumps out of the wordmark',
        );
        expect(
          difference(disc, await pixels(.5299, formation)) / (255 * 400 * 240),
          lessThan(.003),
          reason: '${formation.name} jumps into the accepted disc',
        );
        middles.add(await pixels(.27, formation));
      }
      for (var a = 0; a < middles.length; a++) {
        for (var b = a + 1; b < middles.length; b++) {
          expect(
            difference(middles[a], middles[b]),
            greaterThan(30000),
            reason: 'Formations $a/$b should visibly differ',
          );
        }
      }
    },
  );

  test('merged ink bodies have no cancellation holes before the cut', () async {
    for (final formation in [EclipseFormation.drops, EclipseFormation.tide]) {
      final rgba = await pixels(.48, formation);
      for (var y = 96; y < 144; y++) {
        for (var x = 176; x < 224; x++) {
          expect(
            rgba[(y * 400 + x) * 4 + 3],
            greaterThan(250),
            reason: '${formation.name} has an interior gap at $x,$y',
          );
        }
      }
    }
  });

  test(
    'render seven comparison rows, original followed by six new first acts',
    () async {
      const moments = [0.0, .10, .20, .30, .40, .48, .53, .70, 1.0];
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder)
        ..drawColor(const Color(0xFF0B1220), BlendMode.src);
      final rows = <EclipseFormation?>[null, ...EclipseFormation.values];
      for (var row = 0; row < rows.length; row++) {
        for (var col = 0; col < moments.length; col++) {
          final image = await render(moments[col], rows[row]);
          canvas.drawImage(image, Offset(col * 400.0, row * 240.0), Paint());
          image.dispose();
        }
      }
      final picture = recorder.endRecording();
      final image = await picture.toImage(3600, 1680);
      final png = await image.toByteData(format: ui.ImageByteFormat.png);
      await File(
        '/tmp/relayune-eclipse-formations.png',
      ).writeAsBytes(png!.buffer.asUint8List());
      image.dispose();
      picture.dispose();
    },
  );
}
