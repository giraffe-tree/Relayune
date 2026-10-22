import '../models.dart';

class SessionProjectGroup {
  const SessionProjectGroup({
    required this.key,
    required this.title,
    required this.path,
    required this.sessions,
    required this.projectSession,
  });

  final String key;
  final String title;
  final String path;
  final List<RelaySession> sessions;
  final RelaySession projectSession;

  int get latestActivity => sessions.fold<int>(
    sessionActivity(projectSession),
    (latest, session) =>
        latest > sessionActivity(session) ? latest : sessionActivity(session),
  );
}

String canonicalProjectPath(String input) {
  final normalized = input.trim().replaceAll('\\', '/');
  if (normalized.isEmpty) return '';
  final driveMatch = RegExp(r'^[A-Za-z]:').firstMatch(normalized);
  final drive = driveMatch?.group(0)?.toLowerCase() ?? '';
  final absolute = normalized.startsWith('/') || drive.isNotEmpty;
  final segments = <String>[];
  for (final segment in normalized.split('/')) {
    if (segment.isEmpty || segment == '.' || segment == driveMatch?.group(0)) {
      continue;
    }
    if (segment == '..') {
      if (segments.isNotEmpty && segments.last != '..') {
        segments.removeLast();
      } else if (!absolute) {
        segments.add(segment);
      }
      continue;
    }
    segments.add(segment);
  }
  final body = segments.join('/');
  if (drive.isNotEmpty) return body.isEmpty ? '$drive/' : '$drive/$body';
  if (absolute) return body.isEmpty ? '/' : '/$body';
  return body;
}

List<SessionProjectGroup> groupRootSessionsByProject(
  Iterable<RelaySession> input, {
  Map<String, String> aliases = const {},
}) {
  final grouped = <String, List<RelaySession>>{};
  for (final session in input.where((item) => !item.isSubagent)) {
    final path = canonicalProjectPath(session.cwd);
    final project = session.project.trim();
    final key = path.isNotEmpty
        ? 'path:$path'
        : project.isNotEmpty
        ? 'project:${session.provider}:${project.toLowerCase()}'
        : 'session:${session.id}';
    grouped.putIfAbsent(key, () => []).add(session);
  }

  final result = grouped.entries.map((entry) {
    // Parse each timestamp once, rather than for every sort comparison.
    final activity = {
      for (final session in entry.value) session: sessionActivity(session),
    };
    final sessions = [...entry.value]
      ..sort((left, right) {
        final order = activity[right]!.compareTo(activity[left]!);
        return order != 0 ? order : _compareSessionNames(left, right);
      });
    final first = sessions.first;
    final path = canonicalProjectPath(first.cwd);
    return SessionProjectGroup(
      key: entry.key,
      title: aliases[entry.key]?.trim().isNotEmpty == true
          ? aliases[entry.key]!.trim()
          : first.project.trim().isNotEmpty
          ? first.project.trim()
          : _pathBasename(path).isNotEmpty
          ? _pathBasename(path)
          : '未命名项目',
      path: path,
      sessions: sessions,
      projectSession: first,
    );
  }).toList();

  _sortProjectGroups(result);
  return result;
}

/// Shows only projects and sessions owned by the selected local agent. Saved
/// projects can exist before their first session, so they are merged by path
/// with the selected provider's session-derived projects.
List<SessionProjectGroup> groupProviderSessionsByKnownProject(
  Iterable<RelaySession> input,
  String provider, {
  Iterable<RelayProject> projects = const [],
  Map<String, String> aliases = const {},
}) {
  final groups = {
    for (final group in groupRootSessionsByProject(
      input.where(
        (session) => !session.isSubagent && session.provider == provider,
      ),
      aliases: aliases,
    ))
      group.key: group,
  };
  for (final project in projects.where(
    (project) => project.provider == provider,
  )) {
    final path = canonicalProjectPath(project.cwd);
    if (path.isEmpty) continue;
    final key = 'path:$path';
    final existing = groups[key];
    final target = project.asSessionTarget();
    groups[key] = SessionProjectGroup(
      key: key,
      title: aliases[key]?.trim().isNotEmpty == true
          ? aliases[key]!.trim()
          : project.name.trim().isNotEmpty
          ? project.name.trim()
          : _pathBasename(path),
      path: path,
      sessions: existing?.sessions ?? const <RelaySession>[],
      projectSession: existing?.projectSession ?? target,
    );
  }
  final result = groups.values.toList();
  _sortProjectGroups(result);
  return result;
}

void _sortProjectGroups(List<SessionProjectGroup> groups) {
  // A comparison must not scan every session in both projects again.
  final activity = {for (final group in groups) group: group.latestActivity};
  groups.sort((left, right) {
    final order = activity[right]!.compareTo(activity[left]!);
    if (order != 0) return order;
    final title = left.title.toLowerCase().compareTo(right.title.toLowerCase());
    return title != 0 ? title : left.key.compareTo(right.key);
  });
}

int compareSessions(RelaySession left, RelaySession right) {
  final activity = sessionActivity(right).compareTo(sessionActivity(left));
  if (activity != 0) return activity;
  return _compareSessionNames(left, right);
}

int _compareSessionNames(RelaySession left, RelaySession right) {
  final name = left.name.toLowerCase().compareTo(right.name.toLowerCase());
  return name != 0 ? name : left.id.compareTo(right.id);
}

int sessionActivity(RelaySession session) =>
    DateTime.tryParse(session.updatedAt)?.millisecondsSinceEpoch ?? 0;

String formatSessionTimestamp(String iso, {DateTime? now}) {
  final parsed = DateTime.tryParse(iso)?.toLocal();
  if (parsed == null) return '';
  final reference = now ?? DateTime.now();
  String two(int value) => value.toString().padLeft(2, '0');
  final time = '${two(parsed.hour)}:${two(parsed.minute)}';
  final sameDay =
      parsed.year == reference.year &&
      parsed.month == reference.month &&
      parsed.day == reference.day;
  if (sameDay) return time;
  if (parsed.year == reference.year) {
    return '${two(parsed.month)}-${two(parsed.day)} $time';
  }
  return '${parsed.year}-${two(parsed.month)}-${two(parsed.day)}';
}

String _pathBasename(String path) {
  final segments = path.split('/').where((segment) => segment.isNotEmpty);
  return segments.isEmpty ? '' : segments.last;
}
