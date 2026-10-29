import 'package:flutter/material.dart';

import 'mermaid_diagram.dart';

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
  Widget build(BuildContext context) {
    final enabled = !DiagramScrollRegion.isInteracting(context);
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onHorizontalDragStart: enabled ? (_) => _distance = 0 : null,
      onHorizontalDragUpdate: enabled
          ? (details) => _distance += details.delta.dx
          : null,
      onHorizontalDragCancel: enabled ? () => _distance = 0 : null,
      onHorizontalDragEnd: enabled
          ? (_) {
              if (_distance >= 64) {
                final scaffold = Scaffold.of(context);
                if (!scaffold.isDrawerOpen) scaffold.openDrawer();
              }
              _distance = 0;
            }
          : null,
      child: widget.child,
    );
  }
}
