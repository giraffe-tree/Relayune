import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

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

/// Gives the active diagram exclusive drag gestures until the user taps Done.
/// The scrolling widget remains mounted, keeping its controller and position.
class DiagramScrollRegion extends StatefulWidget {
  const DiagramScrollRegion({super.key, required this.child});

  final Widget child;

  static bool isInteracting(BuildContext context) =>
      context
          .dependOnInheritedWidgetOfExactType<_DiagramScrollScope>()
          ?.active ??
      false;

  @override
  State<DiagramScrollRegion> createState() => _DiagramScrollRegionState();
}

class _DiagramScrollRegionState extends State<DiagramScrollRegion> {
  final _activeMessages = <Object>{};

  void _setActive(Object message, bool active) {
    if (!mounted || _activeMessages.contains(message) == active) return;
    setState(() {
      if (active) {
        _activeMessages.add(message);
      } else {
        _activeMessages.remove(message);
      }
    });
  }

  @override
  Widget build(BuildContext context) => _DiagramScrollScope(
    active: _activeMessages.isNotEmpty,
    setActive: _setActive,
    child: ScrollConfiguration(
      behavior: ScrollConfiguration.of(context).copyWith(
        physics: _activeMessages.isEmpty
            ? null
            : const NeverScrollableScrollPhysics(),
      ),
      child: widget.child,
    ),
  );
}

class _DiagramScrollScope extends InheritedWidget {
  const _DiagramScrollScope({
    required this.active,
    required this.setActive,
    required super.child,
  });

  final bool active;
  final void Function(Object message, bool active) setActive;

  @override
  bool updateShouldNotify(_DiagramScrollScope oldWidget) =>
      active != oldWidget.active;
}

/// Keeps message selection available while no diagram is being manipulated.
/// SelectionContainer.disabled alone cannot stop SelectionArea's ancestor
/// gesture recognizers. Reparent the stable content outside those recognizers
/// during diagram interaction, preserving the Markdown and diagram state.
class DiagramSelectionArea extends StatefulWidget {
  const DiagramSelectionArea({super.key, required this.child});

  final Widget child;

  @override
  State<DiagramSelectionArea> createState() => _DiagramSelectionAreaState();
}

class _DiagramSelectionAreaState extends State<DiagramSelectionArea> {
  final _contentKey = GlobalKey();
  Object? _activeDiagram;
  _DiagramScrollScope? _scrollScope;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _scrollScope = context
        .dependOnInheritedWidgetOfExactType<_DiagramScrollScope>();
  }

  @override
  void dispose() {
    final scope = _scrollScope;
    if (_activeDiagram != null) {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => scope?.setActive(this, false),
      );
    }
    super.dispose();
  }

  void _setActive(Object diagram, bool active) {
    if (!mounted || (!active && _activeDiagram != diagram)) return;
    setState(() => _activeDiagram = active ? diagram : null);
    _scrollScope?.setActive(this, active);
  }

  @override
  Widget build(BuildContext context) {
    final content = KeyedSubtree(key: _contentKey, child: widget.child);
    return _DiagramInteractionScope(
      activeDiagram: _activeDiagram,
      setActive: _setActive,
      child: _activeDiagram == null ? SelectionArea(child: content) : content,
    );
  }
}

class _DiagramInteractionScope extends InheritedWidget {
  const _DiagramInteractionScope({
    required this.activeDiagram,
    required this.setActive,
    required super.child,
  });

  final Object? activeDiagram;
  final void Function(Object diagram, bool active) setActive;

  static _DiagramInteractionScope? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_DiagramInteractionScope>();

  @override
  bool updateShouldNotify(_DiagramInteractionScope oldWidget) =>
      activeDiagram != oldWidget.activeDiagram;
}

