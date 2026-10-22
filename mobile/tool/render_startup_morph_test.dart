import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/widgets/startup_morph.dart';

// Visual QA uses the exact native painter shipped in the app, including its
// connected ink drops and stable SVG endpoint. Run: flutter test tool/render_startup_morph_test.dart
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('render native startup motion frames', () async {
    final data = await StartupMorphData.load();
    const output = String.fromEnvironment(
      'MORPH_OUTPUT_DIR',
      defaultValue: '/tmp/relayune-native-morph',
    );
    final directory = Directory(output)..createSync(recursive: true);
    final positions = Float32List(data.count * 2);
    for (var frame = 0; frame < 150; frame++) {
      final seconds = frame / 30;
      final entrance = (seconds / 3.2).clamp(0.0, 1.0);
      final idle = seconds > 3.2 ? (seconds - 3.2) / 1.8 : 0.0;
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder);
      canvas.drawColor(const Color(0xFF0B1220), BlendMode.src);
      canvas.translate(0, 302);
      StartupMorphPainter(
        data: data,
        entrance: AlwaysStoppedAnimation(entrance),
        idle: AlwaysStoppedAnimation(idle),
        positionsBuffer: positions,
      ).paint(canvas, const Size(390, 240));
      final picture = recorder.endRecording();
      final image = await picture.toImage(390, 844);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      await File(
        '${directory.path}/${frame.toString().padLeft(3, '0')}.png',
      ).writeAsBytes(bytes!.buffer.asUint8List());
      image.dispose();
      picture.dispose();
    }
  });
}
