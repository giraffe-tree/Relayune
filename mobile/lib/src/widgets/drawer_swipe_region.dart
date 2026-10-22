import 'package:flutter/material.dart';

/// Opens navigation with a deliberate right swipe on otherwise unclaimed content.
/// Child horizontal scrollables retain priority in the gesture arena.
class DrawerSwipeRegion extends StatefulWidget {
  const DrawerSwipeRegion({super.key, required this.child});

  final Widget child;

  @override
  State<DrawerSwipeRegion> createState() => _DrawerSwipeRegionState();
}

class _DrawerSwipeRegionState extends State<DrawerSwipeRegion> {
  double _distance = 0;

  @override
  Widget build(BuildContext context) => GestureDetector(
    behavior: HitTestBehavior.translucent,
    onHorizontalDragStart: (_) => _distance = 0,
    onHorizontalDragUpdate: (details) => _distance += details.delta.dx,
    onHorizontalDragCancel: () => _distance = 0,
    onHorizontalDragEnd: (_) {
      if (_distance >= 64) {
        final scaffold = Scaffold.of(context);
        if (!scaffold.isDrawerOpen) scaffold.openDrawer();
      }
      _distance = 0;
    },
    child: widget.child,
  );
}
