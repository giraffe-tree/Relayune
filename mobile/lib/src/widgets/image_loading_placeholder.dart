import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../l10n/relayune_localizations.dart';
import '../network/relay_api.dart';

const _imageSvg = '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none">
  <circle cx="29" cy="11" r="3" stroke="#61776a" stroke-width="1.3"/>
  <path d="M5 30l10-13 9 12m-3-4 6-6 8 11" stroke="#61776a" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
''';

const _waitSvg = '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none">
  <path d="M8 11V8a3 3 0 0 1 3-3h18a3 3 0 0 1 3 3v3" stroke="#82918a" stroke-opacity=".35" stroke-width="1.2"/>
  <rect x="5" y="12" width="30" height="23" rx="7" stroke="#9caea3" stroke-width="1.3"/>
  <path d="M17 20v7m6-7v7" stroke="#bdd0c2" stroke-width="2" stroke-linecap="round"/>
</svg>
''';

class ImageWaitSymbol extends StatelessWidget {
  const ImageWaitSymbol({super.key, this.size = 36});
  final double size;

  @override
  Widget build(BuildContext context) => SvgPicture.string(
    _waitSvg,
    width: size,
    height: size,
    excludeFromSemantics: true,
  );
}

/// Fixed artwork bounds, with distinct queued and actively loading treatments.
/// The moving light is decoration; only the byte-based bar represents progress.
class ImageLoadingPlaceholder extends StatefulWidget {
  const ImageLoadingPlaceholder({
    super.key,
    required this.progress,
    required this.indicatorKey,
  });

  final DownloadProgress? progress;
  final Key indicatorKey;

  @override
  State<ImageLoadingPlaceholder> createState() =>
      _ImageLoadingPlaceholderState();
}

class _ImageLoadingPlaceholderState extends State<ImageLoadingPlaceholder>
    with SingleTickerProviderStateMixin {
  late final _motion = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2600),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context) || !TickerMode.of(context)) {
      _motion
        ..stop()
        ..value = .5;
    } else if (!_motion.isAnimating) {
      _motion.repeat();
    }
  }

  @override
  void dispose() {
    _motion.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final waiting = widget.progress?.waiting ?? false;
    final fraction = widget.progress?.fraction;
    final copy = context.l10n;
    final status = waiting
        ? copy.workbenchImageWaiting
        : fraction == 1
        ? copy.workbenchProcessing
        : copy.workbenchImageLoading;
    final amount = fraction != null
        ? '${(fraction * 100).floor()}%'
        : (widget.progress?.receivedBytes ?? 0) == 0
        ? '0%'
        : '${(widget.progress!.receivedBytes / 1024).toStringAsFixed(1)} KB';
    return Semantics(
      label: status,
      value: waiting ? null : amount,
      child: ExcludeSemantics(
        child: RepaintBoundary(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(9),
            child: SizedBox.square(
              dimension: 120,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: const Color(0xFF181C1B),
                  borderRadius: BorderRadius.circular(9),
                  border: Border.all(color: const Color(0xFF303834)),
                ),
                child: Stack(
                  children: [
                    if (!waiting)
                      Positioned.fill(
                        child: CustomPaint(
                          key: const ValueKey('image-loading-sweep'),
                          painter: _SoftLightPainter(_motion),
                        ),
                      ),
                    Positioned(
                      top: 23,
                      left: 0,
                      right: 0,
                      child: waiting
                          ? AnimatedBuilder(
                              animation: _motion,
                              child: const ImageWaitSymbol(
                                key: ValueKey('image-wait-svg'),
                              ),
                              builder: (context, child) => Opacity(
                                opacity:
                                    .72 +
                                    .20 * math.cos(_motion.value * math.pi * 2),
                                child: child,
                              ),
                            )
                          : SvgPicture.string(
                              _imageSvg,
                              width: 36,
                              height: 36,
                              excludeFromSemantics: true,
                            ),
                    ),
                    Positioned(
                      left: 12,
                      right: 12,
                      bottom: waiting ? 19 : 14,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Flexible(
                                child: Text(
                                  status,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Color(0xFFA3B0A8),
                                    fontSize: 10,
                                  ),
                                ),
                              ),
                              if (!waiting) ...[
                                const SizedBox(width: 5),
                                Flexible(
                                  child: Text(
                                    amount,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Color(0xFFCCD6CF),
                                      fontSize: 10,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                          if (!waiting) ...[
                            const SizedBox(height: 8),
                            LinearProgressIndicator(
                              key: widget.indicatorKey,
                              value: fraction ?? 0,
                              minHeight: 3,
                              borderRadius: BorderRadius.circular(2),
                              color: const Color(0xFF8AAF9A),
                              backgroundColor: const Color(0xFF303C35),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SoftLightPainter extends CustomPainter {
  _SoftLightPainter(this.motion) : super(repaint: motion);
  final Animation<double> motion;

  @override
  void paint(Canvas canvas, Size size) {
    final center = (-.7 + 2.4 * motion.value) * size.width;
    final beam = Rect.fromLTWH(
      center - size.width * .55,
      0,
      size.width * 1.1,
      size.height,
    );
    final paint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          Color(0x00181C1B),
          Color(0x187FA78A),
          Color(0x247FA78A),
          Color(0x00181C1B),
        ],
        stops: [0, .4, .53, 1],
      ).createShader(beam);
    canvas.drawRect(Offset.zero & size, paint);
  }

  @override
  bool shouldRepaint(_SoftLightPainter oldDelegate) =>
      oldDelegate.motion != motion;
}
