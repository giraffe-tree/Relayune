import 'dart:math' as math;

import 'package:flutter/material.dart';

class BrandMark extends StatefulWidget {
  const BrandMark({
    super.key,
    this.size = 38,
    this.withName = false,
    this.animate = true,
  });

  final double size;
  final bool withName;
  final bool animate;

  @override
  State<BrandMark> createState() => _BrandMarkState();
}

class _BrandMarkState extends State<BrandMark>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  bool _animationsDisabled = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 3400),
    );
    if (widget.animate) _controller.repeat();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final disabled =
        !widget.animate ||
        (MediaQuery.maybeOf(context)?.disableAnimations ?? false);
    if (disabled == _animationsDisabled) return;
    _animationsDisabled = disabled;
    if (disabled) {
      _controller
        ..stop()
        ..value = .45;
    } else {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final mark = RepaintBoundary(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) => CustomPaint(
          size: Size.square(widget.size),
          painter: _EclipsePainter(
            progress: _controller.value,
            showPulse: !_animationsDisabled,
          ),
        ),
      ),
    );
    if (!widget.withName) return mark;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        mark,
        const SizedBox(width: 10),
        Text(
          'Relayune',
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w800,
            letterSpacing: -0.8,
          ),
        ),
      ],
    );
  }
}

class _EclipsePainter extends CustomPainter {
  const _EclipsePainter({required this.progress, required this.showPulse});

  final double progress;
  final bool showPulse;

  static const _deepNight = Color(0xFF0B1220);
  static const _moonWhite = Color(0xFFF6F8F5);
  static const _lunarMint = Color(0xFF69E1D2);

  @override
  void paint(Canvas canvas, Size size) {
    final side = math.min(size.width, size.height);
    final tile = RRect.fromRectAndRadius(
      Offset.zero & Size.square(side),
      Radius.circular(side * .21875),
    );
    canvas.drawRRect(tile, Paint()..color = _deepNight);

    final center = Offset(side / 2, side / 2);
    final moonRadius = side * .30078;
    final moon = Path()
      ..addOval(Rect.fromCircle(center: center, radius: moonRadius));
    canvas.drawPath(moon, Paint()..color = _moonWhite);

    final channel = Path()
      ..moveTo(side * .14648, side * .61133)
      ..cubicTo(
        side * .29102,
        side * .26953,
        side * .42285,
        side * .27148,
        side * .5,
        side * .5,
      )
      ..cubicTo(
        side * .57715,
        side * .72852,
        side * .70898,
        side * .73047,
        side * .85352,
        side * .38867,
      );
    canvas.drawPath(
      channel,
      Paint()
        ..color = _deepNight
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeWidth = side * .12109,
    );

    if (!showPulse) return;
    canvas.save();
    canvas.clipPath(moon);
    final metric = channel.computeMetrics().first;
    final pulseLength = metric.length * .1;
    final start = metric.length * progress;
    final end = start + pulseLength;
    final pulse = Path();
    if (end <= metric.length) {
      pulse.addPath(metric.extractPath(start, end), Offset.zero);
    } else {
      pulse
        ..addPath(metric.extractPath(start, metric.length), Offset.zero)
        ..addPath(metric.extractPath(0, end - metric.length), Offset.zero);
    }
    canvas.drawPath(
      pulse,
      Paint()
        ..color = _lunarMint
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeWidth = side * .01758,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _EclipsePainter oldDelegate) =>
      progress != oldDelegate.progress || showPulse != oldDelegate.showPulse;
}
