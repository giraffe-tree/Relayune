import 'package:flutter/material.dart';

/// Retains the last subtree while another route covers it. Route visibility
/// itself is an inherited dependency, so returning rebuilds with current data.
class VisibleRouteBuilder extends StatefulWidget {
  const VisibleRouteBuilder({
    super.key,
    this.listenable,
    required this.builder,
  });

  final Listenable? listenable;
  final WidgetBuilder builder;

  @override
  State<VisibleRouteBuilder> createState() => _VisibleRouteBuilderState();
}

class _VisibleRouteBuilderState extends State<VisibleRouteBuilder> {
  Widget? _child;

  Widget _buildVisible(BuildContext context) {
    if ((ModalRoute.isCurrentOf(context) ?? true) || _child == null) {
      _child = widget.builder(context);
    }
    return _child!;
  }

  @override
  Widget build(BuildContext context) => widget.listenable == null
      ? _buildVisible(context)
      : ListenableBuilder(
          listenable: widget.listenable!,
          builder: (context, _) => _buildVisible(context),
        );
}
