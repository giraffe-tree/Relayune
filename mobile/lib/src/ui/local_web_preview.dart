import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../l10n/relayune_localizations.dart';
import '../network/local_web_gateway.dart';
import '../network/local_web_progress.dart';
import 'local_web_loading.dart';
import '../state/app_controller.dart';

class LocalWebPreview extends StatefulWidget {
  const LocalWebPreview({
    super.key,
    required this.controller,
    required this.sessionId,
    required this.url,
  });
  final AppController controller;
  final String sessionId;
  final Uri url;

  @override
  State<LocalWebPreview> createState() => _LocalWebPreviewState();
}

class _LocalWebPreviewState extends State<LocalWebPreview>
    with WidgetsBindingObserver {
  final _resources = LocalWebLoadProgress();
  Timer? _elapsedTimer;
  bool _initialDocumentReady = false;
  LocalWebGateway? _gateway;
  WebViewController? _web;
  bool _loading = true, _paused = false, _failed = false;
  bool _canBack = false, _canForward = false;
  int _progress = 0, _historyRead = 0;
  String? _title;
  late Uri _address;
  late String _documentPath;
  int _generation = 0;
  Object? _authorization;
  String? _device;

  @override
  void initState() {
    super.initState();
    _address = widget.url;
    _documentPath = widget.url.path.isEmpty ? '/' : widget.url.path;
    _resources.addListener(_resourceChanged);
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (widget.controller.desktopInfo?.supportsLocalWeb == true) {
        unawaited(_open());
      } else {
        setState(() => _loading = false);
      }
    });
    widget.controller.addListener(_checkAuthorization);
    _authorization = widget.controller.relayKey;
    _device = widget.controller.bootstrap?.device.id;
  }

  void _checkAuthorization() {
    if (widget.controller.relayKey != _authorization ||
        widget.controller.bootstrap?.device.id != _device) {
      _stop();
      if (mounted) setState(() => _paused = true);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _stop();
      if (mounted) setState(() => _paused = true);
    }
  }

  void _resourceChanged() {
    if (!mounted) return;
    final gateway = _gateway;
    final document = _resources.resources.where(
      (item) => item.isDocument && item.path == _documentPath,
    );
    if (document.any((item) => item.phase == LocalWebResourcePhase.complete)) {
      _initialDocumentReady = true;
    }
    if (gateway != null &&
        document.any((item) => item.phase == LocalWebResourcePhase.failed)) {
      _failed = true;
      _loading = false;
    }
    setState(() {});
  }

  void _beginNavigation(LocalWebGateway gateway) {
    gateway.beginNavigation();
    _resources.begin(gateway.progressEpoch);
  }

  void _showResources() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => LocalWebResourceSheet(
        progress: _resources,
        address: _address.authority,
      ),
    );
  }

  void _stop() {
    _elapsedTimer?.cancel();
    _elapsedTimer = null;
    _resources.stop();
    _generation++;
    _loading = false;
    _canBack = _canForward = false;
    _historyRead++;
    final gateway = _gateway;
    _gateway = null;
    final web = _web;
    _web = null;
    if (web != null) {
      unawaited(() async {
        try {
          await web.loadHtmlString('<!doctype html><html></html>');
          await web.clearLocalStorage();
          await web.clearCache();
        } on Object {
          /* The native view may already have been disposed. */
        }
      }());
    }
    if (gateway != null) {
      unawaited(gateway.close());
      // Best effort close; desktop also has a hard expiry and per-request auth checks.
      if (widget.controller.relayKey == _authorization &&
          widget.controller.bootstrap?.device.id == _device) {
        unawaited(
          widget.controller
              .requestLocalWeb(widget.sessionId, {
                'preview_id': gateway.previewId,
                'close': true,
              })
              .then<void>((_) {}, onError: (Object _) {}),
        );
      }
    }
  }

  Future<void> _open() async {
    _stop();
    final generation = _generation;
    _resources.begin(0);
    _elapsedTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && (_loading || _resources.active > 0)) setState(() {});
    });
    final failureText = context.l10n.localWebUnavailable;
    setState(() {
      _loading = true;
      _failed = false;
      _paused = false;
      _progress = 0;
      _title = null;
      _initialDocumentReady = false;
      _address = widget.url;
      _documentPath = widget.url.path.isEmpty ? '/' : widget.url.path;
    });
    try {
      final compatibilityScript = await rootBundle.loadString(
        'assets/local_web/font-fallback.js',
      );
      if (!mounted || generation != _generation) return;
      final opened = await widget.controller.requestLocalWeb(widget.sessionId, {
        'url': widget.url.toString(),
      }, open: true);
      if (!mounted || generation != _generation) return;
      final gateway = await LocalWebGateway.start(
        widget.url,
        opened['preview_id'] as String,
        (payload, {onProgress}) => widget.controller.requestLocalWeb(
          widget.sessionId,
          payload,
          onProgress: onProgress,
        ),
        onResourceProgress: (progress) {
          if (mounted && generation == _generation) {
            _resources.observe(progress);
          }
        },
        failureText: failureText,
        compatibilityScript: compatibilityScript,
        loadCompatibilityFont: () async {
          final data = await rootBundle.load(
            'assets/visualization/noto-cjk.woff2',
          );
          return data.buffer.asUint8List(
            data.offsetInBytes,
            data.lengthInBytes,
          );
        },
      );
      if (!mounted || generation != _generation) {
        await gateway.close();
        return;
      }
      _gateway = gateway;
      final web = WebViewController(
        onPermissionRequest: (request) => unawaited(request.deny()),
      );
      await web.setJavaScriptMode(JavaScriptMode.unrestricted);
      await web.setNavigationDelegate(
        NavigationDelegate(
          onProgress: (value) {
            if (mounted && generation == _generation) {
              setState(() => _progress = value);
            }
          },
          onPageStarted: (url) {
            if (!mounted || generation != _generation) return;
            setState(() {
              _loading = true;
              _failed = false;
              _progress = 0;
            });
            _updateAddress(url, gateway);
            unawaited(_syncNavigation(web, generation));
          },
          onUrlChange: (change) {
            if (!mounted || generation != _generation) return;
            _updateAddress(change.url, gateway);
            unawaited(_syncNavigation(web, generation));
          },
          onPageFinished: (url) {
            if (!mounted || generation != _generation) return;
            setState(() {
              _loading = false;
              _progress = 100;
            });
            _updateAddress(url, gateway);
            unawaited(_syncNavigation(web, generation));
          },
          onNavigationRequest: (request) {
            if (!mounted || generation != _generation) {
              return NavigationDecision.prevent;
            }
            if (request.url == 'about:blank') {
              return NavigationDecision.navigate;
            }
            final uri = Uri.tryParse(request.url);
            final target = uri == null ? null : gateway.navigation(uri);
            if (target == null) {
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(context.l10n.localWebBlocked)),
                );
              }
              return NavigationDecision.prevent;
            }
            if (request.isMainFrame && !target.path.startsWith('/_relayune/')) {
              final current = _address;
              final hashOnly =
                  target.path == current.path &&
                  target.query == current.query &&
                  target.fragment != current.fragment;
              if (!hashOnly) {
                _documentPath = target.path.isEmpty ? '/' : target.path;
                _beginNavigation(gateway);
              }
            }
            if (target != uri) {
              unawaited(web.loadRequest(target));
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
          onWebResourceError: (error) {
            if (error.isForMainFrame == true &&
                mounted &&
                generation == _generation) {
              setState(() {
                _failed = true;
                _loading = false;
              });
            }
          },
        ),
      );
      if (!mounted || generation != _generation) {
        await gateway.close();
        return;
      }
      setState(() => _web = web);
      await web.loadRequest(gateway.entry);
    } on Object {
      if (mounted && generation == _generation) {
        _stop();
        setState(() {
          _failed = true;
          _loading = false;
        });
      }
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_checkAuthorization);
    WidgetsBinding.instance.removeObserver(this);
    _resources.removeListener(_resourceChanged);
    _stop();
    _resources.dispose();
    super.dispose();
  }

  void _updateAddress(String? value, LocalWebGateway gateway) {
    final uri = Uri.tryParse(value ?? '');
    // Never expose the phone renderer port or its bootstrap capability URL.
    if (uri == null ||
        !gateway.allows(uri) ||
        uri.path.startsWith('/_relayune/')) {
      return;
    }
    setState(
      () => _address = Uri(
        scheme: widget.url.scheme,
        host: widget.url.host,
        port: widget.url.port,
        path: uri.path,
        query: uri.hasQuery ? uri.query : null,
        fragment: uri.hasFragment ? uri.fragment : null,
      ),
    );
  }

  Future<void> _syncNavigation(WebViewController web, int generation) async {
    final read = ++_historyRead;
    try {
      final back = await web.canGoBack();
      final forward = await web.canGoForward();
      final title = await web.getTitle();
      if (!mounted || generation != _generation || read != _historyRead) return;
      setState(() {
        _canBack = back;
        _canForward = forward;
        _title = title;
      });
    } on Object {
      /* Navigation may finish after the native view is closed. */
    }
  }

  Future<void> _navigate({required bool forward}) async {
    final web = _web;
    final generation = _generation;
    if (web == null) return;
    try {
      if (forward) {
        await web.goForward();
      } else {
        await web.goBack();
      }
      await _syncNavigation(web, generation);
    } on Object {
      if (mounted && generation == _generation) {
        setState(() {
          _failed = true;
          _loading = false;
        });
      }
    }
  }

  Future<void> _refresh() async {
    final web = _web;
    final gateway = _gateway;
    final generation = _generation;
    if (web == null || gateway == null) return _open();
    try {
      final uri = Uri.tryParse(await web.currentUrl() ?? '');
      if (!mounted || generation != _generation) return;
      // Always GET: never silently replay the last form POST.
      if (uri != null && gateway.allows(uri)) await web.loadRequest(uri);
    } on Object {
      if (mounted && generation == _generation) {
        setState(() {
          _failed = true;
          _loading = false;
        });
      }
    }
  }

  void _showAddress() {
    final copy = context.l10n;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      useSafeArea: true,
      builder: (context) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.computer_outlined, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    widget.controller.bootstrap?.device.name ??
                        copy.localWebTitle,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            SelectableText(
              _address.toString(),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final colors = Theme.of(context).colorScheme;
    final supported = widget.controller.desktopInfo?.supportsLocalWeb == true;
    final web = _web;
    final title = _title?.trim();
    final status = !supported
        ? copy.localWebUpdate
        : _paused
        ? copy.localWebPaused
        : copy.localWebUnavailable;
    Widget control(IconData icon, String label, VoidCallback? action) =>
        IconButton(
          tooltip: label,
          onPressed: action,
          icon: Icon(icon, size: 21),
          constraints: const BoxConstraints(minWidth: 44, minHeight: 48),
          padding: const EdgeInsets.all(10),
          style: IconButton.styleFrom(foregroundColor: colors.onSurfaceVariant),
        );
    return PopScope(
      canPop: !_canBack,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _canBack) unawaited(_navigate(forward: false));
      },
      child: Scaffold(
        backgroundColor: colors.surface,
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              Expanded(
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (web != null && !_failed && !_paused)
                      WebViewWidget(controller: web),
                    if (web == null ||
                        !_initialDocumentReady ||
                        _failed ||
                        _paused)
                      LocalWebOpening(
                        loading: _loading,
                        status: _loading
                            ? _gateway == null
                                  ? copy.localWebLoading
                                  : copy.localWebGettingPage
                            : status,
                        address: _address.authority,
                        elapsed: _resources.elapsed,
                        action: !_loading && supported
                            ? FilledButton.tonal(
                                onPressed: _paused ? _open : _refresh,
                                child: Text(
                                  _paused
                                      ? copy.localWebOpen
                                      : copy.commonRetry,
                                ),
                              )
                            : null,
                      ),
                  ],
                ),
              ),
              SizedBox(
                height: 2,
                child: _loading
                    ? LinearProgressIndicator(
                        value: _progress == 0 ? null : _progress / 100,
                        backgroundColor: colors.surfaceContainerHighest,
                        color: colors.secondary,
                      )
                    : ColoredBox(
                        color: colors.outlineVariant.withValues(alpha: .45),
                      ),
              ),
              if (supported && !_paused)
                LocalWebStatusStrip(
                  progress: _resources,
                  busy: _loading || _resources.active > 0,
                  label: _resources.hasResources
                      ? copy.localWebResourceSummary(
                          _resources.completed,
                          _resources.active,
                        )
                      : _loading
                      ? copy.localWebResources
                      : copy.localWebLoadingPage,
                  onTap: _showResources,
                ),
              Material(
                color: colors.surface,
                child: SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 8,
                    ),
                    child: Row(
                      children: [
                        control(
                          Icons.chevron_left_rounded,
                          copy.localWebBack,
                          _canBack
                              ? () => unawaited(_navigate(forward: false))
                              : null,
                        ),
                        control(
                          Icons.chevron_right_rounded,
                          copy.localWebForward,
                          _canForward
                              ? () => unawaited(_navigate(forward: true))
                              : null,
                        ),
                        Expanded(
                          child: Semantics(
                            button: true,
                            label: copy.localWebAddress,
                            child: Material(
                              color: colors.surfaceContainerHighest.withValues(
                                alpha: .55,
                              ),
                              borderRadius: BorderRadius.circular(14),
                              child: InkWell(
                                onTap: _showAddress,
                                borderRadius: BorderRadius.circular(14),
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 8,
                                  ),
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Text(
                                        title == null || title.isEmpty
                                            ? widget
                                                      .controller
                                                      .bootstrap
                                                      ?.device
                                                      .name ??
                                                  copy.localWebTitle
                                            : title,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                          color: colors.onSurface,
                                        ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        _address.authority,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: colors.onSurfaceVariant,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                        control(
                          Icons.refresh_rounded,
                          copy.localWebRefresh,
                          supported && !_loading
                              ? () => unawaited(_refresh())
                              : null,
                        ),
                        control(
                          Icons.close_rounded,
                          copy.commonClose,
                          () => Navigator.of(context).pop(),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
