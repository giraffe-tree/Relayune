import 'dart:io';
import 'dart:convert';

import 'package:relayune_mobile/src/ui/visualization_document.dart';

// Developer-only renderer for testing the exact document used by the WebView.
void main(List<String> args) {
  if (args.length != 2) {
    throw ArgumentError('Expected source and output paths.');
  }
  final assets = File.fromUri(
    Platform.script,
  ).parent.parent.uri.resolve('assets/visualization/');
  File(args[1]).writeAsStringSync(
    buildVisualizationPreviewDocument(
      File(args[0]).readAsStringSync(),
      stylesheet: File.fromUri(assets.resolve('base.css')).readAsStringSync(),
      iconScript: File.fromUri(
        assets.resolve('lucide.min.js'),
      ).readAsStringSync(),
      cjkFontBase64: base64Encode(
        File.fromUri(assets.resolve('noto-cjk.woff2')).readAsBytesSync(),
      ),
    ),
  );
}
