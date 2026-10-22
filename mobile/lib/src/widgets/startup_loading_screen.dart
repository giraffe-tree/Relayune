import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'startup_morph.dart';

/// A presentation during real startup work. Ready content is immediately
/// interactive; optional animation work never extends the startup deadline.
class StartupLoadingScreen extends StatefulWidget {
  const StartupLoadingScreen({
    super.key,
    this.loading = true,
    this.bypass = false,
    this.child = const SizedBox.expand(),
    this.loadMorph = StartupMorphData.load,
  });

  final bool loading;
  final bool bypass;
  final Widget child;
  final Future<StartupMorphData> Function() loadMorph;

  @override
  State<StartupLoadingScreen> createState() => _StartupLoadingScreenState();
}

class _StartupLoadingScreenState extends State<StartupLoadingScreen>
    with TickerProviderStateMixin, WidgetsBindingObserver {
  late final _entrance = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 3200),
  )..addStatusListener(_onEntranceStatus);
  late final _idle = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1800),
  );
  Timer? _assetTimeout;
  Timer? _assetStart;
  StartupMorphData? _data;
  Float32List? _positions;
  bool _visible = true;
  bool _reduceMotion = false;
  bool _assetFailed = false;
  bool _foreground = true;
  bool _loadStarted = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _foreground = lifecycle == null || lifecycle == AppLifecycleState.resumed;
    // Cached launches usually finish before this. Keep optional mesh/image
    // preparation off their critical path, while real waits retain the morph.
    _assetStart = Timer(const Duration(milliseconds: 300), _ensureLoad);
  }

  void _ensureLoad() {
    if (!mounted || !_visible || !widget.loading || _loadStarted) return;
    _loadStarted = true;
    _assetTimeout = Timer(const Duration(seconds: 2), _failAsset);
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final data = await widget.loadMorph();
      _assetTimeout?.cancel();
      if (!mounted || !_visible || _assetFailed) return;
      setState(() {
        _data = data;
        _positions = Float32List(data.count * 2);
      });
      if (_entrance.isCompleted) return;
      if (_reduceMotion || !_foreground || widget.bypass) {
        _finish();
      } else {
        _entrance.forward();
      }
    } on Object {
      _failAsset();
    }
  }

  void _failAsset() {
    _assetTimeout?.cancel();
    if (!mounted || !_visible) return;
    setState(() => _assetFailed = true);
    _finish();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduceMotion = MediaQuery.disableAnimationsOf(context);
    if (_reduceMotion) _finish();
    _reconcile();
  }

  @override
  void didUpdateWidget(StartupLoadingScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final restarted = widget.loading && !oldWidget.loading;
    if (restarted) {
      _visible = true;
    }
    _reconcile();
    if (restarted) _ensureLoad();
  }

  void _onEntranceStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed) _reconcile();
  }

  void _finish() {
    _entrance.value = 1;
    if (mounted) setState(() {});
  }

  void _reconcile() {
    if (widget.bypass || !widget.loading) {
      _assetStart?.cancel();
      _assetTimeout?.cancel();
      if (widget.bypass && !_entrance.isCompleted) _entrance.value = 1;
      _entrance.stop();
      _idle.stop();
      _visible = false;
      return;
    }
    if (!_entrance.isCompleted) return;
    if (_visible && !_reduceMotion && _foreground && !_assetFailed) {
      if (!_idle.isAnimating) _idle.repeat();
    } else {
      _idle.stop();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (!_foreground) _finish();
    if (mounted) setState(_reconcile);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _assetTimeout?.cancel();
    _assetStart?.cancel();
    _entrance.dispose();
    _idle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Stack(
    fit: StackFit.expand,
    children: [
      IgnorePointer(
        ignoring: _visible,
        child: ExcludeSemantics(excluding: _visible, child: widget.child),
      ),
      if (_visible)
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: _finish,
          child: ColoredBox(
            key: const ValueKey('startup-morph-overlay'),
            color: const Color(0xFF0B1220),
            child: Center(
              child: Semantics(
                label: 'Relayune',
                image: true,
                child: ExcludeSemantics(
                  child: RepaintBoundary(
                    child: SizedBox(
                      width: 400,
                      height: 240,
                      child: _data == null
                          ? Image.asset(
                              _assetFailed ||
                                      _reduceMotion ||
                                      _entrance.isCompleted
                                  ? 'assets/opening/morph-moon.png'
                                  : 'assets/opening/morph-wordmark.png',
                              fit: BoxFit.contain,
                              errorBuilder: (_, _, _) => const Center(
                                child: Text(
                                  'Relayune',
                                  textDirection: TextDirection.ltr,
                                  style: TextStyle(
                                    color: Color(0xFFF6F8F5),
                                    fontSize: 36,
                                    decoration: TextDecoration.none,
                                  ),
                                ),
                              ),
                            )
                          : CustomPaint(
                              painter: StartupMorphPainter(
                                data: _data!,
                                entrance: _entrance,
                                idle: _idle,
                                positionsBuffer: _positions!,
                              ),
                            ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
    ],
  );
}
