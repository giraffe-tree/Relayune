/// Immutable metadata injected by tool/flutter.mjs when a build starts.
class BuildProvenance {
  const BuildProvenance({
    this.builtAt = const String.fromEnvironment('RELAYUNE_BUILT_AT'),
    this.sourceCommit = const String.fromEnvironment('RELAYUNE_SOURCE_COMMIT'),
    this.sourceDirty = const bool.fromEnvironment('RELAYUNE_SOURCE_DIRTY'),
  });

  final String builtAt;
  final String sourceCommit;
  final bool sourceDirty;

  String? get shortCommit => RegExp(r'^[0-9a-f]{40}$').hasMatch(sourceCommit)
      ? sourceCommit.substring(0, 7)
      : null;

  String? get localBuildTime {
    final parsed = DateTime.tryParse(builtAt);
    if (parsed == null || !builtAt.endsWith('Z')) return null;
    return formatBuildTime(parsed.toLocal());
  }

  static String formatBuildTime(DateTime time) {
    String two(int value) => value.toString().padLeft(2, '0');
    final offset = time.timeZoneOffset.inMinutes;
    final zone =
        '${offset < 0 ? '-' : '+'}'
        '${two(offset.abs() ~/ 60)}:${two(offset.abs() % 60)}';
    return '${time.year}-${two(time.month)}-${two(time.day)} '
        '${two(time.hour)}:${two(time.minute)}:${two(time.second)} UTC$zone';
  }
}
