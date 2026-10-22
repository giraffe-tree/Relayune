import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:xml/xml.dart';

import 'theme.dart';

class SecureSvgPreview extends StatefulWidget {
  const SecureSvgPreview({
    super.key,
    required this.bytes,
    required this.disableAnimations,
  });

  final Uint8List bytes;
  final bool disableAnimations;

  @override
  State<SecureSvgPreview> createState() => _SecureSvgPreviewState();
}

class _SecureSvgPreviewState extends State<SecureSvgPreview> {
  late Future<_SvgPreviewState> _preview;

  @override
  void initState() {
    super.initState();
    _preview = _createPreview();
  }

  @override
  void didUpdateWidget(covariant SecureSvgPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.disableAnimations != widget.disableAnimations ||
        !listEquals(oldWidget.bytes, widget.bytes)) {
      _preview = _createPreview();
    }
  }

  Future<_SvgPreviewState> _createPreview() async {
    final source = utf8.decode(widget.bytes);
    if (!isSafeSvgPreviewSource(source)) {
      throw const FormatException('SVG contains active or external content.');
    }

    // Widget tests and unsupported host platforms do not register a WebView.
    // Keep the static vector renderer as a deterministic, zoomable fallback.
    if (!shouldUseAnimatedSvgWebView(
      source,
      disableAnimations: widget.disableAnimations,
      webViewAvailable: WebViewPlatform.instance != null,
    )) {
      return _SvgPreviewState(source: source);
    }

    final controller = WebViewController(
      onPermissionRequest: (request) => unawaited(request.deny()),
    );
    await controller.setJavaScriptMode(JavaScriptMode.disabled);
    await controller.setBackgroundColor(Colors.transparent);
    await controller.setNavigationDelegate(
      NavigationDelegate(
        onNavigationRequest: (request) {
          if (request.url == 'about:blank') {
            return NavigationDecision.navigate;
          }
          return NavigationDecision.prevent;
        },
      ),
    );
    await controller.loadHtmlString(
      buildSvgPreviewDocument(source),
      baseUrl: 'about:blank',
    );
    return _SvgPreviewState(source: source, controller: controller);
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<_SvgPreviewState>(
    future: _preview,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return const Center(
          child: Text(
            'SVG 无法安全显示。',
            style: TextStyle(color: RelayTheme.mutedBright),
          ),
        );
      }
      final preview = snapshot.data;
      if (preview == null) {
        return const Center(child: CircularProgressIndicator(strokeWidth: 2));
      }
      if (preview.controller == null) {
        return SvgPicture.string(
          preview.source,
          fit: BoxFit.contain,
          errorBuilder: (context, error, stackTrace) => const Center(
            child: Text(
              'SVG 无法显示。',
              style: TextStyle(color: RelayTheme.mutedBright),
            ),
          ),
        );
      }
      return IgnorePointer(
        child: WebViewWidget(
          key: const ValueKey('animated-svg-webview'),
          controller: preview.controller!,
        ),
      );
    },
  );
}

class _SvgPreviewState {
  const _SvgPreviewState({required this.source, this.controller});

  final String source;
  final WebViewController? controller;
}

