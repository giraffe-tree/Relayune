import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

const _runningStatusSvg = '''
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3a9 9 0 1 1-6.36 2.64" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
  <path d="M4 3v5h5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="12" cy="12" r="2.25" fill="#fff"/>
</svg>
''';

class AnimatedRunningStatusIcon extends StatefulWidget {
  const AnimatedRunningStatusIcon({
    super.key,
    required this.size,
    required this.color,
    this.iconKey,
  });

  final double size;
  final Color color;
  final Key? iconKey;

  @override
  State<AnimatedRunningStatusIcon> createState() =>
      _AnimatedRunningStatusIconState();
}

class _AnimatedRunningStatusIconState extends State<AnimatedRunningStatusIcon>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1250),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final animationsDisabled =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (animationsDisabled) {
      _controller
        ..stop()
        ..value = .16;
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: widget.size,
    child: RotationTransition(
      turns: _controller,
      child: SvgPicture.string(
        _runningStatusSvg,
        key: widget.iconKey,
        width: widget.size,
        height: widget.size,
        colorFilter: ColorFilter.mode(widget.color, BlendMode.srcIn),
      ),
    ),
  );
}
