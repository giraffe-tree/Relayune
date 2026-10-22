import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:webview_flutter/webview_flutter.dart';
import 'package:xml/xml.dart';

import '../ui/secure_svg_preview.dart';

bool isMermaidBlock(String source, String? language) {
  final tag = (language ?? '').replaceFirst('language-', '').toLowerCase();
  return source.length <= 20000 &&
      (tag == 'mermaid' ||
          ((tag.isEmpty || tag == 'flowchart') &&
              RegExp(
                r'^\s*(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b',
              ).hasMatch(source)));
}

class MermaidBlockBuilder extends MarkdownElementBuilder {
  MermaidBlockBuilder({
    required this.streaming,
    this.styleSheet,
    this.selectable = true,
  });
  final MarkdownStyleSheet? styleSheet;
  final bool streaming;
  final bool selectable;

  @override
  bool isBlockElement() => true;

  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    final children = element.children;
    final code = children?.length == 1 ? children!.single : null;
    if (!streaming &&
        code is md.Element &&
        code.tag == 'code' &&
        isMermaidBlock(code.textContent, code.attributes['class'])) {
      return MermaidDiagram(source: code.textContent);
    }
    // Registering a pre builder bypasses the package's default code renderer.
    // Render ordinary (and still-streaming) code without that builder. Use a
    // fence longer than any in the source so embedded Markdown remains literal.
    final source = element.textContent;
    var fenceLength = 3;
    for (final match in RegExp(r'`+').allMatches(source)) {
      if (match.group(0)!.length >= fenceLength) {
        fenceLength = match.group(0)!.length + 1;
      }
    }
    final fence = '`' * fenceLength;
    return MarkdownBody(
      data: '$fence\n$source${source.endsWith('\n') ? '' : '\n'}$fence',
      selectable: selectable,
      styleSheet: styleSheet,
    );
  }
}

/// Mermaid runs locally in a network-blocked WebView; only validated static SVG
/// crosses back into the native, zoomable renderer. Source is always recoverable.
class MermaidDiagram extends StatefulWidget {
  const MermaidDiagram({super.key, required this.source});
  final String source;

  @override
  State<MermaidDiagram> createState() => _MermaidDiagramState();
}

class _MermaidDiagramState extends State<MermaidDiagram> {
  static final _script = Future.wait([
    rootBundle.loadString('assets/mermaid/mermaid.min.js'),
    rootBundle.loadString('assets/mermaid/native-svg.js'),
  ]).then((scripts) => scripts.join('\n'));
  WebViewController? _controller;
  String? _svg;
  int _generation = 0;
  Timer? _timeout;
  Brightness? _brightness;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final brightness = Theme.of(context).brightness;
    if (_brightness != brightness) {
      _brightness = brightness;
      _render();
    }
  }

  @override
  void didUpdateWidget(MermaidDiagram oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.source != widget.source) _render();
  }

  Future<void> _render() async {
    final generation = ++_generation;
    _timeout?.cancel();
    _controller = null;
    _svg = null;
    if (WebViewPlatform.instance == null) return;
    try {
      final script = await _script;
      if (!mounted || generation != _generation) return;
      final controller = WebViewController(
        onPermissionRequest: (request) => unawaited(request.deny()),
      );
      await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
      await controller.setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) => request.url == 'about:blank'
              ? NavigationDecision.navigate
              : NavigationDecision.prevent,
        ),
      );
      await controller.addJavaScriptChannel(
        'DiagramResult',
        onMessageReceived: (message) {
          if (!mounted || generation != _generation) return;
          _timeout?.cancel();
          final svg = message.message;
          setState(() {
            _svg = svg.length <= 2000000 && isSafeSvgPreviewSource(svg)
                ? svg
                : null;
            _controller = null;
          });
        },
      );
      await controller.loadHtmlString(
        buildMermaidDocument(
          widget.source,
          script,
          dark: _brightness == Brightness.dark,
        ),
        baseUrl: 'about:blank',
      );
      if (!mounted || generation != _generation) return;
      setState(() => _controller = controller);
      _timeout = Timer(const Duration(seconds: 10), () {
        if (mounted && generation == _generation) {
          setState(() => _controller = null);
        }
      });
    } catch (_) {
      // Invalid/incomplete diagrams and unavailable platform views keep source.
      if (mounted && generation == _generation) {
        setState(() => _controller = null);
      }
    }
  }

  @override
  void dispose() {
    _generation++;
    _timeout?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Stack(
    children: [
      if (_svg != null)
        MermaidDiagramPreview(svg: _svg!, source: widget.source)
      else
        SelectableText(
          widget.source,
          textDirection: TextDirection.ltr,
          style: const TextStyle(fontFamily: 'monospace'),
        ),
      if (_controller != null)
        Positioned(
          width: 1,
          height: 1,
          child: IgnorePointer(
            child: ExcludeSemantics(
              child: WebViewWidget(controller: _controller!),
            ),
          ),
        ),
    ],
  );
}

