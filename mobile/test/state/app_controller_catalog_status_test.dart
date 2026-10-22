import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';

void main() {
  test('replacement receipt moves only its user message to the new turn', () {
    final controller = AppController();
    addTearDown(controller.dispose);
    controller.applyEventForTesting(_event('start', 'root', {'kind':'turn.started','turn_id':'old'}));
    controller.applyEventForTesting(_event('first', 'root', {'kind':'user.message','client_message_id':'first','text':'old'}));
    controller.applyEventForTesting(_event('replacement', 'root', {'kind':'user.message','client_message_id':'second','text':'new'}));
    controller.applyEventForTesting(_event('receipt', 'root', {'kind':'codex.persisted','operation':'turn','mode':'started','turn_id':'new','client_message_id':'second'}));
    final messages = controller.messages['root']!;
    expect(messages.where((m) => m.clientMessageId == 'first').single.turnId, 'old');
    expect(messages.where((m) => m.clientMessageId == 'second').single.turnId, 'new');
  });
  test('failed replacement marks the message failed without ending the running task', () {
    final controller = AppController();
    addTearDown(controller.dispose);
    controller.applyEventForTesting(_event('start', 'root', {'kind':'turn.started','turn_id':'old'}));
    controller.applyEventForTesting(_event('user', 'root', {'kind':'user.message','client_message_id':'new','text':'new instruction'}));
    controller.applyEventForTesting(_event('failure', 'root', {'kind':'message.failed','client_message_id':'new','error':'Stop unconfirmed'}));
    expect(controller.runningSessions, contains('root'));
    expect(controller.messages['root']!.where((m) => m.clientMessageId == 'new').single.deliveryState, MessageDeliveryState.failed);
    expect(controller.messages['root']!.any((m) => m.content == 'Stop unconfirmed'), isTrue);
  });

  test('foreground backlog cannot restart a turn older than an idle catalog', () {
    final controller = AppController();
    addTearDown(controller.dispose);
    controller.replaceSessionsForTesting([
      _session('root', status: 'idle'),
    ], catalogAt: DateTime.parse('2026-08-29T09:00:00Z'));
    for (final kind in ['turn.started', 'turn.steered']) {
      controller.applyEventForTesting(
        _event(kind, 'root', {'kind': kind, 'turn_id': 'old-turn'}),
      );
      expect(controller.runningSessions, isEmpty);
      expect(controller.sessionActivity('root'), isNull);
    }
    controller.applyEventForTesting(_event('text', 'root', {
      'kind': 'message.delta', 'turn_id': 'old-turn', 'text': 'offline reply',
    }));
    expect(controller.messages['root']!.single.content, 'offline reply');
    controller.applyEventForTesting(RelayEvent(
      cursor: 2, eventId: 'fresh-start', sessionId: 'root', agentId: null,
      createdAt: '2026-08-29T09:00:01Z',
      event: {'kind': 'turn.started', 'turn_id': 'new-turn'},
    ));
    expect(controller.runningSessions, contains('root'));
  });

  test('partial catalog does not settle an omitted running session', () {
    final controller = AppController();
    addTearDown(controller.dispose);
    controller.replaceSessionsForTesting([_session('root', status: 'idle')]);
    controller.activeSessionId = 'root';
    controller.replaceSessionsForTesting([
      _session('other', status: 'idle'),
    ], catalogAt: DateTime.parse('2026-08-29T09:00:00Z'));
    controller.applyEventForTesting(_event('start', 'root', {
      'kind': 'turn.started', 'turn_id': 'live',
    }));
    expect(controller.runningSessions, contains('root'));
  });

  test(
    'drawer activity follows live start and completion before the catalog',
    () {
      final controller = AppController();
      addTearDown(controller.dispose);
      controller.replaceSessionsForTesting([_session('root', status: 'idle')]);
      controller.applyEventForTesting(
        _event('start', 'root', {'kind': 'turn.started', 'turn_id': 'live'}),
      );
      expect(controller.sessionHasRunningAgent('root'), isTrue);
      controller.replaceSessionsForTesting([
        _session('root', status: 'active'),
      ]);
      controller.applyEventForTesting(
        _event('done', 'root', {'kind': 'turn.completed', 'turn_id': 'live'}),
      );
      expect(controller.sessionHasRunningAgent('root'), isFalse);
      controller.replaceSessionsForTesting([
        _session('root', status: 'active'),
      ], catalogAt: DateTime.parse('2026-08-29T07:59:59Z'));
      expect(controller.sessionHasRunningAgent('root'), isFalse);
      expect(controller.runningSessions, isEmpty);
    },
  );

  test('late older active catalog cannot resurrect a completed session', () {
    final controller = AppController();
    addTearDown(controller.dispose);
    controller.replaceSessionsForTesting([
      _session('root', status: 'idle'),
    ], catalogAt: DateTime.parse('2026-09-12T00:00:02Z'));
    controller.replaceSessionsForTesting([
      _session('root', status: 'active'),
    ], catalogAt: DateTime.parse('2026-09-12T00:00:01Z'));
    expect(controller.runningSessions, isEmpty);
    expect(controller.sessions.single.status, 'idle');
  });

  test(
    '[MOB-STA-006][flutter] stale catalog and old terminal cannot end a new turn',
    () {
      final controller = AppController();
      addTearDown(controller.dispose);
      final idle = _session('root', status: 'idle');
      controller.replaceSessionsForTesting([idle]);
      controller.applyEventForTesting(
        _event('start', 'root', {
          'kind': 'turn.started',
          'turn_id': 'new-turn',
        }),
      );
      for (final stamp in [null, DateTime.parse('2026-08-29T07:59:59Z')]) {
        controller.replaceSessionsForTesting([idle], catalogAt: stamp);
        expect(controller.runningSessions, contains('root'));
        expect(controller.sessionActivity('root'), isNotNull);
      }
      for (final kind in ['turn.completed', 'turn.failed']) {
        controller.applyEventForTesting(
          _event(kind, 'root', {'kind': kind, 'turn_id': 'old-turn'}),
        );
        expect(controller.runningSessions, contains('root'));
      }
      controller.applyEventForTesting(
        _event('done', 'root', {
          'kind': 'turn.completed',
          'turn_id': 'new-turn',
        }),
      );
      expect(controller.runningSessions, isEmpty);
    },
  );

  test(
    '[MOB-STA-006][flutter] newer idle catalog recovers a missed completion',
    () {
      final controller = AppController();
      addTearDown(controller.dispose);
      controller.applyEventForTesting(
        _event('start', 'root', {
          'kind': 'turn.started',
          'turn_id': 'new-turn',
        }),
      );
      controller.replaceSessionsForTesting([
        _session('root', status: 'idle'),
      ], catalogAt: DateTime.parse('2026-08-29T08:00:01Z'));
      expect(controller.runningSessions, isEmpty);
      expect(controller.sessionActivity('root'), isNull);
    },
  );

  test(
    '[MOB-STA-006][flutter] idle catalog clears stale root and child runtime activity',
    () {
      final controller = AppController();
      addTearDown(controller.dispose);
      controller.replaceSessionsForTesting([
        _session('root', status: 'active'),
        _session(
          'child',
          status: 'active',
          isSubagent: true,
          rootSessionId: 'root',
        ),
      ]);

      controller.applyEventForTesting(
        _event('root-command', 'root', {
          'kind': 'command.started',
          'turn_id': 'root-turn',
          'command': 'flutter test',
        }),
      );
      controller.applyEventForTesting(
        _event('child-message', 'child', {
          'kind': 'message.delta',
          'turn_id': 'child-turn',
          'text': 'Working',
        }),
      );
      expect(controller.sessionActivity('root'), '正在执行命令');
      expect(controller.sessionActivity('child'), '正在回复');

      controller.replaceSessionsForTesting([
        _session('root', status: 'idle'),
        _session(
          'child',
          status: 'active',
          isSubagent: true,
          rootSessionId: 'root',
        ),
      ]);

      expect(controller.runningSessions, isEmpty);
      expect(controller.sessionActivity('root'), isNull);
      expect(controller.sessionActivity('child'), isNull);
      expect(controller.sessionHasRunningAgent('root'), isFalse);

      controller.applyEventForTesting(
        _event('child-user-after-idle', 'child', {
          'kind': 'user.message',
          'text': 'after idle',
        }),
      );
      expect(controller.messages['child']!.last.turnId, isNull);
    },
  );

  test(
    '[MOB-STA-007][flutter] active catalog restores runtime after a terminal event',
    () {
      final controller = AppController();
      addTearDown(controller.dispose);
      final active = _session('root', status: 'active');

      controller.replaceSessionsForTesting([active]);
      expect(controller.runningSessions, contains('root'));
      expect(controller.sessionHasRunningAgent('root'), isTrue);

      controller.applyEventForTesting(
        _event('turn-complete', 'root', {
          'kind': 'turn.completed',
          'turn_id': 'turn-1',
        }),
      );
      expect(controller.runningSessions, isEmpty);
      expect(controller.sessionActivity('root'), isNull);
      expect(controller.sessionHasRunningAgent('root'), isFalse);

      controller.replaceSessionsForTesting([
        active,
      ], catalogAt: DateTime.parse('2026-08-29T08:00:01Z'));
      expect(controller.runningSessions, contains('root'));
      expect(controller.sessionHasRunningAgent('root'), isTrue);
    },
  );

  test(
    '[MOB-STA-008][flutter] late activity and title text cannot override idle catalog',
    () {
      final controller = AppController();
      addTearDown(controller.dispose);
      controller.replaceSessionsForTesting([
        _session('idle', status: 'idle', name: '[进行中] title only'),
        _session('active', status: 'active', name: '[已完成] title only'),
      ]);

      controller.applyEventForTesting(
        _event('late-message', 'idle', {
          'kind': 'message.delta',
          'turn_id': 'stale-turn',
          'text': 'late',
        }),
      );
      controller.applyEventForTesting(
        _event('late-agent', 'idle', {
          'kind': 'agent.updated',
          'agent_status': 'running',
          'root_session_id': 'idle',
          'thread_id': 'late-agent-thread',
          'name': 'Late agent',
          'task': 'old work',
        }, agentId: 'late-agent'),
      );

      expect(controller.sessionActivity('idle'), isNull);
      expect(controller.sessionHasRunningAgent('idle'), isFalse);
      expect(controller.sessionHasRunningAgent('active'), isTrue);
      expect(controller.agentActivityCount, 0);

      controller.replaceSessionsForTesting(controller.sessions);
      expect(controller.runningSessions, {'active'});
    },
  );
}

RelaySession _session(
  String id, {
  required String status,
  String name = 'Session',
  bool isSubagent = false,
  String? rootSessionId,
}) => RelaySession.fromJson({
  'id': id,
  'name': name,
  'status': status,
  'is_subagent': isSubagent,
  'root_session_id': rootSessionId ?? id,
});

RelayEvent _event(
  String eventId,
  String sessionId,
  Map<String, dynamic> event, {
  String? agentId,
}) => RelayEvent(
  cursor: 1,
  eventId: eventId,
  sessionId: sessionId,
  agentId: agentId,
  createdAt: '2026-08-29T08:00:00.000Z',
  event: event,
);
