import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show SelectedContent;
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import 'mermaid_diagram.dart';

/// Reuses completed paragraphs during character reveal. The unfinished suffix
/// still uses the normal Markdown renderer, so streaming keeps rich formatting.
/// Completion always returns to one document (including reference resolution).
class IncrementalMarkdownBody extends StatefulWidget {
  const IncrementalMarkdownBody({
    super.key,
    required this.data,
    required this.streaming,
    required this.styleSheet,
    this.onTapLink,
  });

  final String data;
  final bool streaming;
  final MarkdownStyleSheet styleSheet;
  final MarkdownTapLinkCallback? onTapLink;

  // Lists/code/reference documents may have no safe paragraph boundary. Limit
  // reparsing of large growing blocks while keeping final rendering immediate.
  static const largeDocumentCharacters = 8000;
  static const largeDocumentInterval = Duration(milliseconds: 160);

  @override
  State<IncrementalMarkdownBody> createState() =>
      _IncrementalMarkdownBodyState();
}

class _IncrementalMarkdownBodyState extends State<IncrementalMarkdownBody> {
  final _selection = _MarkdownSelectionDelegate();
  final List<({String data, Widget body})> _blocks = [];
  Timer? _renderTimer;
  late String _displayedData;
  String? _partsSource;
  List<String> _parts = [];

  @override
  void initState() {
    super.initState();
    _displayedData = widget.data;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _blocks.clear();
    _partsSource = null;
  }

  @override
  void didUpdateWidget(IncrementalMarkdownBody oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.styleSheet != widget.styleSheet ||
        oldWidget.streaming != widget.streaming) {
      _blocks.clear();
      _partsSource = null;
      _renderTimer?.cancel();
      _renderTimer = null;
      _displayedData = widget.data;
    } else if (!widget.streaming ||
        widget.data.length < IncrementalMarkdownBody.largeDocumentCharacters) {
      _renderTimer?.cancel();
      _renderTimer = null;
      _displayedData = widget.data;
    } else if (_displayedData != widget.data) {
      // Read the newest value at the deadline, never enqueue old text frames.
      _renderTimer ??= Timer(IncrementalMarkdownBody.largeDocumentInterval, () {
        _renderTimer = null;
        if (mounted) setState(() => _displayedData = widget.data);
      });
    }
  }

  @override
  void dispose() {
    _renderTimer?.cancel();
    _selection.dispose();
    super.dispose();
  }

  void _onTapLink(String text, String? href, String title) =>
      widget.onTapLink?.call(text, href, title);

  @override
  Widget build(BuildContext context) {
    if (_partsSource != _displayedData) {
      _partsSource = _displayedData;
      _parts = widget.streaming
          ? streamingMarkdownBlocks(_displayedData)
          : [_displayedData];
    }
    final parts = _parts;
    if (_blocks.length > parts.length) {
      _blocks.removeRange(parts.length, _blocks.length);
    }
    for (var i = 0; i < parts.length; i++) {
      if (i < _blocks.length && _blocks[i].data == parts[i]) continue;
      final block = (
        data: parts[i],
        body: MarkdownBody(
          data: parts[i],
          // Share selection across the message instead of creating an
          // EditableText, focus node and nested scrollable for every paragraph.
          selectable: false,
          builders: {
            'pre': MermaidBlockBuilder(
              streaming: widget.streaming,
              styleSheet: widget.styleSheet,
              selectable: false,
            ),
          },
          styleSheet: widget.styleSheet,
          onTapLink: _onTapLink,
        ),
      );
      if (i == _blocks.length) {
        _blocks.add(block);
      } else {
        _blocks[i] = block;
      }
    }
    return SelectionArea(
      child: SelectionContainer(
        delegate: _selection,
        child: _blocks.length == 1
            ? _blocks.single.body
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var i = 0; i < _blocks.length; i++) ...[
                    if (i > 0)
                      SizedBox(height: widget.styleSheet.blockSpacing ?? 8),
                    _blocks[i].body,
                  ],
                ],
              ),
      ),
    );
  }
}

// Each rich-text leaf is a paragraph, heading, list entry or table cell.
// Flutter's default delegate concatenates leaves without separators, joining
// words across paragraph boundaries when selecting more than one block.
class _MarkdownSelectionDelegate extends StaticSelectionContainerDelegate {
  @override
  SelectedContent? getSelectedContent() {
    final parts = [
      for (final selectable in selectables)
        if (selectable.getSelectedContent() case final SelectedContent content)
          if (content.plainText.isNotEmpty) content.plainText,
    ];
    return parts.isEmpty ? null : SelectedContent(plainText: parts.join('\n'));
  }
}

final _blankLine = RegExp(r'\n[ \t]*\n');
// A blank line need not end a list, quote, fenced/indented code or HTML block.
// Keep that block and the remaining suffix in one parser rather than guessing
// at nested Markdown boundaries. Tables and setext headings stay in their
// paragraph because neither permits an internal blank line.
final _complexLine = RegExp(
  r'^(?: {0,3}(?:>|`{3,}|~{3,}|[-+*][ \t]|\d+[.)][ \t]|<)| {4}|\t)',
  multiLine: true,
);
final _referenceDefinition = RegExp(r'^ {0,3}\[[^\]\n]+\]:', multiLine: true);

@visibleForTesting
List<String> streamingMarkdownBlocks(String data) {
  // Definitions may affect earlier paragraphs; preserve document-wide scope.
  if (_referenceDefinition.hasMatch(data)) return [data];
  final parts = <String>[];
  var start = 0;
  for (final boundary in _blankLine.allMatches(data)) {
    final candidate = data.substring(start, boundary.start);
    if (_complexLine.hasMatch(candidate)) break;
    if (candidate.trim().isNotEmpty) parts.add(candidate);
    start = boundary.end;
  }
  final suffix = data.substring(start);
  if (suffix.trim().isNotEmpty || parts.isEmpty) parts.add(suffix);
  return parts;
}
