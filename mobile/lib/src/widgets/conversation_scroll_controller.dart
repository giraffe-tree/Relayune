import 'package:flutter/widgets.dart';
import 'package:flutter/rendering.dart';

/// Keep the conversation tail anchored during layout, including late images.
class ConversationScrollController extends ScrollController {
  ConversationScrollController({
    super.initialScrollOffset,
    this.followsLatest = true,
    this.tailAtStart = false,
  });

  bool followsLatest;
  final bool tailAtStart;
  ConversationAnchorBox? _readingAnchor;
  double _anchorHeight = 0;
  double _anchorOffset = 0;
  double _anchorViewport = 0;
  int _anchorRevision = 0;

  /// Correct expansion layout before painting, instead of jumping a frame later.
  void preserveAnchor(
    ConversationAnchorBox anchor, {
    double removedHeight = 0,
  }) {
    assert(tailAtStart, 'Expansion anchoring is for reversed conversations.');
    if (!hasClients) return;
    final revision = ++_anchorRevision;
    _readingAnchor = anchor;
    _anchorHeight = anchor.layoutHeight;
    _anchorOffset = position.pixels;
    _anchorViewport = position.viewportDimension;
    followsLatest = false;
    final scrollPosition = position as _ConversationScrollPosition;
    scrollPosition.goIdle();
    // Keep the shrinking row within the lazy list's layout range.
    if (removedHeight > 0) {
      scrollPosition.correctPixels(
        (position.pixels - removedHeight).clamp(
          position.minScrollExtent,
          position.maxScrollExtent,
        ),
      );
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_anchorRevision == revision) {
        _readingAnchor = null;
      }
    });
  }

  double get latestOffset =>
      tailAtStart ? position.minScrollExtent : position.maxScrollExtent;

  double get distanceFromLatest =>
      tailAtStart ? position.extentBefore : position.extentAfter;

  @override
  ScrollPosition createScrollPosition(
    ScrollPhysics physics,
    ScrollContext context,
    ScrollPosition? oldPosition,
  ) => _ConversationScrollPosition(
    controller: this,
    physics: physics,
    context: context,
    oldPosition: oldPosition,
    initialPixels: initialScrollOffset,
  );
}

class _ConversationScrollPosition extends ScrollPositionWithSingleContext {
  _ConversationScrollPosition({
    required this.controller,
    required super.physics,
    required super.context,
    super.oldPosition,
    required super.initialPixels,
  });

  final ConversationScrollController controller;

  @override
  bool applyContentDimensions(double minScrollExtent, double maxScrollExtent) {
    final anchor = controller._readingAnchor;
    if (anchor != null && anchor.attached) {
      // In a reversed list, growing this row moves its title upward. A
      // shrink-wrapped viewport growing taller moves it downward instead.
      final shift =
          anchor.layoutHeight -
          controller._anchorHeight -
          (viewportDimension - controller._anchorViewport);
      final target = (controller._anchorOffset + shift).clamp(
        minScrollExtent,
        maxScrollExtent,
      );
      if ((pixels - target).abs() > .5) {
        correctPixels(target);
        return false;
      }
    }
    final extentChanged =
        !hasContentDimensions || maxScrollExtent != this.maxScrollExtent;
    final tail = controller.tailAtStart ? minScrollExtent : maxScrollExtent;
    if (controller.followsLatest &&
        extentChanged &&
        (pixels - tail).abs() > .5) {
      correctPixels(tail);
      return false;
    }
    return super.applyContentDimensions(minScrollExtent, maxScrollExtent);
  }
}

/// Exposes the completed layout height without reading another render object's
/// guarded size while the viewport is still laying out its slivers.
class ConversationSizeAnchor extends SingleChildRenderObjectWidget {
  const ConversationSizeAnchor({super.key, required super.child});

  @override
  ConversationAnchorBox createRenderObject(BuildContext context) =>
      ConversationAnchorBox();
}

class ConversationAnchorBox extends RenderProxyBox {
  double layoutHeight = 0;

  @override
  void performLayout() {
    super.performLayout();
    layoutHeight = size.height;
  }
}