bool isSafeSvgPreviewSource(String source) {
  if (RegExp(r'<!DOCTYPE|<!ENTITY', caseSensitive: false).hasMatch(source)) {
    return false;
  }
  late final XmlDocument document;
  try {
    document = XmlDocument.parse(source);
  } on XmlParserException {
    return false;
  }
  if (document.rootElement.name.local.toLowerCase() != 'svg') {
    return false;
  }
  final rootNamespace = document.rootElement.name.namespaceUri;
  if (rootNamespace != null &&
      rootNamespace.isNotEmpty &&
      rootNamespace != 'http://www.w3.org/2000/svg') {
    return false;
  }
  if (document.descendants.whereType<XmlProcessing>().isNotEmpty) {
    return false;
  }

  const blockedElements = {
    'script',
    'foreignobject',
    'iframe',
    'object',
    'embed',
    'audio',
    'video',
    'link',
    'base',
    'form',
  };
  final elements = <XmlElement>[
    document.rootElement,
    ...document.rootElement.descendants.whereType<XmlElement>(),
  ];
  for (final element in elements) {
    final elementName = element.name.local.toLowerCase();
    final namespace = element.name.namespaceUri;
    if (blockedElements.contains(elementName) ||
        (namespace != null &&
            namespace.isNotEmpty &&
            namespace != 'http://www.w3.org/2000/svg')) {
      return false;
    }
    if (elementName == 'style' && !_isSafeSvgCss(element.innerText)) {
      return false;
    }

    String? animatedAttributeName;
    for (final attribute in element.attributes) {
      final attributeName = attribute.name.local.toLowerCase();
      final prefix = attribute.name.prefix?.toLowerCase();
      if (prefix == 'xmlns' || attribute.name.qualified == 'xmlns') continue;
      if (attributeName.startsWith('on') ||
          attributeName == 'src' ||
          (prefix == 'xml' && attributeName == 'base')) {
        return false;
      }
      if (attributeName == 'href' && !attribute.value.trim().startsWith('#')) {
        return false;
      }
      if (attributeName == 'attributename') {
        animatedAttributeName = attribute.value
            .trim()
            .toLowerCase()
            .split(':')
            .last;
      }
      if (!_isSafeSvgCss(attribute.value)) return false;
    }
    if (const {'animate', 'set'}.contains(elementName) &&
        const {'href', 'src'}.contains(animatedAttributeName)) {
      return false;
    }
  }
  return true;
}

bool _isSafeSvgCss(String value) {
  final decoded = _decodeCssEscapes(value);
  if (RegExp(
    r'@import\b|(?:^|[^-])image-set\s*\(|expression\s*\(|javascript\s*:|(?:https?|file|data)\s*:',
    caseSensitive: false,
  ).hasMatch(decoded)) {
    return false;
  }
  for (final match in RegExp(
    r'''url\(\s*(["']?)(.*?)\1\s*\)''',
    caseSensitive: false,
    dotAll: true,
  ).allMatches(decoded)) {
    if (!(match.group(2) ?? '').trim().startsWith('#')) return false;
  }
  return !RegExp(r'url\s*\(', caseSensitive: false).hasMatch(
    decoded.replaceAll(
      RegExp(
        r'''url\(\s*(["']?)(.*?)\1\s*\)''',
        caseSensitive: false,
        dotAll: true,
      ),
      '',
    ),
  );
}

String _decodeCssEscapes(String value) {
  final decodedHex = value.replaceAllMapped(
    RegExp(r'\\([0-9a-fA-F]{1,6})\s?'),
    (match) {
      final codePoint = int.tryParse(match.group(1)!, radix: 16);
      return codePoint == null || codePoint == 0
          ? '\uFFFD'
          : String.fromCharCode(codePoint);
    },
  );
  return decodedHex.replaceAllMapped(
    RegExp(r'\\(.)', dotAll: true),
    (match) => match.group(1)!,
  );
}

@visibleForTesting
bool hasSvgDeclarativeAnimation(String source) =>
    RegExp(
      r'<(?:animate|animateTransform|animateMotion|set)\b',
      caseSensitive: false,
    ).hasMatch(source) ||
    RegExp(
      r'@keyframes\b|\banimation(?:-name)?\s*:',
      caseSensitive: false,
    ).hasMatch(source);

@visibleForTesting
bool shouldUseAnimatedSvgWebView(
  String source, {
  required bool disableAnimations,
  required bool webViewAvailable,
}) =>
    !disableAnimations &&
    webViewAvailable &&
    isSafeSvgPreviewSource(source) &&
    hasSvgDeclarativeAnimation(source);

@visibleForTesting
String buildSvgPreviewDocument(String source) {
  final encoded = base64Encode(utf8.encode(source));
  return '''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'">
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: transparent;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    body > img {
      display: block;
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
  </style>
</head>
<body><img alt="" src="data:image/svg+xml;base64,$encoded"></body>
</html>''';
}