/// Shows the entire diagram first; manipulation is an explicit inline mode.
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
  final _identity = Object();
  final _viewportKey = GlobalKey<_DiagramViewportState>();
  bool _showSource = false;
  bool _localInteracting = false;
  _DiagramInteractionScope? _scope;
  late Size _size;

  @override
  void initState() {
    super.initState();
    _readSize();
  }

  @override
  void didUpdateWidget(MermaidDiagramPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.svg != oldWidget.svg) {
      _readSize();
      _localInteracting = false;
      _releaseInteraction();
    }
  }

  void _releaseInteraction() {
    final scope = _scope;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      scope?.setActive(_identity, false);
    });
  }

  @override
  void dispose() {
    _releaseInteraction();
    super.dispose();
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

  void _setInteracting(bool active) {
    setState(() => _localInteracting = active);
    _scope?.setActive(_identity, active);
    if (active) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _localInteracting) {
          // Interaction pauses user scrolling. First bring the expanded card
          // into view so controls and the entire canvas stay reachable.
          Scrollable.ensureVisible(
            context,
            alignment: .5,
            duration: const Duration(milliseconds: 200),
          );
        }
      });
    }
  }

  void _openFullscreen(Size size) {
    _setInteracting(false);
    showDialog<void>(
      context: context,
      builder: (context) => _FullscreenDiagram(
        svg: widget.svg,
        source: widget.source,
        nativeSize: size,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    _scope = _DiagramInteractionScope.maybeOf(context);
    final interacting = _scope == null
        ? _localInteracting
        : _scope!.activeDiagram == _identity;
    final textScale = MediaQuery.textScalerOf(context).scale(16) / 16;
    final size = _size * textScale.clamp(1.0, 3.0);
    return LayoutBuilder(
      builder: (context, constraints) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SelectionContainer.disabled(
            child: Wrap(
              alignment: WrapAlignment.end,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (!_showSource && !interacting)
                  TextButton.icon(
                    onPressed: () => _setInteracting(true),
                    icon: const Icon(Icons.zoom_in),
                    label: const Text('放大操作'),
                  )
                else if (interacting) ...[
                  ..._diagramControls(_viewportKey),
                  TextButton(
                    onPressed: () => _setInteracting(false),
                    child: const Text('完成'),
                  ),
                ],
                if (!interacting)
                  IconButton(
                    tooltip: 'Mermaid',
                    icon: const Icon(Icons.code),
                    onPressed: () {
                      _setInteracting(false);
                      setState(() => _showSource = !_showSource);
                    },
                  ),
                IconButton(
                  tooltip: '全屏查看图表',
                  icon: const Icon(Icons.fullscreen),
                  onPressed: () => _openFullscreen(size),
                ),
              ],
            ),
          ),
          if (interacting)
            SelectionContainer.disabled(
              child: Text(
                '拖动、双指缩放查看图表',
                style: Theme.of(context).textTheme.labelSmall,
              ),
            ),
          if (_showSource)
            SelectableText(
              widget.source,
              textDirection: TextDirection.ltr,
              style: const TextStyle(fontFamily: 'monospace'),
            )
          else
            SizedBox(
              height:
                  (size.height *
                          math.min(1.0, constraints.maxWidth / size.width))
                      .clamp(120.0, 320.0),
              child: _DiagramViewport(
                key: _viewportKey,
                svg: widget.svg,
                source: widget.source,
                nativeSize: size,
                interactive: interacting,
              ),
            ),
        ],
      ),
    );
  }
}

List<Widget> _diagramControls(GlobalKey<_DiagramViewportState> key) => [
  IconButton(
    tooltip: '缩小图表',
    icon: const Icon(Icons.remove),
    onPressed: () => key.currentState?.zoom(1 / 1.5),
  ),
  IconButton(
    tooltip: '放大图表',
    icon: const Icon(Icons.add),
    onPressed: () => key.currentState?.zoom(1.5),
  ),
  IconButton(
    tooltip: '适应全图',
    icon: const Icon(Icons.fit_screen),
    onPressed: () => key.currentState?.fit(),
  ),
];

