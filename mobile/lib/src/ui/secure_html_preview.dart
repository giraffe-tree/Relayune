import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../l10n/relayune_localizations.dart';
import 'visualization_document.dart';

/// Generated content runs in an opaque-origin frame with no native bridge,
/// network, file access, popups, form submission, or parent navigation.
class SecureHtmlPreview extends StatefulWidget {
  const SecureHtmlPreview({super.key, required this.bytes});

  final Uint8List bytes;

  @override
  State<SecureHtmlPreview> createState() => _SecureHtmlPreviewState();
}

class _SecureHtmlPreviewState extends State<SecureHtmlPreview> {
  late Future<WebViewController?> _preview = _createPreview();

  @override
  void didUpdateWidget(covariant SecureHtmlPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!listEquals(oldWidget.bytes, widget.bytes)) {
      _preview = _createPreview();
    }
  }

  Future<WebViewController?> _createPreview() async {
    if (widget.bytes.length > 1024 * 1024) {
      throw const FormatException('Visualization exceeds the preview limit.');
    }
    if (WebViewPlatform.instance == null) return null;
    final source = utf8.decode(widget.bytes);
    final assets = await Future.wait([
      rootBundle.loadString('assets/visualization/base.css'),
      rootBundle.loadString('assets/visualization/lucide.min.js'),
      rootBundle
          .load('assets/visualization/noto-cjk.woff2')
          .then(
            (data) => base64Encode(
              data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
            ),
          ),
    ]);
    final controller = WebViewController(
      onPermissionRequest: (request) => unawaited(request.deny()),
    );
    await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    await controller.setBackgroundColor(const Color(0xFF111311));
    await controller.setNavigationDelegate(
      NavigationDelegate(
        onNavigationRequest: (request) =>
            isLocalVisualizationNavigation(request.url)
            ? NavigationDecision.navigate
            : NavigationDecision.prevent,
      ),
    );
    await controller.loadHtmlString(
      buildVisualizationPreviewDocument(
        source,
        stylesheet: assets[0],
        iconScript: assets[1],
        cjkFontBase64: assets[2],
      ),
      baseUrl: 'about:blank',
    );
    return controller;
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<WebViewController?>(
    future: _preview,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const Center(child: CircularProgressIndicator(strokeWidth: 2));
      }
      if (snapshot.hasError || snapshot.data == null) {
        return Center(
          child: Text(context.l10n.workbenchVisualizationUnavailable),
        );
      }
      return WebViewWidget(
        key: const ValueKey('visualization-webview'),
        controller: snapshot.data!,
      );
    },
  );
}
