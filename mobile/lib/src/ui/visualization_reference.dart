import 'dart:convert';

/// Host-only Codex markers are never useful as literal text on a phone.
/// This is display-only: a link can open only an already registered attachment.
String displayVisualizationReferences(
  String content, {
  required String label,
  bool links = true,
}) {
  String? fence;
  return content
      .split('\n')
      .map((line) {
        final delimiter = RegExp(
          r'^\s*(`{3,}|~{3,})',
        ).firstMatch(line)?.group(1);
        if (delimiter != null) {
          if (fence == null) {
            fence = delimiter;
          } else if (delimiter[0] == fence![0] &&
              delimiter.length >= fence!.length) {
            fence = null;
          }
          return line;
        }
        if (fence != null) return line;
        final marker = RegExp(
          r'^[ \t]*\uE200visualize(?:\uE202(.*?)(?:\uE201|$)|.*$)',
        ).firstMatch(line);
        if (marker == null) return line;
        final suffix = line.substring(marker.end);
        if (!links) return '$label$suffix';
        try {
          final reference = jsonDecode(marker.group(1) ?? '');
          final path = reference is Map ? reference['path'] : null;
          if (path is! String ||
              path.length > 4096 ||
              !RegExp(
                r'^(?:/|[A-Za-z]:[\\/]).*\.html?$',
                caseSensitive: false,
              ).hasMatch(path) ||
              RegExp(r'[\x00-\x1f<>]').hasMatch(path)) {
            return '$label$suffix';
          }
          return '[$label](<$path>)$suffix';
        } on FormatException {
          return '$label$suffix';
        }
      })
      .join('\n');
}