class _FullscreenDiagram extends StatelessWidget {
  _FullscreenDiagram({
    required this.svg,
    required this.source,
    required this.nativeSize,
  });

  final String svg;
  final String source;
  final Size nativeSize;
  final _viewportKey = GlobalKey<_DiagramViewportState>();

  @override
  Widget build(BuildContext context) => Dialog.fullscreen(
    child: SafeArea(
      child: Column(
        children: [
          Row(
            children: [
              ..._diagramControls(_viewportKey),
              const Spacer(),
              const CloseButton(),
            ],
          ),
          Expanded(
            child: _DiagramViewport(
              key: _viewportKey,
              svg: svg,
              source: source,
              nativeSize: nativeSize,
              interactive: true,
            ),
          ),
        ],
      ),
    ),
  );
}

class _DiagramViewport extends StatefulWidget {
  const _DiagramViewport({
    super.key,
    required this.svg,
    required this.source,
    required this.nativeSize,
    required this.interactive,
  });

  final String svg;
  final String source;
  final Size nativeSize;
  final bool interactive;

  @override
  State<_DiagramViewport> createState() => _DiagramViewportState();
}

class _DiagramViewportState extends State<_DiagramViewport> {
  static const _maxScale = 32.0;
  final _transform = TransformationController();
  Size? _viewport;
  bool _zoomOnActivate = false;
  bool _resetPending = false;

  @override
  void didUpdateWidget(_DiagramViewport oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.svg != oldWidget.svg || !widget.interactive) {
      _zoomOnActivate = false;
      _resetPending = true;
    } else if (!oldWidget.interactive) {
      _zoomOnActivate = true;
    }
  }

  @override
  void dispose() {
    _transform.dispose();
    super.dispose();
  }

  void fit() => _transform.value = Matrix4.identity();

  void zoom(double factor) {
    final viewport = _viewport;
    if (viewport == null) return;
    final matrix = _transform.value;
    final scale = matrix.getMaxScaleOnAxis();
    final next = (scale * factor).clamp(1.0, _maxScale);
    final ratio = next / scale;
    final x =
        (viewport.width / 2 - (viewport.width / 2 - matrix.storage[12]) * ratio)
            .clamp(viewport.width * (1 - next), 0.0);
    final y =
        (viewport.height / 2 -
                (viewport.height / 2 - matrix.storage[13]) * ratio)
            .clamp(viewport.height * (1 - next), 0.0);
    _transform.value = Matrix4.identity()
      ..translate(x, y)
      ..scale(next);
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final viewport = constraints.biggest;
      final fitScale = math.min(
        1.0,
        math.min(
          viewport.width / widget.nativeSize.width,
          viewport.height / widget.nativeSize.height,
        ),
      );
      final fitted = widget.nativeSize * fitScale;
      if (_viewport != viewport || _zoomOnActivate || _resetPending) {
        final activate = _zoomOnActivate;
        _viewport = viewport;
        _zoomOnActivate = false;
        _resetPending = false;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          fit();
          if (activate) zoom(math.max(2.0, 1 / fitScale));
        });
      }
      // A viewport-sized canvas includes the letterbox space. Its boundaries
      // permit the complete diagram at scale 1, regardless of aspect ratio.
      final canvas = SizedBox.fromSize(
        size: viewport,
        child: Center(
          child: SvgPicture.string(
            widget.svg,
            width: fitted.width,
            height: fitted.height,
            fit: BoxFit.contain,
            semanticsLabel: '流程图',
            errorBuilder: (_, _, _) => SelectableText(widget.source),
          ),
        ),
      );
      return widget.interactive
          ? InteractiveViewer(
              transformationController: _transform,
              minScale: 1,
              maxScale: _maxScale,
              child: canvas,
            )
          : canvas;
    },
  );
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
