import '../models.dart';
import 'session_projects.dart';

/// One catalog pass and at most six ranked entries, regardless of catalog size.
class HomeSessions {
  HomeSessions({
    required List<RelaySession> sessions,
    required List<RelayApproval> approvals,
    required bool online,
    required bool Function(RelayApproval) isPending,
    required bool Function(RelaySession) isUnread,
  }) {
    final roots = {
      for (final session in sessions) session.id: session.rootSessionId,
    };
    if (online) {
      for (final approval in approvals) {
        if (!isPending(approval)) continue;
        final root = roots[approval.sessionId] ?? approval.sessionId;
        pendingByRoot.update(root, (count) => count + 1, ifAbsent: () => 1);
      }
    }
    final ranked = <({RelaySession session, int priority, int activity})>[];
    for (final session in sessions) {
      if (session.isSubagent) continue;
      final unread = isUnread(session);
      if (unread) unreadIds.add(session.id);
      final priority = (pendingByRoot[session.rootSessionId] ?? 0) > 0
          ? 0
          : session.status == 'active'
          ? 1
          : unread
          ? 2
          : 3;
      ranked.add((
        session: session,
        priority: priority,
        activity: sessionActivity(session),
      ));
      ranked.sort((left, right) {
        var order = left.priority.compareTo(right.priority);
        if (order == 0) order = right.activity.compareTo(left.activity);
        if (order == 0) {
          order = left.session.name.toLowerCase().compareTo(
            right.session.name.toLowerCase(),
          );
        }
        return order != 0 ? order : left.session.id.compareTo(right.session.id);
      });
      if (ranked.length > 5) ranked.removeLast();
    }
    recent = ranked.map((entry) => entry.session).toList(growable: false);
  }

  late final List<RelaySession> recent;
  final Map<String, int> pendingByRoot = {};
  final Set<String> unreadIds = {};
}
