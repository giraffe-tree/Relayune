import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/home_sessions.dart';

RelaySession session(String id, {String status = 'idle', String? root}) =>
    RelaySession.fromJson({
      'id': id,
      'name': id,
      'status': status,
      'root_session_id': root ?? id,
      'is_subagent': root != null,
      'updated_at': '2026-09-08T00:00:00Z',
    });

void main() {
  test(
    'home prioritizes child approvals, running and unread roots before recency ties',
    () {
      final sessions = [
        session('z-approval'),
        session('child', root: 'z-approval'),
        session('y-running', status: 'active'),
        session('x-unread'),
        session('c'),
        session('b'),
        session('a'),
      ];
      final approval = RelayApproval(
        id: 'approval',
        sessionId: 'child',
        action: const {},
        riskLevel: 'low',
        state: 'pending',
        requestedAt: '2026-09-08T00:00:00Z',
        expiresAt: '2099-01-01T00:00:00Z',
      );
      HomeSessions overview(bool online) => HomeSessions(
        sessions: sessions,
        approvals: [approval],
        online: online,
        isPending: (item) => item.state == 'pending',
        isUnread: (item) => item.id == 'x-unread',
      );
      final online = overview(true);
      expect(online.recent.map((s) => s.id), [
        'z-approval',
        'y-running',
        'x-unread',
        'a',
        'b',
      ]);
      expect(online.pendingByRoot, {'z-approval': 1});
      expect(online.unreadIds, {'x-unread'});
      expect(overview(false).recent.map((s) => s.id), [
        'y-running',
        'x-unread',
        'a',
        'b',
        'c',
      ]);
      expect(overview(false).pendingByRoot, isEmpty);
    },
  );
}