/// Displays the validated, self-contained SVG at readable native dimensions.
class MermaidDiagramPreview extends StatefulWidget {
  const MermaidDiagramPreview({
    super.key,
    required this.svg,
    required this.source,
  });

  final String svg;
  final String source;

  @override
  State<MermaidDiagramPreview> createState() => _MermaidDiagramPreviewState();
}

class _MermaidDiagramPreviewState extends State<MermaidDiagramPreview> {
  bool _showSource = false;
  late Size _size;

  @override
  void initState() {
    super.initState();
    _readSize();
  }

  @override
  void didUpdateWidget(MermaidDiagramPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.svg != oldWidget.svg) _readSize();
  }

  void _readSize() {
    final viewBox = XmlDocument.parse(widget.svg).rootElement
        .getAttribute('viewBox')
        ?.trim()
        .split(RegExp(r'[\s,]+'))
        .map(double.tryParse)
        .toList();
    _size =
        viewBox != null &&
            viewBox.length == 4 &&
            viewBox[2] != null &&
            viewBox[3] != null &&
            viewBox[2]!.isFinite &&
            viewBox[3]!.isFinite &&
            viewBox[2]! > 0 &&
            viewBox[3]! > 0
        ? Size(viewBox[2]!, viewBox[3]!)
        : const Size(320, 200);
  }

  Widget _viewer(Size size) => InteractiveViewer(
    key: ValueKey(widget.svg),
    constrained: false,
    alignment: Alignment.topLeft,
    minScale: 0.1,
    maxScale: 8,
    child: SvgPicture.string(
      widget.svg,
      width: size.width,
      height: size.height,
      fit: BoxFit.contain,
      semanticsLabel: widget.source,
      errorBuilder: (_, _, _) => SelectableText(widget.source),
    ),
  );

  void _openFullscreen(Size size) => showDialog<void>(
    context: context,
    builder: (context) => Dialog.fullscreen(
      child: SafeArea(
        child: Column(
          children: [
            const Align(
              alignment: AlignmentDirectional.centerEnd,
              child: CloseButton(),
            ),
            Expanded(child: _viewer(size)),
          ],
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final textScale = MediaQuery.textScalerOf(context).scale(16) / 16;
    final size = _size * textScale.clamp(1.0, 3.0);
    return LayoutBuilder(
      builder: (context, constraints) {
        final overflow = size.width > constraints.maxWidth || size.height > 320;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                if (overflow && !_showSource)
                  Expanded(
                    child: Text(
                      size.height > 320 ? '拖动、双指缩放查看图表' : '左右滑动查看完整图表',
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  )
                else
                  const Spacer(),
                IconButton(
                  tooltip: 'Mermaid',
                  icon: const Icon(Icons.code),
                  onPressed: () => setState(() => _showSource = !_showSource),
                ),
                IconButton(
                  tooltip: '全屏查看图表',
                  icon: const Icon(Icons.fullscreen),
                  onPressed: () => _openFullscreen(size),
                ),
              ],
            ),
            if (_showSource)
              SelectableText(
                widget.source,
                textDirection: TextDirection.ltr,
                style: const TextStyle(fontFamily: 'monospace'),
              )
            else
              SizedBox(
                height: size.height.clamp(80.0, 320.0),
                child: _viewer(size),
              ),
          ],
        );
      },
    );
  }
}

String buildMermaidDocument(
  String source,
  String script, {
  required bool dark,
}) {
  final encoded = base64Encode(utf8.encode(source));
  return '''<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
</head><body><script>${script.replaceAll('</script', '<\\/script')}</script><script>
(async () => {
  try {
    const source = new TextDecoder().decode(Uint8Array.from(atob('$encoded'), c => c.charCodeAt(0)));
    if (source.length > 20000 || /%%\\s*\\{|^\\s*---/.test(source)) throw new Error('config');
    mermaid.initialize({startOnLoad:false, securityLevel:'strict', theme:'${dark ? 'dark' : 'default'}',
      maxTextSize:20000, maxEdges:200, htmlLabels:false, flowchart:{htmlLabels:false},
      fontFamily:'sans-serif', suppressErrorRendering:true});
    const {svg} = await mermaid.render('diagram', source);
    DiagramResult.postMessage(prepareMermaidSvg(svg));
  } catch (_) { DiagramResult.postMessage(''); }
})();
</script></body></html>''';
}
