import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

// Eclipse Relay's circular moon and open channel, without its app-icon tile.
const _moonSvg = '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><mask id="moon"><circle cx="256" cy="256" r="154" fill="white"/>
  <path d="M75 313C149 138 216.5 139 256 256s107 118 181-57" fill="none" stroke="black" stroke-linecap="round" stroke-width="62"/></mask></defs>
  <circle cx="256" cy="256" r="154" fill="white" mask="url(#moon)"/>
</svg>
''';

class WaitingStatusIcon extends StatefulWidget {
  const WaitingStatusIcon({super.key, required this.color});

  final Color color;

  @override
  State<WaitingStatusIcon> createState() => _WaitingStatusIconState();
}

class _WaitingStatusIconState extends State<WaitingStatusIcon>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2800),
  );
  late final CurvedAnimation _turns = CurvedAnimation(
    parent: _controller,
    curve: Curves.easeInOutCubic,
  );

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncAnimation();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) => _syncAnimation();

  void _syncAnimation() {
    final reduced = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    final visible = lifecycle == null || lifecycle == AppLifecycleState.resumed;
    if (!reduced && visible && TickerMode.of(context)) {
      if (!_controller.isAnimating) _controller.repeat();
    } else {
      _controller.stop();
      if (reduced) _controller.value = 0;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _turns.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: RepaintBoundary(
      child: RotationTransition(
        turns: _turns,
        child: SvgPicture.string(
          _moonSvg,
          width: 28,
          height: 28,
          colorFilter: ColorFilter.mode(widget.color, BlendMode.srcIn),
        ),
      ),
    ),
  );
}
