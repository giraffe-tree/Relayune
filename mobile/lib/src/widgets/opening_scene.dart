import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../l10n/relayune_localizations.dart';
import 'brand_mark.dart';

const _seenKey = 'relayune.opening-seen.v1';
const _storage = FlutterSecureStorage();
Future<bool> _readSeen() async => await _storage.read(key: _seenKey) == 'true';
Future<void> _markSeen() => _storage.write(key: _seenKey, value: 'true');

/// An optional visual introduction. Its child is always mounted and interactive.
/// This preference is independent of account, pairing and credential restoration.
class OpeningScene extends StatefulWidget {
  const OpeningScene({
    super.key,
    required this.child,
    this.welcome = false,
    this.readSeen = _readSeen,
    this.markSeen = _markSeen,
  });

  final Widget child;
  final bool welcome;
  final Future<bool> Function() readSeen;
  final Future<void> Function() markSeen;

  @override
  State<OpeningScene> createState() => _OpeningSceneState();
}

class _OpeningSceneState extends State<OpeningScene>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final AnimationController _motion = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2800),
    value: widget.welcome ? 0 : 1,
  );
  bool _interacted = false;
  bool _reduceMotion = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (widget.welcome) unawaited(_prepare());
  }

  Future<void> _prepare() async {
    var seen = true;
    try {
      seen = await widget.readSeen().timeout(
        const Duration(milliseconds: 200),
        onTimeout: () => true,
      );
    } on Object {
      // Optional cosmetic storage must not delay or fail the login surface.
    }
    if (!mounted) return;
    final foreground = WidgetsBinding.instance.lifecycleState;
    if (seen ||
        _reduceMotion ||
        _interacted ||
        (foreground != null && foreground != AppLifecycleState.resumed)) {
      _motion.value = 1;
    } else {
      _motion.forward();
    }
    try {
      await widget.markSeen();
    } on Object {
      // The animation remains optional even when local storage is unavailable.
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduceMotion = MediaQuery.disableAnimationsOf(context);
    if (_reduceMotion || MediaQuery.viewInsetsOf(context).bottom > 0) _finish();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) _finish();
  }

  void _finish() {
    _interacted = true;
    _motion.value = 1;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _motion.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _OpeningMotion(
    animation: _motion,
    child: Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _finish(),
      child: Focus(
        onFocusChange: (focused) {
          if (focused) _finish();
        },
        child: Stack(
          fit: StackFit.expand,
          children: [
            Positioned.fill(
              child: IgnorePointer(
                child: ExcludeSemantics(
                  child: RepaintBoundary(
                    child: AnimatedBuilder(
                      animation: _motion,
                      child: Image.asset(
                        'assets/opening/night-sea.webp',
                        fit: BoxFit.cover,
                        alignment: const Alignment(0, -.15),
                        gaplessPlayback: true,
                        errorBuilder: (_, _, _) =>
                            const ColoredBox(color: Color(0xFF0B1220)),
                      ),
                      builder: (context, image) => ClipRect(
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            Transform.scale(
                              scale:
                                  1.035 -
                                  .035 *
                                      Curves.easeOut.transform(_motion.value),
                              child: image,
                            ),
                            const DecoratedBox(
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  begin: Alignment.topCenter,
                                  end: Alignment.bottomCenter,
                                  colors: [
                                    Color(0x330B1220),
                                    Color(0x660B1220),
                                    Color(0xF20B1220),
                                    Color(0xFF0B1220),
                                  ],
                                  stops: [0, .32, .7, 1],
                                ),
                              ),
                            ),
                            CustomPaint(painter: _SignalPainter(_motion.value)),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            widget.child,
            if (widget.welcome)
              PositionedDirectional(
                top: MediaQuery.paddingOf(context).top + 4,
                end: 16,
                child: AnimatedBuilder(
                  animation: _motion,
                  builder: (context, _) => _motion.value < 1 && !_reduceMotion
                      ? TextButton(
                          onPressed: _finish,
                          style: TextButton.styleFrom(
                            foregroundColor: const Color(0xFFD2E0E5),
                            backgroundColor: const Color(0x990B1220),
                            minimumSize: const Size(48, 44),
                          ),
                          child: Text(context.l10n.openingSkip),
                        )
                      : const SizedBox.shrink(),
                ),
              ),
          ],
        ),
      ),
    ),
  );
}

class _OpeningMotion extends InheritedWidget {
  const _OpeningMotion({required this.animation, required super.child});
  final Animation<double> animation;
  @override
  bool updateShouldNotify(_OpeningMotion oldWidget) =>
      animation != oldWidget.animation;
}

class OpeningHero extends StatelessWidget {
  const OpeningHero({super.key});

  @override
  Widget build(BuildContext context) {
    final motion =
        context
            .dependOnInheritedWidgetOfExactType<_OpeningMotion>()
            ?.animation ??
        const AlwaysStoppedAnimation(1.0);
    return Column(
      children: [
        AnimatedBuilder(
          animation: motion,
          child: const BrandMark(size: 66, animate: false),
          builder: (context, mark) {
            final arrival = const Interval(
              .18,
              1,
              curve: Curves.easeOutCubic,
            ).transform(motion.value);
            return Transform.translate(
              offset: Offset(0, 30 * (1 - arrival)),
              child: Transform.scale(
                scale: 1.5 - .5 * arrival,
                child: Opacity(opacity: arrival, child: mark),
              ),
            );
          },
        ),
        const SizedBox(height: 16),
        const Text(
          'Relayune',
          style: TextStyle(
            color: Color(0xFFC7D9DF),
            fontSize: 12,
            letterSpacing: 3,
          ),
        ),
        const SizedBox(height: 20),
        Text(
          context.l10n.openingTitle,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Color(0xFFF6F8F5),
            fontSize: 30,
            fontWeight: FontWeight.w300,
            height: 1.3,
            letterSpacing: -.8,
          ),
        ),
        const SizedBox(height: 10),
        Text(
          context.l10n.openingSubtitle,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Color(0xFFBDCED8),
            fontSize: 13,
            height: 1.6,
          ),
        ),
      ],
    );
  }
}

class _SignalPainter extends CustomPainter {
  const _SignalPainter(this.progress);
  final double progress;
  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= .12 || progress >= .65) return;
    final t = ((progress - .12) / .53).clamp(0.0, 1.0);
    final x = size.width * (.06 + .44 * Curves.easeOut.transform(t));
    final y = size.height * .38;
    final alpha = math.sin(t * math.pi) * .8;
    final rect = Rect.fromLTWH(x - 65, y, 65, 1);
    canvas.drawRect(
      rect,
      Paint()
        ..shader = LinearGradient(
          colors: [
            const Color(0x0069E1D2),
            Color.fromRGBO(183, 248, 232, alpha),
          ],
        ).createShader(rect),
    );
    canvas.drawCircle(
      Offset(x, y),
      3,
      Paint()
        ..color = Color.fromRGBO(105, 225, 210, alpha)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5),
    );
  }

  @override
  bool shouldRepaint(_SignalPainter oldDelegate) =>
      progress != oldDelegate.progress;
}
