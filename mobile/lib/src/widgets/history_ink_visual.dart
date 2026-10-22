import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'brand_mark.dart';
import 'history_ink_painter.dart';
import 'startup_morph.dart';

/// One entrance per history read. The caller's loading state owns its lifetime:
/// cached/fast reads never wait for this decoration to finish.
class HistoryInkVisual extends StatefulWidget {
  const HistoryInkVisual({
    super.key,
    this.compact = false,
    this.loadMorph = StartupMorphData.load,
  });

  final bool compact;
  final Future<StartupMorphData> Function() loadMorph;

  @override
  State<HistoryInkVisual> createState() => _HistoryInkVisualState();
}

class _HistoryInkVisualState extends State<HistoryInkVisual>
    with TickerProviderStateMixin {
  late final AnimationController _entrance;
  late final AnimationController _idle;
  StartupMorphData? _data;
  Float32List? _positions;
  bool _disabled = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _entrance = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2800),
    )..addStatusListener(_onEntranceStatus);
    _idle = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2400),
    );
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await widget.loadMorph();
      if (!mounted) return;
      prepareHistoryInk(data);
      setState(() {
        _data = data;
        _positions = Float32List(data.count * 2);
      });
      if (_disabled || widget.compact) {
        _entrance.value = 1;
      } else {
        _entrance.forward();
      }
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  void _onEntranceStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed && !_disabled) _idle.repeat();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final disabled = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (_disabled == disabled) return;
    _disabled = disabled;
    if (disabled) {
      _idle
        ..stop()
        ..value = 0;
      _entrance
        ..stop()
        ..value = 1;
    } else if (_data != null) {
      // Re-enabling motion keeps the completed icon; it doesn't replay text.
      _idle.repeat();
    }
  }

  @override
  void didUpdateWidget(covariant HistoryInkVisual oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.compact && !oldWidget.compact) _entrance.value = 1;
  }

  @override
  void dispose() {
    _entrance.dispose();
    _idle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: SizedBox(
      width: widget.compact ? 38 : 260,
      height: widget.compact ? 38 : 156,
      child: RepaintBoundary(
        child: _data != null
            ? CustomPaint(
                painter: HistoryInkPainter(
                  data: _data!,
                  entrance: _entrance,
                  idle: _idle,
                  positionsBuffer: _positions!,
                  compact: widget.compact,
                ),
              )
            : Center(
                child: widget.compact || _disabled || _failed
                    ? BrandMark(size: widget.compact ? 38 : 66, animate: false)
                    : Image.asset(
                        'assets/opening/morph-wordmark.png',
                        fit: BoxFit.contain,
                        excludeFromSemantics: true,
                        errorBuilder: (context, error, stackTrace) =>
                            const BrandMark(size: 66, animate: false),
                      ),
              ),
      ),
    ),
  );
}
