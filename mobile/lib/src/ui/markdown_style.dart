import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import 'theme.dart';

/// Shared by conversation messages, file previews, and expanded reminders.
MarkdownStyleSheet relayMarkdownStyle(BuildContext context) {
  final scale = MediaQuery.textScalerOf(context).scale(13) / 13;
  const cellStyle = TextStyle(fontSize: 13, height: 1.5, color: RelayTheme.ink);
  return MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
    tableColumnWidth: _ReadableTableColumnWidth(scale),
    tableScrollbarThumbVisibility: true,
    tablePadding: const EdgeInsets.only(bottom: 10),
    tableHead: cellStyle.copyWith(fontWeight: FontWeight.w600),
    tableBody: cellStyle,
    tableHeadAlign: TextAlign.start,
    tableCellsPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    tableHeadCellsPadding: const EdgeInsets.symmetric(
      horizontal: 12,
      vertical: 10,
    ),
    tableHeadCellsDecoration: const BoxDecoration(
      color: RelayTheme.panelRaised,
    ),
    tableCellsDecoration: const BoxDecoration(color: RelayTheme.panelSoft),
    tableBorder: TableBorder.all(
      color: RelayTheme.line,
      borderRadius: BorderRadius.circular(6),
    ),
    tableVerticalAlignment: TableCellVerticalAlignment.top,
  );
}

/// IntrinsicColumnWidth also enables the renderer's per-table scroll view.
/// Keep short columns compact and cap prose/URLs so they wrap instead of
/// creating an arbitrarily wide table. Widths follow accessibility text size.
class _ReadableTableColumnWidth extends IntrinsicColumnWidth {
  const _ReadableTableColumnWidth(this.scale);

  final double scale;

  double _bounded(double width) => width.clamp(88 * scale, 240 * scale);

  @override
  double minIntrinsicWidth(Iterable<RenderBox> cells, double containerWidth) =>
      _bounded(super.minIntrinsicWidth(cells, containerWidth));

  @override
  double maxIntrinsicWidth(Iterable<RenderBox> cells, double containerWidth) =>
      _bounded(super.maxIntrinsicWidth(cells, containerWidth));
}
