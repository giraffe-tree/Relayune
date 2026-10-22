import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/device_connection.dart';
import 'package:relayune_mobile/src/state/transient_thinking.dart';

import '../support/workbench_fixture.dart';

RelayEvent event(
  String id,
  String kind, {
  String session = 'root',
  String turn = 'one',
  int sequence = 1,
  bool? thinking,
  DateTime? at,
}) => RelayEvent(
  cursor: sequence,
  sourceSequence: sequence,
  eventId: id,
  sessionId: session,
  agentId: null,
  createdAt: (at ?? DateTime.now().toUtc()).toIso8601String(),
  event: {
    'kind': kind,
    'turn_id': turn,
    if (thinking != null) 'active': thinking,
    if (kind == 'user.message') 'text': 'Check this task',
    if (kind == 'message.delta') 'text': 'Reply',
    if (kind == 'command.started') 'command': 'check',
  },
);

void main() {
  testWidgets(
    'thinking follows the latest tools inside the scrollable conversation',
    (tester) async {
      final controller = workbenchController(sessions: [relaySession()]);
      addTearDown(controller.dispose);
      controller.applyEventForTesting(event('start', 'turn.started'));
      controller.messages['root'] = [
        RelayMessage(
          id: 'long-user',
          role: 'user',
          content: 'long running task',
          createdAt: DateTime.now().toUtc().toIso8601String(),
          kind: 'user.message',
          turnId: 'one',
        ),
        for (var i = 0; i < 35; i++)
          RelayMessage(
            id: 'tool-$i',
            role: 'codex',
            content: 'Done',
            createdAt: DateTime.now().toUtc().toIso8601String(),
            kind: 'tool_activity',
            turnId: 'one',
            toolActivityType: 'mcp_tool',
            toolActivityName: 'probe_$i',
            toolActivityStatus: 'completed',
            toolActivityLabel: 'Completed tool $i',
          ),
      ];
      controller.applyEventForTesting(
        event('think', 'turn.thinking', sequence: 2, thinking: true),
      );
      await pumpWorkbench(tester, controller, size: const Size(320, 736));
      final indicator = find.byKey(const ValueKey('assistant-live-activity'));
      final list = find.byKey(const ValueKey('conversation-message-list'));
      expect(find.textContaining('思考中… ('), findsOneWidget);
      expect(
        tester.getRect(indicator).top,
        greaterThanOrEqualTo(tester.getRect(list).top),
      );
      expect(
        tester.getRect(indicator).bottom,
        lessThanOrEqualTo(tester.getRect(list).bottom),
      );
      expect(
        find.ancestor(
          of: indicator,
          matching: find.byKey(const ValueKey('conversation-message-list')),
        ),
        findsOneWidget,
      );
      final timeline = find.byKey(
        const ValueKey('turn-activity-timeline-turn:one'),
      );
      expect(find.ancestor(of: indicator, matching: timeline), findsOneWidget);
      expect(
        tester.getRect(indicator).left,
        greaterThan(tester.getRect(timeline).left),
      );
      expect(
        tester.getRect(indicator).bottom,
        lessThan(tester.getRect(timeline).bottom),
      );
      expect(
        find.byKey(const ValueKey('assistant-running-icon')),
        findsNothing,
      );
      expect(find.textContaining('已运行'), findsNothing);
      await tester.drag(list, const Offset(0, 450));
      await tester.pump(const Duration(milliseconds: 100));
      expect(indicator.hitTestable(), findsNothing);
      expect(controller.sessionIsThinking('root'), isTrue);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'external catalog-only running has no invented thinking or elapsed row',
    (tester) async {
      final controller = workbenchController(sessions: [relaySession()])
        ..runningSessions.add('root');
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      expect(
        find.byKey(const ValueKey('assistant-live-activity')),
        findsNothing,
      );
      expect(find.textContaining('思考中'), findsNothing);
    },
  );

  testWidgets(
    'finishing while reading history does not jump back to the tail',
    (tester) async {
      final controller = workbenchController(sessions: [relaySession()]);
      addTearDown(controller.dispose);
      controller.messages['root'] = [
        for (var i = 0; i < 24; i++)
          RelayMessage(
            id: 'old-reply-$i',
            role: 'codex',
            content:
                'Earlier reply $i with enough content to read in the timeline.',
            createdAt: '2026-10-08T00:${i.toString().padLeft(2, '0')}:00Z',
            kind: 'message.completed',
            turnId: 'old-$i',
          ),
      ];
      controller.applyEventForTesting(event('user', 'user.message'));
      controller.applyEventForTesting(
        event('start', 'turn.started', sequence: 2),
      );
      controller.applyEventForTesting(
        event('think', 'turn.thinking', sequence: 3, thinking: true),
      );
      await pumpWorkbench(tester, controller);
      for (var frame = 0; frame < 8; frame++) {
        await tester.pump(const Duration(milliseconds: 32));
      }
      final list = find.byKey(const ValueKey('conversation-message-list'));
      await tester.drag(list, const Offset(0, 650));
      await tester.pump(const Duration(milliseconds: 200));
      final scroll = tester.widget<ScrollView>(list).controller!;
      expect(scroll.offset, greaterThan(100));
      expect(
        find.byKey(const ValueKey('assistant-live-activity')).hitTestable(),
        findsNothing,
      );
      controller.applyEventForTesting(
        event('done', 'turn.completed', sequence: 4),
      );
      controller.notifyListeners();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(scroll.offset, greaterThan(100));
      expect(
        find.byKey(const ValueKey('assistant-live-activity')),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('history turn identities do not hide current live thinking', (
    tester,
  ) async {
    final controller = workbenchController(
      sessions: [relaySession(provider: 'kimi')],
    );
    addTearDown(controller.dispose);
    controller.applyEventForTesting(event('start', 'turn.started'));
    // Native history and the adapter's live turn can have different identities.
    controller.messages['root'] = [
      RelayMessage(
        id: 'history-user',
        role: 'user',
        content: 'current task',
        createdAt: DateTime.now().toUtc().toIso8601String(),
        kind: 'user.message',
        turnId: 'native-history-turn',
      ),
    ];
    controller.applyEventForTesting(
      event('think', 'turn.thinking', sequence: 2, thinking: true),
    );
    await pumpWorkbench(tester, controller);
    expect(find.textContaining('思考中… ('), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('thinking timer retains a phase start and resets at every boundary', () {
    final state = TransientThinking();
    final start = DateTime.utc(2026, 10, 9, 1);
    void observe(
      int sequence,
      String kind, {
      bool? thinking,
      int seconds = 0,
      String turn = 'one',
    }) {
      state.observe(
        event(
          '$sequence',
          kind,
          sequence: sequence,
          thinking: thinking,
          turn: turn,
          at: start.add(Duration(seconds: seconds)),
        ),
        activeTurnId: turn,
      );
    }

    observe(1, 'turn.started');
    observe(2, 'turn.thinking', thinking: true, seconds: 40);
    expect(
      state.startedAt('root', 'one'),
      start.add(const Duration(seconds: 40)),
    );
    observe(3, 'turn.thinking', thinking: true, seconds: 46);
    expect(
      state.startedAt('root', 'one'),
      start.add(const Duration(seconds: 40)),
    );
    observe(4, 'command.started', seconds: 47);
    expect(state.startedAt('root', 'one'), isNull);
    observe(5, 'turn.thinking', thinking: true, seconds: 55);
    expect(
      state.startedAt('root', 'one'),
      start.add(const Duration(seconds: 55)),
    );
    observe(6, 'turn.thinking', thinking: false, seconds: 58);
    expect(state.startedAt('root', 'one'), isNull);
    observe(7, 'turn.thinking', thinking: true, seconds: 60);
    observe(8, 'message.delta', seconds: 62);
    expect(state.startedAt('root', 'one'), isNull);
    observe(9, 'turn.thinking', thinking: true, seconds: 65, turn: 'two');
    expect(state.startedAt('root', 'one'), isNull);
    expect(
      state.startedAt('root', 'two'),
      start.add(const Duration(seconds: 65)),
    );
    state.invalidate();
    expect(state.startedAt('root', 'two'), isNull);
  });

  testWidgets(
    'elapsed seconds belong to current thinking, not the task or mounting time',
    (tester) async {
      final now = DateTime.now().toUtc();
      final controller = workbenchController(sessions: [relaySession()]);
      addTearDown(controller.dispose);
      controller.applyEventForTesting(
        event(
          'user',
          'user.message',
          at: now.subtract(const Duration(minutes: 5)),
        ),
      );
      controller.applyEventForTesting(
        event(
          'start',
          'turn.started',
          sequence: 2,
          at: now.subtract(const Duration(minutes: 5)),
        ),
      );
      controller.applyEventForTesting(
        event(
          'think',
          'turn.thinking',
          sequence: 3,
          thinking: true,
          at: now.subtract(const Duration(seconds: 72)),
        ),
      );
      await pumpWorkbench(tester, controller);
      final label = find.byKey(const ValueKey('assistant-running-label'));
      expect(tester.widget<Text>(label).data, '思考中… (72 秒)');
      controller.applyEventForTesting(
        event(
          'duplicate',
          'turn.thinking',
          sequence: 4,
          thinking: true,
          at: now,
        ),
      );
      controller.notifyListeners();
      await tester.pump();
      expect(tester.widget<Text>(label).data, '思考中… (72 秒)');
      controller.applyEventForTesting(
        event('tool', 'command.started', sequence: 5, at: now),
      );
      controller.notifyListeners();
      await tester.pump();
      expect(label, findsNothing);
      controller.applyEventForTesting(
        event('again', 'turn.thinking', sequence: 6, thinking: true, at: now),
      );
      controller.notifyListeners();
      await tester.pump();
      expect(tester.widget<Text>(label).data, '思考中… (0 秒)');
      expect(tester.takeException(), isNull);
    },
  );

  test('transient phase rejects older events and different turns/sessions', () {
    final state = TransientThinking();
    state.observe(event('start', 'turn.started'), activeTurnId: 'one');
    state.observe(
      event('think', 'turn.thinking', sequence: 2, thinking: true),
      activeTurnId: 'one',
    );
    expect(state.isThinking('root', 'one'), isTrue);
    state.observe(
      event('duplicate-start', 'turn.started', sequence: 3),
      activeTurnId: 'one',
    );
    expect(state.isThinking('root', 'one'), isTrue);
    state.observe(
      event('reply', 'message.delta', sequence: 4),
      activeTurnId: 'one',
    );
    state.observe(
      event('old-thinking', 'turn.thinking', sequence: 3, thinking: true),
      activeTurnId: 'one',
    );
    state.observe(
      event(
        'other-turn',
        'turn.thinking',
        turn: 'old',
        sequence: 5,
        thinking: true,
      ),
      activeTurnId: 'one',
    );
    expect(state.isThinking('root', 'one'), isFalse);
    expect(state.isThinking('another', 'one'), isFalse);
    state.observe(
      event('again', 'turn.thinking', sequence: 6, thinking: true),
      activeTurnId: 'one',
    );
    expect(state.isThinking('root', 'one'), isTrue);
    final beforeDisconnect = DateTime.now().toUtc();
    state.invalidate();
    state.observe(
      event(
        'replay',
        'turn.thinking',
        sequence: 7,
        thinking: true,
        at: beforeDisconnect,
      ),
      activeTurnId: 'one',
    );
    expect(state.isThinking('root', 'one'), isFalse);
    state.observe(
      event('fresh', 'turn.thinking', sequence: 8, thinking: true),
      activeTurnId: 'one',
    );
    expect(state.isThinking('root', 'one'), isTrue);
    state.forget('root');
    expect(state.isThinking('root', 'one'), isFalse);
  });

  testWidgets(
    'conversation thinking appears temporarily and is never a history message',
    (tester) async {
      final controller = workbenchController(
        sessions: [relaySession(provider: 'opencode')],
      );
      addTearDown(controller.dispose);
      controller.applyEventForTesting(event('user', 'user.message'));
      controller.applyEventForTesting(
        event('start', 'turn.started', sequence: 2),
      );
      await pumpWorkbench(tester, controller);
      final label = find.byKey(const ValueKey('assistant-running-label'));
      expect(label, findsNothing);
      final before = controller.messages['root']!.length;
      controller.applyEventForTesting(
        event('think', 'turn.thinking', sequence: 3, thinking: true),
      );
      controller.notifyListeners();
      await tester.pump();
      expect(tester.widget<Text>(label).data, startsWith('思考中… ('));
      expect(controller.messages['root']!.length, before);
      expect(
        find.byKey(const ValueKey('turn-activity-turn:one')),
        findsNothing,
      );
      controller.applyEventForTesting(
        event('tool', 'command.started', sequence: 4),
      );
      controller.notifyListeners();
      await tester.pump();
      expect(label, findsNothing);
      controller.applyEventForTesting(
        event('think-again', 'turn.thinking', sequence: 5, thinking: true),
      );
      controller.notifyListeners();
      await tester.pump();
      expect(tester.widget<Text>(label).data, startsWith('思考中… ('));
      controller.applyEventForTesting(
        event('reply', 'message.delta', sequence: 6),
      );
      controller.notifyListeners();
      await tester.pump();
      expect(label, findsNothing);
      controller.applyEventForTesting(
        event('done', 'turn.completed', sequence: 7),
      );
      controller.applyEventForTesting(
        event('late', 'turn.thinking', sequence: 8, thinking: true),
      );
      controller.notifyListeners();
      await tester.pump();
      expect(label, findsNothing);
      expect(
        controller.messages['root']!.any((m) => m.kind == 'turn.thinking'),
        isFalse,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'disconnect clears thinking and reconnect cannot restore an old hint',
    (tester) async {
      final controller = workbenchController(sessions: [relaySession()]);
      addTearDown(controller.dispose);
      controller.applyEventForTesting(event('user', 'user.message'));
      controller.applyEventForTesting(
        event('start', 'turn.started', sequence: 2),
      );
      controller.applyEventForTesting(
        event('think', 'turn.thinking', sequence: 3, thinking: true),
      );
      await pumpWorkbench(tester, controller, size: const Size(320, 736));
      expect(find.textContaining('思考中… ('), findsOneWidget);
      final oldAt = DateTime.now().toUtc();
      controller.connectionSnapshot = const DeviceConnectionSnapshot(
        online: false,
        lastSeenAt: null,
        revision: 2,
        transport: RealtimeTransportState.reconnecting,
        realtimeConfirmed: true,
      );
      controller.notifyListeners();
      await tester.pump();
      expect(find.textContaining('思考中'), findsNothing);
      controller.connectionSnapshot = const DeviceConnectionSnapshot(
        online: true,
        lastSeenAt: null,
        revision: 3,
        transport: RealtimeTransportState.connected,
        realtimeConfirmed: true,
      );
      controller.applyEventForTesting(
        event('old', 'turn.thinking', sequence: 4, thinking: true, at: oldAt),
      );
      controller.notifyListeners();
      await tester.pump();
      expect(find.textContaining('思考中'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
