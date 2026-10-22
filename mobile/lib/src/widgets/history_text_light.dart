import 'dart:math' as math;
import 'dart:ui' show PathMetric;
import 'package:flutter/material.dart';

import '../state/history_load_progress.dart';

/// The original monoline wordmark, with a continuous travelling ink light.
/// The caller's loading state owns the widget's lifetime.
class HistoryTextLight extends StatefulWidget {
  const HistoryTextLight({super.key, this.compact = false, this.phase});
  final bool compact;
  final HistoryLoadPhase? phase;

  @override
  State<HistoryTextLight> createState() => _HistoryTextLightState();
}

class _HistoryTextLightState extends State<HistoryTextLight>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final AnimationController _clock;
  bool _reduced = false, _visible = true, _foreground = true;

  @override
  void initState() {
    super.initState();
    _clock = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 4),
    );
    WidgetsBinding.instance.addObserver(this);
    final state = WidgetsBinding.instance.lifecycleState;
    _foreground = state == null || state == AppLifecycleState.resumed;
  }

  void _sync() {
    if (_reduced || !_visible || !_foreground) {
      _clock.stop();
      if (_reduced) _clock.value = 0;
    } else if (!_clock.isAnimating) {
      _clock.repeat();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduced = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    _visible = TickerMode.of(context);
    _sync();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _sync();
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _clock.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: RepaintBoundary(
      child: SizedBox(
        width: widget.compact ? 80 : 216,
        height: widget.compact ? 24 : 64,
        child: TickerMode(
          enabled: !_reduced && _visible && _foreground,
          child: TweenAnimationBuilder<double>(
            tween: Tween(
              end: switch (widget.phase) {
                HistoryLoadPhase.sending => 0.0,
                HistoryLoadPhase.waiting => 1.0,
                HistoryLoadPhase.restoring ||
                HistoryLoadPhase.reading ||
                null => 2.0,
                HistoryLoadPhase.transferring => 2.5,
                HistoryLoadPhase.preparing => 3.0,
              },
            ),
            duration: _reduced
                ? Duration.zero
                : const Duration(milliseconds: 240),
            curve: Curves.easeInOutCubic,
            builder: (context, phaseTone, _) => CustomPaint(
              painter: HistoryTextLightPainter(
                _clock,
                phaseTone: phaseTone,
                reducedMotion: _reduced,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

class HistoryTextLightPainter extends CustomPainter {
  HistoryTextLightPainter(
    this.clock, {
    this.phaseTone = 2,
    this.reducedMotion = false,
  }) : super(repaint: clock);
  final Animation<double> clock;
  final double phaseTone;
  final bool reducedMotion;

  // Phase changes adjust expression, never a completion percentage or timer.
  double _blend(List<double> values) {
    final tone = phaseTone.clamp(0.0, 3.0);
    final index = tone.floor();
    return values[index] +
        (values[math.min(index + 1, 3)] - values[index]) * (tone - index);
  }

  @override
  void paint(Canvas canvas, Size size) {
    final scale = math.min(size.width / 144, size.height / 36);
    final fit = 144 / _advances.reduce((a, b) => a + b);
    final cycle = clock.value % 1;
    final t = cycle * math.pi * 2;
    final energy = _blend(const [.68, .40, .88, 1.0]);
    final lift = _blend(const [.18, .06, .56, .12]);
    final head = ((cycle + .12) % 1) * _inkLength;
    final trail = _inkLength * .25;
    var x = 0.0;
    canvas.save();
    canvas.translate(
      (size.width - 144 * scale) / 2,
      (size.height - 36 * scale) / 2,
    );
    canvas.scale(scale);
    for (var i = 0; i < _letters.length; i++) {
      final breath = .5 + .5 * math.sin(t - i * .34);
      final light = reducedMotion ? .66 : .36 + .12 * breath;
      canvas.save();
      canvas.translate(x, reducedMotion ? 0 : -lift * breath);
      canvas.scale(fit, 1.08);
      canvas.drawPath(
        _letters[i],
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.85
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..color = _paper.withValues(alpha: light),
      );
      if (!reducedMotion) {
        // Three tapered bands follow the actual glyph contours. There is no
        // blur, saveLayer, raster asset or per-frame path-metric computation.
        for (var band = 0; band < 3; band++) {
          final end = head - trail * (2 - band) / 3;
          final start = end - trail / 3;
          final paint = Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = band == 2 ? 1.95 : 1.85
            ..strokeCap = StrokeCap.round
            ..strokeJoin = StrokeJoin.round
            ..color = (band == 2 ? _mint : _paper).withValues(
              alpha: energy * const [.20, .52, .90][band],
            );
          for (final contour in _inkContours[i]) {
            for (final wrap in const [-1, 0, 1]) {
              final from = math.max(
                0.0,
                start + wrap * _inkLength - contour.offset,
              );
              final to = math.min(
                contour.metric.length,
                end + wrap * _inkLength - contour.offset,
              );
              if (to > from) {
                canvas.drawPath(contour.metric.extractPath(from, to), paint);
              }
            }
          }
        }
      }
      canvas.restore();
      x += _advances[i] * fit;
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(HistoryTextLightPainter oldDelegate) =>
      oldDelegate.clock != clock ||
      oldDelegate.phaseTone != phaseTone ||
      oldDelegate.reducedMotion != reducedMotion;

  static const _paper = Color(0xFFF2F0EB);
  static const _mint = Color(0xFFA6E3B9);
}

class _InkContour {
  const _InkContour(this.metric, this.offset);
  final PathMetric metric;
  final double offset;
}

// Retained once for both first-page and compact pagination painters.
final _inkContours = () {
  var offset = 0.0;
  return [
    for (final letter in _letters)
      [
        for (final metric in letter.computeMetrics())
          (() {
            final contour = _InkContour(metric, offset);
            offset += metric.length;
            return contour;
          })(),
      ],
  ];
}();
final _inkLength =
    _inkContours.last.last.offset + _inkContours.last.last.metric.length;

// Original monoline outlines keep the word independent of installed fonts.
final List<Path> _letters = [
  Path()
    ..moveTo(1.5, 25)
    ..lineTo(1.5, 1)
    ..lineTo(8.2, 1)
    ..cubicTo(17.5, 1, 17.5, 13.8, 8.2, 13.8)
    ..lineTo(1.5, 13.8)
    ..moveTo(8.0, 13.8)
    ..lineTo(16.2, 25),
  Path()
    ..moveTo(1.1, 16.4)
    ..lineTo(13.1, 16.4)
    ..cubicTo(13.1, 6.4, 0.8, 6.2, 0.8, 16.6)
    ..cubicTo(0.8, 25.2, 8.0, 27.2, 12.8, 22.6),
  Path()
    ..moveTo(1.4, 1)
    ..lineTo(1.4, 21.6)
    ..quadraticBezierTo(1.4, 25, 4.8, 25),
  Path()
    ..moveTo(12.4, 9.1)
    ..lineTo(12.4, 25)
    ..moveTo(12.4, 15.9)
    ..cubicTo(12.4, 6.8, 0.8, 6.8, 0.8, 17)
    ..cubicTo(0.8, 27.5, 12.4, 27.5, 12.4, 18),
  Path()
    ..moveTo(0.7, 9.1)
    ..lineTo(6.6, 24.5)
    ..moveTo(13, 9.1)
    ..lineTo(5.8, 28.8)
    ..quadraticBezierTo(4.3, 32.8, 1.2, 32),
  Path()
    ..moveTo(0.9, 9.1)
    ..lineTo(0.9, 18.9)
    ..cubicTo(0.9, 27.2, 12.5, 27.2, 12.5, 18.9)
    ..lineTo(12.5, 9.1),
  Path()
    ..moveTo(0.9, 25)
    ..lineTo(0.9, 9.1)
    ..moveTo(0.9, 16)
    ..cubicTo(0.9, 6.2, 12.5, 6.2, 12.5, 15.6)
    ..lineTo(12.5, 25),
  Path()
    ..moveTo(1.1, 16.4)
    ..lineTo(13.1, 16.4)
    ..cubicTo(13.1, 6.4, 0.8, 6.2, 0.8, 16.6)
    ..cubicTo(0.8, 25.2, 8, 27.2, 12.8, 22.6),
];

const _advances = [20.0, 17.0, 8.5, 17.0, 17.0, 17.0, 17.0, 15.5];
