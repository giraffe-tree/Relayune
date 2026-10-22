import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/notifications/live_task_coordinator.dart';

void main() {
  late DateTime now;
  late _Gateway gateway;
  late LiveTaskCoordinator coordinator;
  final session = RelaySession.fromJson({
    'id': 'root',
    'name': 'Improve search',
    'provider': 'claude',
  });

  void configure({
    bool enabled = true,
    bool connected = true,
    String? account = 'account-a',
    Set<String> running = const {},
    bool ready = false,
  }) {
    coordinator.configure(
      enabled: enabled,
      connected: connected,
      account: account,
      sessions: [session],
      locale: const Locale('en'),
      runningSessionIds: running,
      catalogReady: ready,
    );
  }

  RelayEvent event(
    String id,
    String kind, {
    String turn = 'turn-a',
    String sessionId = 'root',
    Map<String, dynamic> extra = const {},
    DateTime? at,
  }) => RelayEvent(
    cursor: 1,
    agentId: null,
    eventId: id,
    sessionId: sessionId,
    createdAt: (at ?? now).toIso8601String(),
    event: {'kind': kind, 'turn_id': turn, ...extra},
  );
  void start() => coordinator.handleEvent(
    event('start', 'turn.started'),
    isRootSession: true,
  );

  setUp(() {
    now = DateTime.utc(2026, 9, 9, 10);
    gateway = _Gateway();
    coordinator = LiveTaskCoordinator(gateway: gateway, now: () => now);
    configure();
  });
  tearDown(() => coordinator.dispose());

  test(
    '[MOB-NOT-017][flutter] live task lifecycle preserves routing and privacy',
    () async {
      start();
      now = now.add(const Duration(seconds: 10));
      coordinator.handleEvent(
        event(
          'ask',
          'approval.requested',
          extra: {
            'approval_id': 'approval-a',
            'expires_at': now.add(const Duration(minutes: 2)).toIso8601String(),
            'action': {'type': 'command.execute', 'command': 'SECRET_COMMAND'},
          },
        ),
        isRootSession: true,
      );
      coordinator.handleEvent(
        event(
          'answer',
          'approval.resolved',
          extra: {'approval_id': 'approval-a'},
        ),
        isRootSession: true,
      );
      now = now.add(const Duration(seconds: 10));
      coordinator.handleEvent(
        event('finish', 'turn.completed'),
        isRootSession: true,
      );
      await coordinator.settled;
      expect(gateway.cards.map((card) => card['state']), [
        'running',
        'approval',
        'running',
        'completed',
      ]);
      expect(gateway.cards.map((card) => card['turnId']).toSet(), {'turn-a'});
      expect(gateway.cards.last['finishedAt'], now.millisecondsSinceEpoch);
      expect(gateway.cards.toString(), isNot(contains('SECRET_COMMAND')));
    },
  );

  test(
    'subagent completion and late previous-turn events never finish the root card',
    () async {
      start();
      coordinator.handleEvent(
        event(
          'child-done',
          'turn.completed',
          turn: 'child',
          sessionId: 'child',
          extra: {'root_session_id': 'root'},
        ),
        isRootSession: false,
      );
      coordinator.handleEvent(
        event('old-done', 'turn.completed', turn: 'previous'),
        isRootSession: true,
      );
      await coordinator.settled;
      expect(gateway.cards, hasLength(1));
      expect(gateway.cards.last['state'], 'running');
    },
  );

  test(
    'child questions keep the root turn and multiple pending approvals stay waiting',
    () async {
      start();
      for (final id in ['a', 'b']) {
        coordinator.handleEvent(
          event(
            'ask-$id',
            'approval.requested',
            turn: 'child',
            sessionId: 'child',
            extra: {
              'root_session_id': 'root',
              'approval_id': id,
              'expires_at': now
                  .add(const Duration(minutes: 2))
                  .toIso8601String(),
              'action': {'type': 'question.select'},
            },
          ),
          isRootSession: false,
        );
      }
      coordinator.handleEvent(
        event(
          'resolve-a',
          'approval.resolved',
          sessionId: 'child',
          extra: {'root_session_id': 'root', 'approval_id': 'a'},
        ),
        isRootSession: false,
      );
      await coordinator.settled;
      expect(gateway.cards.last['state'], 'question');
      expect(gateway.cards.last['sessionId'], 'root');
      expect(gateway.cards.last['turnId'], 'turn-a');
    },
  );

  test(
    'stale approvals do not pretend work resumed and expire the native freshness',
    () async {
      start();
      final expires = now.add(const Duration(seconds: 30));
      coordinator.handleEvent(
        event(
          'ask',
          'approval.requested',
          extra: {'approval_id': 'a', 'expires_at': expires.toIso8601String()},
        ),
        isRootSession: true,
      );
      await coordinator.settled;
      expect(gateway.cards.last['staleAt'], expires.millisecondsSinceEpoch);
      now = expires.add(const Duration(seconds: 1));
      coordinator.refresh();
      await coordinator.settled;
      expect(gateway.cards.last['state'], 'stale');
    },
  );

  test(
    'permission off never writes cards and enabling restores current work',
    () async {
      configure(enabled: false);
      start();
      await coordinator.settled;
      expect(gateway.cards, isEmpty);
      configure();
      await coordinator.settled;
      expect(gateway.cards.single['state'], 'running');
    },
  );

  test(
    'heartbeats renew freshness with throttling, disconnect and background are explicit',
    () async {
      start();
      for (var i = 0; i < 20; i++) {
        configure();
      }
      await coordinator.settled;
      expect(gateway.cards, hasLength(1));
      now = now.add(const Duration(seconds: 30));
      configure();
      coordinator.setForeground(false);
      configure(connected: false);
      await coordinator.settled;
      expect(gateway.cards.length, 4);
      expect(gateway.cards.last['state'], 'stale');
      expect(gateway.cards.last['foreground'], false);
    },
  );

  test(
    'sign-out is serialized after in-flight updates; a gateway error is isolated',
    () async {
      gateway.failNext = true;
      start();
      coordinator.refresh();
      configure(account: null, enabled: false);
      await coordinator.settled;
      expect(gateway.operations.last, 'clear');
      configure(account: 'account-b');
      await coordinator.settled;
      expect(gateway.cards, hasLength(1));
    },
  );

  test(
    'old replay and duplicate start never resurrect a completed task',
    () async {
      coordinator.handleEvent(
        event(
          'old',
          'turn.started',
          at: now.subtract(const Duration(minutes: 6)),
        ),
        isRootSession: true,
      );
      start();
      start();
      coordinator.handleEvent(
        event('finish', 'turn.completed'),
        isRootSession: true,
      );
      coordinator.handleEvent(
        event('replay', 'turn.started'),
        isRootSession: true,
      );
      await coordinator.settled;
      expect(gateway.cards.map((card) => card['state']), [
        'running',
        'completed',
      ]);
    },
  );

  test(
    'restoration never invents a start time or claims catalogue removal is success',
    () async {
      configure(running: {'root'}, ready: true);
      await coordinator.settled;
      expect(gateway.cards.single['startKnown'], false);
      configure(running: {}, ready: true);
      await coordinator.settled;
      expect(gateway.cards.last['state'], 'stale');
      expect(gateway.cards.last['finishedAt'], isNotNull);
    },
  );

  test('failure and cancellation have separate final states', () async {
    start();
    coordinator.handleEvent(
      event('failed', 'turn.failed'),
      isRootSession: true,
    );
    now = now.add(const Duration(seconds: 1));
    coordinator.handleEvent(
      event('start-b', 'turn.started', turn: 'turn-b'),
      isRootSession: true,
    );
    coordinator.handleEvent(
      event(
        'stop-b',
        'turn.completed',
        turn: 'turn-b',
        extra: {'status': 'interrupted'},
      ),
      isRootSession: true,
    );
    await coordinator.settled;
    expect(gateway.cards.map((card) => card['state']), [
      'running',
      'failed',
      'running',
      'stopped',
    ]);
  });

  test(
    'title sanitization is bounded by graphemes and hides common sensitive values',
    () {
      final title = liveTaskSafeTitle(
        'Fix /Users/person/secret 12345678 sk-abcdefghijklmnop',
      );
      expect(title, isNot(contains('secret')));
      expect(title, isNot(contains('12345678')));
      expect(title, isNot(contains('abcdefghijklmnop')));
      expect(liveTaskSafeTitle('🌙' * 50)!.characters.length, 42);
    },
  );
  test(
    'offline refresh preserves the time of the last confirmed sync',
    () async {
      start();
      final lastSync = now.millisecondsSinceEpoch;
      now = now.add(const Duration(minutes: 2));
      configure(connected: false);
      coordinator.refresh();
      await coordinator.settled;
      expect(gateway.cards.last['updatedAt'], lastSync);
      expect(gateway.cards.last['state'], 'stale');
    },
  );

  test(
    'a cold start without an account clears leftover system cards once',
    () async {
      final cold = LiveTaskCoordinator(gateway: gateway, now: () => now);
      for (var i = 0; i < 3; i++) {
        cold.configure(
          enabled: false,
          connected: false,
          account: null,
          sessions: [],
          locale: const Locale('en'),
          clearWhenUnavailable: true,
        );
      }
      await cold.settled;
      expect(gateway.operations, ['clear']);
      cold.dispose();
    },
  );
}

class _Gateway implements LiveTaskGateway {
  final cards = <Map<String, Object?>>[];
  final operations = <String>[];
  bool failNext = false;
  @override
  Future<void> update(Map<String, Object?> card) async {
    if (failNext) {
      failNext = false;
      throw StateError('platform unavailable');
    }
    operations.add('update');
    cards.add(card);
  }

  @override
  Future<void> clear() async {
    operations.add('clear');
  }
}
