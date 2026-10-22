import 'dart:convert';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/device_connection.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets(
    'live events and refreshed snapshots never detach or collapse the agent dock',
    (tester) async {
      final controller = workbenchController(
        agents: [_namedAgent('child', 'running')],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
      );
      await _settle(tester);
      final dock = find.byKey(const ValueKey('composer-agent-status'));
      final element = tester.element(dock);
      // Codex 0.160.1 live child events used the child's own session ID;
      // external rollout items can also carry the placeholder "external".
      for (var round = 0; round < 20; round++) {
        for (final rootId in ['child', 'external', 'unrelated-root', 'root']) {
          controller.receiveLiveEventForTesting(
            RelayEvent(
              cursor: round,
              eventId: 'root-$round-$rootId',
              sessionId: rootId,
              agentId: 'child',
              createdAt: DateTime.now().toUtc().toIso8601String(),
              event: {
                'kind': 'agent.progress',
                'thread_id': 'child',
                'parent_thread_id': 'root',
                'root_session_id': rootId,
                'agent_status': round.isEven ? 'running' : 'completed',
              },
            ),
          );
          await tester.pump();
          expect(dock, findsOneWidget);
          expect(identical(tester.element(dock), element), isTrue);
          expect(
            find.byKey(const ValueKey('conversation-activity-panel')),
            findsOneWidget,
          );
          expect(controller.activeSessionAgents.single.parentSessionId, 'root');
        }
      }
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'running tasks lead the tray and newly active tasks are visible',
    (tester) async {
      final controller = workbenchController(
        agents: [
          for (var i = 0; i < 4; i++) _namedAgent('done-$i', 'completed'),
          _namedAgent('running', 'running'),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      expect(find.text('running · 运行中'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
      );
      await _settle(tester);
      final running = find.byKey(
        const ValueKey('composer-agent-status-agent-running'),
      );
      final completed = find.byKey(
        const ValueKey('composer-agent-status-agent-done-0'),
      );
      expect(
        tester.getTopLeft(running).dy,
        lessThan(tester.getTopLeft(completed).dy),
      );
      controller.agents = [
        ...controller.agents,
        _namedAgent('new-running', 'running'),
      ];
      controller.notifyListeners();
      await _settle(tester);
      expect(
        find.byKey(const ValueKey('composer-agent-status-agent-new-running')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '88-task overview accounts for stopped work and searches task identity',
    (tester) async {
      final controller = workbenchController(
        agents: [
          for (var i = 0; i < 88; i++)
            _namedAgent('bench $i', i == 87 ? 'interrupted' : 'completed'),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      expect(find.text('88 个子任务 · 87 个已完成 · 1 个已停止'), findsOneWidget);
      expect(find.textContaining('BEGIN'), findsNothing);
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
      );
      await _settle(tester);
      await tester.tap(find.byKey(const ValueKey('agent-tasks-view-all')));
      await _settle(tester);
      await tester.enterText(
        find.byKey(const ValueKey('agent-tasks-search')),
        'bench 87',
      );
      await _settle(tester);
      expect(
        find.byKey(const ValueKey('composer-agent-status-agent-bench 87')),
        findsOneWidget,
      );
      expect(find.text('bench 0'), findsNothing);
      expect(find.text('已停止'), findsWidgets);
      await tester.enterText(
        find.byKey(const ValueKey('agent-tasks-search')),
        'missing task',
      );
      await _settle(tester);
      expect(find.text('没有匹配的子任务'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  for (final startAtHome in [false, true]) {
    testWidgets(
      'detail opens stored replies inside the workbench (home route: $startAtHome)',
      (tester) async {
        final base = _HistoryInspectionController();
        final agent = RelayAgent(
          id: 'child',
          threadId: 'child',
          parentSessionId: 'root',
          name: 'bench 56 high',
          nickname: 'Darwin',
          task: 'OPAQUE_TASK_MUST_NOT_RENDER',
          status: 'completed',
          progress: 100,
          model: 'gpt-5.6-sol',
          reasoningEffort: 'high',
          summary: List.filled(200, 'Long answer.').join('\n'),
          toolCount: 123,
          tokenCount: 456,
          contextTokens: 789,
          startedAt: '2026-10-08T01:00:00Z',
          updatedAt: '2026-10-08T02:00:00Z',
        );
        final controller = workbenchController(
          baseController: base,
          agents: [agent],
        );
        addTearDown(controller.dispose);
        await pumpWorkbench(tester, controller, startAtHome: startAtHome);
        if (startAtHome) {
          await tester.tap(
            find.byKey(const ValueKey('home-recent-session-root')),
          );
          await _settle(tester);
        }
        await tester.tap(
          find.byKey(const ValueKey('composer-agent-status-toggle')),
        );
        await _settle(tester);
        await tester.tap(
          find.byKey(const ValueKey('composer-agent-status-agent-child')),
        );
        await _settle(tester);
        expect(find.text('Darwin'), findsOneWidget);
        expect(find.text('模型配置: gpt-5.6-sol · high'), findsOneWidget);
        expect(find.text('运行信息'), findsNothing);
        expect(find.textContaining('OPAQUE_TASK'), findsNothing);
        final history = find
            .byKey(const ValueKey('agent-task-open-conversation'))
            .hitTestable();
        expect(history, findsOneWidget);
        expect(
          tester.getTopLeft(history).dy,
          lessThan(tester.getTopLeft(find.text('最新回复')).dy),
        );
        await tester.tap(history);
        await _settle(tester);
        expect(base.reads, ['child']);
        expect(controller.activeSessionId, 'child');
        expect(controller.activeSession!.isSubagent, isTrue);
        expect(controller.activeSession!.rootSessionId, 'root');
        expect(controller.activeSession!.supportsSteering, isFalse);
        expect(controller.activeSession!.canInterrupt, isFalse);
        expect(
          find.text('Earlier stored reply', findRichText: true),
          findsOneWidget,
        );
        expect(
          find.text('Latest stored reply', findRichText: true),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'reopened conversation discovers completed tasks without a preexisting dock',
    (tester) async {
      final base = _RestoredTasksController();
      final controller = workbenchController(baseController: base)
        ..relayKey = RelayKey.import(
          base64Url
              .encode(List<int>.generate(32, (i) => i))
              .replaceAll('=', ''),
        );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.pump();
      expect(base.reads, ['root']);
      expect(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
        findsOneWidget,
      );
      expect(find.textContaining('Child'), findsOneWidget);
      expect(find.textContaining('1 个已完成'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('accepted waiting message is not presented as a running agent', (
    tester,
  ) async {
    final controller = workbenchController(
      baseController: _WaitingController(),
      sessions: [
        RelaySession.fromJson({
          'id': 'root',
          'name': 'Waiting',
          'provider': 'codex',
          'status': 'idle',
        }),
      ],
    );
    addTearDown(controller.dispose);
    controller.messages['root'] = [
      RelayMessage(
        id: 'pending',
        kind: 'user.message',
        role: 'user',
        content: 'Pending request',
        createdAt: '2026-09-09T17:00:00Z',
      ),
    ];
    await pumpWorkbench(tester, controller);
    expect(find.text('等待 Agent 执行'), findsOneWidget);
    expect(find.textContaining('正在运行'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'agent summary remains still across foreground and background transitions',
    (tester) async {
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      final controller = _controller();
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      final summary = find.byKey(
        const ValueKey('inline-agent-activity-ticker'),
      );
      final text = tester.widget<Text>(summary);
      final position = tester.getTopLeft(summary);
      expect(text.maxLines, 1);
      expect(text.overflow, TextOverflow.ellipsis);
      await tester.pump(const Duration(seconds: 30));
      expect(tester.getTopLeft(summary), position);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump(const Duration(seconds: 30));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(tester.widget<Text>(summary).data, text.data);
      expect(tester.getTopLeft(summary), position);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    '[MOB-AGT-003][flutter] compact tasks lead to overview and results survive completion',
    (tester) async {
      final controller = _controller();
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      expect(find.text('4 个子任务 · 4 个运行中'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
      );
      await _settle(tester);
      expect(find.text('Reviewer'), findsOneWidget);
      expect(find.text('Tester'), findsOneWidget);
      expect(find.text('Builder'), findsOneWidget);
      expect(find.text('Researcher'), findsNothing);
      expect(find.text('查看全部 4 个子任务'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('agent-tasks-view-all')));
      await _settle(tester);
      expect(
        find.byKey(const ValueKey('agent-tasks-overview')),
        findsOneWidget,
      );
      expect(find.text('Researcher'), findsOneWidget);
      await tester.tap(
        find
            .byKey(const ValueKey('composer-agent-status-agent-agent_4'))
            .hitTestable(),
      );
      await _settle(tester);
      expect(
        find.byKey(const ValueKey('composer-agent-detail-agent_4')),
        findsOneWidget,
      );
      expect(find.text('活动时间线'), findsNothing);
      expect(find.text('任务原文'), findsNothing);
      expect(find.text('运行信息'), findsNothing);
      expect(find.text('Reviewer'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      for (var index = 1; index <= 4; index++) {
        controller.applyEventForTesting(_completedAgentEvent(index));
      }
      controller.runningSessions.clear();
      controller.notifyListeners();
      await _settle(tester);
      expect(find.text('已完成'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-detail-back')).hitTestable(),
      );
      await _settle(tester);
      expect(find.text('已完成'), findsWidgets);
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-detail-back')).hitTestable(),
      );
      await _settle(tester);
      expect(
        find.byKey(const ValueKey('composer-agent-status')),
        findsOneWidget,
      );
      expect(find.text('查看全部 4 个子任务'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-AGT-008][flutter] live activity updates without reordering or elapsed counters',
    (tester) async {
      final controller = _controller();
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
      );
      await _settle(tester);
      final row = find.byKey(
        const ValueKey('composer-agent-status-agent-agent_4'),
      );
      final position = tester.getTopLeft(row);
      controller.applyEventForTesting(
        RelayEvent(
          cursor: 99,
          eventId: 'activity',
          sessionId: 'root_1',
          agentId: 'agent_2',
          createdAt: DateTime(2026, 9, 18, 14, 32, 7).toUtc().toIso8601String(),
          event: {
            'kind': 'agent.updated',
            'agent_status': 'running',
            'current_activity': 'Bash: npm test',
          },
        ),
      );
      controller.notifyListeners();
      await tester.pump();
      expect(tester.getTopLeft(row), position);
      expect(find.text('Bash: npm test'), findsOneWidget);
      final time = find.byKey(const ValueKey('agent-activity-time-agent_2'));
      expect(time, findsNothing);
      expect(find.byKey(const ValueKey('agent-elapsed-agent_4')), findsNothing);
      expect(
        find.byKey(const ValueKey('conversation-composer-input')).hitTestable(),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'unknown and preparing states never impersonate approval, including narrow screens',
    (tester) async {
      final controller = workbenchController(
        agents: [
          _agent('unknown', 'unknown'),
          _agent('preparing', 'pendingInit'),
          _agent('done', 'completed'),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(
        tester,
        controller,
        size: const Size(320, 700),
        textScale: 1.5,
      );
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
      );
      await _settle(tester);
      await tester.tap(find.byKey(const ValueKey('agent-tasks-view-all')));
      await _settle(tester);
      expect(find.text('状态待同步'), findsWidgets);
      expect(find.text('准备中'), findsOneWidget);
      expect(find.text('待决定'), findsNothing);
      expect(find.text('等你批准'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'only the exact source task receives a decision and it is actionable in detail',
    (tester) async {
      final controller = workbenchController(
        agents: [_agent('one', 'running'), _agent('two', 'running')],
        approvals: [
          RelayApproval(
            id: 'decision',
            sessionId: 'root',
            sourceThreadId: 'thread-two',
            action: const {'type': 'command.execute', 'display': 'npm test'},
            riskLevel: 'low',
            state: 'pending',
            requestedAt: DateTime.now().toIso8601String(),
            expiresAt: DateTime.now()
                .add(const Duration(minutes: 2))
                .toIso8601String(),
          ),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.tap(
        find.byKey(const ValueKey('conversation-activity-tab-agents')),
      );
      await _settle(tester);
      expect(find.text('等你批准'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-agent-two')),
      );
      await _settle(tester);
      expect(
        find.byKey(const ValueKey('agent-detail-approval-decision')),
        findsOneWidget,
      );
      expect(find.text('允许'), findsOneWidget);
      expect(find.text('拒绝'), findsOneWidget);
      expect(find.text('npm test'), findsWidgets);
      expect(tester.takeException(), isNull);
    },
  );
}

RelayAgent _namedAgent(String name, String status) => RelayAgent(
  id: name,
  threadId: name,
  parentSessionId: 'root',
  name: name,
  task: 'Encrypted assignment',
  status: status,
  progress: 55,
  summary: 'BEGIN identical answer',
  model: 'fixture-model',
  reasoningEffort: 'high',
);

class _HistoryInspectionController extends AppController {
  final reads = <String>[];
  @override
  Future<void> loadHistory(
    String sessionId, {
    bool earlier = false,
    bool silent = false,
    bool localOnly = false,
  }) async {
    reads.add(sessionId);
    messages[sessionId] = [
      for (final (index, text) in [
        'Earlier stored reply',
        'Latest stored reply',
      ].indexed)
        RelayMessage(
          id: 'reply-$index',
          kind: 'message.completed',
          role: 'codex',
          content: text,
          createdAt: '2026-10-08T01:00:00Z',
        ),
    ];
    markHistoryLoadedForTesting(sessionId);
    notifyListeners();
  }
}

RelayAgent _agent(String id, String status) => RelayAgent(
  id: id,
  threadId: 'thread-$id',
  parentSessionId: 'root',
  name: 'Worker',
  task: 'Task $id',
  status: status,
  progress: 55,
);

AppController _controller() {
  final root = RelaySession.fromJson({
    'id': 'root_1',
    'name': 'Root',
    'project': 'Relayune',
    'branch': 'main',
    'cwd': '/workspace/relayune',
    'status': 'active',
    'updated_at': '2026-08-10T08:00:00.000Z',
    'provider': 'codex',
    'is_subagent': false,
    'root_session_id': 'root_1',
  });
  const names = ['Researcher', 'Builder', 'Tester', 'Reviewer'];
  final children = List.generate(
    names.length,
    (index) => RelaySession.fromJson({
      'id': 'thread_agent_${index + 1}',
      'name': '${names[index]} thread',
      'project': 'Relayune',
      'branch': 'main',
      'cwd': '/workspace/relayune',
      'status': 'active',
      'updated_at': '2026-08-10T08:00:0${index + 1}.000Z',
      'provider': 'codex',
      'is_subagent': true,
      'root_session_id': 'root_1',
    }),
  );
  final agents = List.generate(
    names.length,
    (index) => RelayAgent(
      id: 'agent_${index + 1}',
      threadId: 'thread_agent_${index + 1}',
      parentSessionId: 'root_1',
      name: names[index],
      task: 'Task ${index + 1}',
      status: 'running',
      progress: 30 + index * 10,
      activity: index == 0
          ? 'Checking mobile events and validating the latest encrypted subagent activity across a deliberately long status line'
          : 'Running task ${index + 1}',
      updatedAt: '2026-08-10T08:00:0${index + 1}.000Z',
    ),
  );
  final controller = AppController()
    ..phase = AppPhase.ready
    ..bootstrap = const ServerBootstrap(
      email: 'owner@example.com',
      device: RelayDevice(
        id: 'dev_test',
        name: 'Test Mac',
        online: true,
        agentConnected: true,
        lastSeenAt: '2026-08-10T08:00:00.000Z',
      ),
      catalog: null,
      events: [],
      cursor: 0,
      ackSequence: 2,
      queuedCommands: 0,
    )
    ..sessions = [root, ...children]
    ..activeSessionId = root.id
    ..agents = agents
    ..messages[root.id] = []
    ..markHistoryLoadedForTesting(root.id)
    ..messages.addAll({for (final child in children) child.id: []})
    ..markHistoryLoadedForTesting(children[0].id)
    ..markHistoryLoadedForTesting(children[1].id)
    ..markHistoryLoadedForTesting(children[2].id)
    ..markHistoryLoadedForTesting(children[3].id)
    ..connectionSnapshot = const DeviceConnectionSnapshot(
      online: true,
      lastSeenAt: '2026-08-10T08:00:00.000Z',
      revision: 1,
      transport: RealtimeTransportState.connected,
      realtimeConfirmed: true,
    );
  controller.replaceSessionsForTesting(controller.sessions);
  return controller;
}

RelayEvent _completedAgentEvent(int index) => RelayEvent(
  cursor: 100 + index,
  eventId: 'evt_agent_${index}_completed',
  sessionId: 'root_1',
  agentId: 'agent_$index',
  createdAt: '2026-08-10T08:01:0$index.000Z',
  event: {
    'kind': 'agent.completed',
    'agent_status': 'completed',
    'root_session_id': 'root_1',
    'thread_id': 'thread_agent_$index',
    'progress': 100,
  },
);

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 350));
}

class _WaitingController extends AppController {
  @override
  String? sessionActivity(String sessionId) => '等待 Agent 执行';
}

class _RestoredTasksController extends AppController {
  final reads = <String>[];
  @override
  Future<void> refreshAgentActivity(String sessionId) async {
    reads.add(sessionId);
    agents = [
      RelayAgent(
        id: 'restored',
        threadId: 'child',
        parentSessionId: sessionId,
        name: 'Child',
        task: 'Read fixture',
        status: 'completed',
        progress: 100,
        summary: 'RESTORED_CHILD_9147',
      ),
    ];
    notifyListeners();
  }
}
