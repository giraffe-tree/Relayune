import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../ui/theme.dart';

/// A native paging gesture drives a shallow stack. Only the current photo and
/// its neighbours are built, so a long album never decodes every attachment.
class PhotoDeck extends StatefulWidget {
  const PhotoDeck({
    super.key,
    required this.ids,
    required this.itemBuilder,
    required this.onOpen,
    required this.onPageChanged,
    required this.semanticLabel,
    this.initialIndex = 0,
    this.aspectRatio = 1,
  });

  final List<String> ids;
  final Widget Function(BuildContext, int, Size) itemBuilder;
  final ValueChanged<int> onOpen;
  final ValueChanged<int> onPageChanged;
  final String Function(int) semanticLabel;
  final int initialIndex;
  final double aspectRatio;

  @override
  State<PhotoDeck> createState() => PhotoDeckState();
}

class PhotoDeckState extends State<PhotoDeck> {
  late final PageController _pages;
  late int _index;

  @override
  void initState() {
    super.initState();
    _index = widget.initialIndex.clamp(0, widget.ids.length - 1);
    _pages = PageController(initialPage: _index);
  }

  @override
  void didUpdateWidget(covariant PhotoDeck oldWidget) {
    super.didUpdateWidget(oldWidget);
    final id = oldWidget.ids[_index.clamp(0, oldWidget.ids.length - 1)];
    final found = widget.ids.indexOf(id);
    final next = found < 0 ? _index.clamp(0, widget.ids.length - 1) : found;
    if (next != _index) {
      _index = next;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _pages.hasClients) _pages.jumpToPage(_index);
      });
    }
  }

  void goTo(int index) {
    if (!_pages.hasClients) return;
    final target = index.clamp(0, widget.ids.length - 1);
    if (MediaQuery.disableAnimationsOf(context)) {
      _pages.jumpToPage(target);
    } else {
      _pages.animateToPage(
        target,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutCubic,
      );
    }
  }

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final rtl = Directionality.of(context) == TextDirection.rtl;
    final reduced = MediaQuery.disableAnimationsOf(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final ratio = widget.aspectRatio.clamp(.7, 1.5);
        final photoWidth = math.min(
          math.min(196.0, 220 * ratio),
          math.max(1.0, constraints.maxWidth - 20),
        );
        final photoSize = Size(photoWidth, photoWidth / ratio);
        final width = photoWidth + 20;
        return SizedBox(
          width: width,
          height: photoSize.height + 12,
          child: Stack(
            clipBehavior: Clip.hardEdge,
            children: [
              AnimatedBuilder(
                animation: _pages,
                builder: (context, _) {
                  final page =
                      _pages.hasClients && _pages.position.hasContentDimensions
                      ? (_pages.page ?? _index.toDouble())
                      : _index.toDouble();
                  final first = math.max(0, page.floor());
                  final last = math.min(widget.ids.length - 1, first + 2);
                  return Stack(
                    children: [
                      for (var i = last; i >= first; i--)
                        PositionedDirectional(
                          key: ValueKey(widget.ids[i]),
                          start: 0,
                          top: 0,
                          child: IgnorePointer(
                            child: ExcludeSemantics(
                              child: Builder(
                                builder: (context) {
                                  final relative = i - page;
                                  final depth = relative.clamp(0.0, 2.0);
                                  final x = relative < 0
                                      ? relative * width
                                      : depth * 10;
                                  return Transform.translate(
                                    offset: Offset(rtl ? -x : x, depth * 4),
                                    child: Transform.scale(
                                      scale: 1 - depth * .035,
                                      alignment: AlignmentDirectional.topStart
                                          .resolve(Directionality.of(context)),
                                      child: Transform.rotate(
                                        angle: reduced
                                            ? 0
                                            : depth * .009 * (rtl ? -1 : 1),
                                        child: Opacity(
                                          opacity: relative < 0
                                              ? (1 + relative).clamp(0.0, 1.0)
                                              : 1,
                                          child: RepaintBoundary(
                                            child: DecoratedBox(
                                              decoration: BoxDecoration(
                                                color: RelayTheme.panelRaised,
                                                borderRadius:
                                                    BorderRadius.circular(12),
                                              ),
                                              child: widget.itemBuilder(
                                                context,
                                                i,
                                                photoSize,
                                              ),
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  );
                                },
                              ),
                            ),
                          ),
                        ),
                    ],
                  );
                },
              ),
              Positioned.fill(
                child: PageView.builder(
                  key: const ValueKey('attachment-photo-deck-pager'),
                  controller: _pages,
                  itemCount: widget.ids.length,
                  onPageChanged: (index) {
                    setState(() => _index = index);
                    widget.onPageChanged(index);
                  },
                  itemBuilder: (context, index) => Semantics(
                    button: true,
                    label: widget.semanticLabel(index),
                    onIncrease: index < widget.ids.length - 1
                        ? () => goTo(index + 1)
                        : null,
                    onDecrease: index > 0 ? () => goTo(index - 1) : null,
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => widget.onOpen(index),
                      child: const SizedBox.expand(),
                    ),
                  ),
                ),
              ),
              PositionedDirectional(
                start: 8,
                bottom: 20,
                child: IgnorePointer(
                  child: ExcludeSemantics(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: Colors.black54,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 7,
                          vertical: 3,
                        ),
                        child: Text(
                          '${_index + 1} / ${widget.ids.length}',
                          key: const ValueKey('attachment-photo-position'),
                          style: const TextStyle(
                            fontSize: 11,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
