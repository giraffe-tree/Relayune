import 'dart:convert';
import '../models.dart';

/// A checkpoint includes partial batch progress. The revision advances only
/// after the final page, so a retry/restart cannot skip unseen changes.
class SessionDirectory {
  final Map<String, RelaySession> sessions = {};
  List<RelayProject> projects = [];
  String? observedAt;
  String? revision;
  String? cursor;
  String? _pendingRevision;

  bool apply(Map<String, dynamic> page) {
    final target = page['revision'];
    final observed = page['observed_at'];
    final next = page['next_cursor'];
    final rows = page['sessions'];
    final removed = page['removed_ids'];
    final reset = page['reset'];
    if (observed is! String ||
        DateTime.tryParse(observed) == null ||
        page['version'] != 1 ||
        target is! String ||
        target.isEmpty ||
        target.length > 80 ||
        (next != null &&
            (next is! String || next.length > 512 || next == cursor)) ||
        rows is! List ||
        rows.length > 300 ||
        removed is! List ||
        removed.length > 300 ||
        reset is! bool ||
        (reset == false && cursor != null && _pendingRevision != target)) {
      throw const FormatException('invalid_session_directory');
    }
    final incoming = rows.map((row) {
      if (row is! Map ||
          row['id'] is! String ||
          row['provider'] is! String ||
          row['cwd'] is! String ||
          row['is_subagent'] == true) {
        throw const FormatException('invalid_session_directory');
      }
      return RelaySession.fromJson(Map<String, dynamic>.from(row));
    }).toList();
    if (removed.any((id) => id is! String)) {
      throw const FormatException('invalid_session_directory');
    }
    final nextSessions = reset
        ? <String, RelaySession>{}
        : Map<String, RelaySession>.of(sessions);
    for (final id in removed) {
      nextSessions.remove(id);
    }
    for (final session in incoming) {
      nextSessions[session.id] = session;
    }
    if (nextSessions.length > 300) {
      throw const FormatException('invalid_session_directory');
    }
    var nextProjects = reset ? <RelayProject>[] : projects;
    if (page.containsKey('projects')) {
      if (page['projects'] is! List ||
          (page['projects'] as List).length > 2000) {
        throw const FormatException('invalid_session_directory');
      }
      nextProjects = (page['projects'] as List)
          .map(
            (p) => RelayProject.fromJson(Map<String, dynamic>.from(p as Map)),
          )
          .toList();
    }
    final before = jsonEncode(toJson());
    observedAt = observed;
    sessions
      ..clear()
      ..addAll(nextSessions);
    projects = nextProjects;
    if (reset) revision = null;
    cursor = next as String?;
    _pendingRevision = next == null ? null : target;
    if (next == null) revision = target;
    return before != jsonEncode(toJson());
  }

  Map<String, dynamic> toJson() => {
    'observed_at': observedAt,
    'revision': revision,
    'cursor': cursor,
    'pending_revision': _pendingRevision,
    'sessions': sessions.values.map((s) => s.raw).toList(),
    'projects': projects
        .map(
          (p) => {
            'id': p.id,
            'provider': p.provider,
            'name': p.name,
            'cwd': p.cwd,
            'updated_at': p.updatedAt,
          },
        )
        .toList(),
  };

  factory SessionDirectory.fromJson(Map<String, dynamic> json) {
    final result = SessionDirectory();
    final rows = json['sessions'];
    final saved = json['projects'];
    if (rows is! List ||
        rows.length > 300 ||
        saved is! List ||
        saved.length > 2000) {
      throw const FormatException('invalid_session_directory');
    }
    result.observedAt = json['observed_at'] as String?;
    result.revision = json['revision'] as String?;
    result.cursor = json['cursor'] as String?;
    result._pendingRevision = json['pending_revision'] as String?;
    for (final row in rows) {
      final s = RelaySession.fromJson(Map<String, dynamic>.from(row as Map));
      result.sessions[s.id] = s;
    }
    result.projects = saved
        .map((p) => RelayProject.fromJson(Map<String, dynamic>.from(p as Map)))
        .toList();
    return result;
  }
  SessionDirectory();
}
