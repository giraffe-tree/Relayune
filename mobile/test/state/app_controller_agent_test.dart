import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';

void main() {
  for (final invalidRoot in ['child', 'external']) {
    test(
      'new Codex child resolves invalid root from its known parent ($invalidRoot)',
      () {
        final controller = _controller();
        addTearDown(controller.dispose);
        controller.applyEventForTesting(
          RelayEvent(
            cursor: 1,
            eventId: 'first-$invalidRoot',
            sessionId: 'child',
            agentId: 'child',
            createdAt: '2026-10-10T00:00:00Z',
            event: {
              'kind': 'agent.started',
              'thread_id': 'child',
              'parent_thread_id': 'root_1',
              'root_session_id': invalidRoot,
              'provider': 'codex',
            },
          ),
        );
        expect(controller.activeSessionAgents.single.parentSessionId, 'root_1');
      },
    );
  }

  test('nested Codex child resolves its root through the parent agent', () {
    final controller = _controller();
    addTearDown(controller.dispose);
    controller.applyEventForTesting(_agentEvent(agentId: 'parent'));
    controller.applyEventForTesting(
      RelayEvent(
        cursor: 2,
        eventId: 'nested',
        sessionId: 'thread_parent',
        agentId: 'child',
        createdAt: '2026-10-10T00:00:00Z',
        event: {
          'kind': 'agent.started',
          'thread_id': 'child',
          'parent_thread_id': 'thread_parent',
          'root_session_id': 'child',
          'provider': 'codex',
        },
      ),
    );
    expect(controller.activeSessionAgents, hasLength(2));
    expect(controller.agents.last.parentSessionId, 'root_1');
  });

  test(
    'unresolved malformed Codex activity cannot invent a root or change selection',
    () {
      final controller = _controller();
      addTearDown(controller.dispose);
      controller.applyEventForTesting(
        RelayEvent(
          cursor: 1,
          eventId: 'unresolved',
          sessionId: 'child',
          agentId: 'child',
          createdAt: '2026-10-10T00:00:00Z',
          event: {
            'kind': 'agent.started',
            'thread_id': 'child',
            'parent_thread_id': 'missing',
            'root_session_id': 'child',
            'provider': 'codex',
          },
        ),
      );
      expect(controller.agents, isEmpty);
      expect(controller.activeSessionId, 'root_1');
    },
  );

  test(
    '[MOB-AGT-001][flutter] repeated agent lifecycle events update one child instead of duplicating it',
    () {
      final controller = _controller();
      controller.applyEventForTesting(
        _agentEvent(agentId: 'agent_1', progress: 20),
      );
      controller.applyEventForTesting(
        _agentEvent(agentId: 'agent_1', progress: 65),
      );

      expect(controller.agents, hasLength(1));
      expect(controller.agents.single.progress, 65);
      controller.dispose();
    },
  );

  test(
    '[MOB-AGT-002][flutter] main summary stays running while completed children await the final answer',
    () {
      final controller = _controller();
      controller.applyEventForTesting(_turnEvent('turn.started'));
      controller.applyEventForTesting(
        _agentEvent(
          agentId: 'agent_1',
          kind: 'agent.completed',
          status: 'completed',
          progress: 100,
          summary: 'done',
        ),
      );

      expect(controller.activeSessionAgentWaveActive, isTrue);
      expect(controller.activeSessionAgentsSummarizing, isTrue);
      expect(controller.agentActivityCount, 1);
      controller.dispose();
    },
  );

  test(
    '[MOB-AGT-004][flutter] Kimi main turn stays visible while fresh swarm results are summarized',
    () {
      final controller = _controller(provider: 'kimi');
      controller.applyEventForTesting(_turnEvent('turn.started'));
      controller.applyEventForTesting(
        _agentEvent(
          agentId: 'kimi_child',
          kind: 'agent.completed',
          status: 'completed',
          progress: 100,
          summary: 'research ready',
        ),
      );

      expect(controller.activeSessionAgentsSummarizing, isTrue);
      expect(controller.activeSessionAgents.single.summary, 'research ready');
      controller.dispose();
    },
  );

  test(
    '[MOB-AGT-005][flutter] agents are scoped to the active root session',
    () {
      final controller = _controller();
      controller.applyEventForTesting(
        _agentEvent(agentId: 'root_agent', rootSessionId: 'root_1'),
      );
      controller.applyEventForTesting(
        _agentEvent(agentId: 'other_agent', rootSessionId: 'root_2'),
      );

      expect(controller.activeSessionAgents.map((agent) => agent.id), [
        'root_agent',
      ]);
      controller.dispose();
    },
  );

  test(
    '[MOB-AGT-006][flutter] terminal child keeps its summary and moves once to completed',
    () {
      final controller = _controller();
      controller.applyEventForTesting(
        _agentEvent(
          agentId: 'agent_1',
          progress: 80,
          summary: 'preserved result',
        ),
      );
      controller.applyEventForTesting(
        _agentEvent(
          agentId: 'agent_1',
          kind: 'agent.completed',
          status: 'completed',
          progress: 100,
        ),
      );

      expect(controller.agents, hasLength(1));
      expect(controller.agents.single.status, 'completed');
      expect(controller.agents.single.summary, 'preserved result');
      controller.dispose();
    },
  );

  test(
    'opening Agent details refreshes the encrypted activity payload',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _AgentActivityRelayApi(key);
      final controller = _controller(api: api)
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);

      controller.agents = [
        RelayAgent(
          id: 'agent_1',
          threadId: 'thread_agent_1',
          parentSessionId: 'root_1',
          name: 'Mobile audit',
          task: 'Inspect',
          status: 'running',
          progress: 0,
          model: 'native-child-model',
          tokenCount: 1234,
          summary: 'Earlier result',
        ),
      ];
      await controller.refreshAgentActivity('root_1');

      expect(api.commandType, 'session.read_agents');
      expect(api.commandSessionId, 'root_1');
      expect(controller.agentActivityLoadingForSession('root_1'), isFalse);
      expect(controller.agentActivityErrorForSession('root_1'), isNull);
      expect(controller.agents.single.task, 'Inspect the mobile detail window');
      expect(controller.agents.single.activity, 'Reading encrypted activity');
      expect(controller.agents.single.activityLog, hasLength(1));
      expect(controller.agents.single.model, 'native-child-model');
      expect(controller.agents.single.tokenCount, 1234);
      expect(controller.agents.single.summary, 'Earlier result');
    },
  );

  test('late agent activity does not overwrite a newer live event', () {
    final controller = _controller();
    addTearDown(controller.dispose);
    for (final second in [7, 3]) {
      controller.applyEventForTesting(
        RelayEvent(
          cursor: second,
          eventId: 'activity-$second',
          sessionId: 'root_1',
          agentId: 'agent_1',
          createdAt: '2026-09-18T14:32:0${second}Z',
          event: {
            'kind': 'agent.progress',
            'current_activity': 'activity-$second',
          },
        ),
      );
    }
    expect(controller.agents.single.activity, 'activity-7');
    expect(controller.agents.single.updatedAt, '2026-09-18T14:32:07Z');
  });

  for (final concurrentEvent in [false, true]) {
    test(
      'authoritative agent refresh repairs cached timestamps and preserves concurrent events ($concurrentEvent)',
      () async {
        final key = RelayKey.import(_testKey());
        final api = _AgentActivityRelayApi(
          key,
          status: 'completed',
          updatedAt: '2026-10-08T01:00:00Z',
        );
        final controller = _controller(api: api)
          ..bootstrap = _bootstrap()
          ..relayKey = key;
        addTearDown(controller.dispose);
        controller.applyEventForTesting(
          RelayEvent(
            cursor: 1,
            eventId: 'cached-stale-running',
            sessionId: 'root_1',
            agentId: 'agent_1',
            createdAt: '2026-10-09T01:00:00Z',
            event: {'kind': 'agent.progress', 'agent_status': 'running'},
          ),
        );
        if (concurrentEvent) {
          api.onRead = () => controller.applyEventForTesting(
            RelayEvent(
              cursor: 2,
              eventId: 'new-live-turn',
              sessionId: 'root_1',
              agentId: 'agent_1',
              createdAt: '2026-10-10T01:00:00Z',
              event: {
                'kind': 'agent.progress',
                'agent_status': 'running',
                'current_activity': 'new turn',
              },
            ),
          );
        }
        await controller.refreshAgentActivity('root_1');
        expect(
          controller.agents.single.status,
          concurrentEvent ? 'running' : 'completed',
        );
        if (concurrentEvent) {
          expect(controller.agents.single.activity, 'new turn');
        }
      },
    );
  }

  test('Agent activity refresh keeps relay errors generic', () async {
    final key = RelayKey.import(_testKey());
    final api = _AgentActivityRelayApi(key, errorResponse: true);
    final controller = _controller(api: api)
      ..bootstrap = _bootstrap()
      ..relayKey = key;
    addTearDown(controller.dispose);

    await controller.refreshAgentActivity('root_1');

    expect(controller.agentActivityLoadingForSession('root_1'), isFalse);
    expect(
      controller.agentActivityErrorForSession('root_1'),
      '暂时无法刷新这个子 Agent 的运行内容。',
    );
  });
}

class _AgentActivityRelayApi extends RelayApi {
  _AgentActivityRelayApi(
    this.key, {
    this.errorResponse = false,
    this.status = 'running',
    this.updatedAt,
  });

  final RelayKey key;
  final bool errorResponse;
  final String status;
  final String? updatedAt;
  void Function()? onRead;
  String? commandType;
  String? commandSessionId;

  @override
  Future<CommandResult> sendCommand({
    required String deviceId,
    required String? sessionId,
    required String requestId,
    required String commandType,
    required String createdAt,
    required String expiresAt,
    required RelayAad aad,
    required SealedEnvelope envelope,
  }) async {
    this.commandType = commandType;
    commandSessionId = sessionId;
    return CommandResult(requestId: requestId, delivery: 'delivered');
  }

  @override
  Future<OpaqueFrame> encryptedResponse(
    String requestId, {
    bool preserveCompression = false,
    DownloadProgressCallback? onProgress,
    Future<void>? abortTrigger,
    Duration? maxWait,
  }) async {
    onRead?.call();
    final createdAt = DateTime.now().toUtc().toIso8601String();
    final responseType = errorResponse
        ? 'session.agents_error'
        : 'session.agents';
    final aad = RelayAad(
      direction: 'relay_to_web',
      type: responseType,
      deviceId: 'device',
      sessionId: 'root_1',
      requestId: requestId,
      eventSeq: null,
      createdAt: createdAt,
      expiresAt: null,
    );
    final payload = <String, Object?>{
      'type': responseType,
      'request_id': requestId,
      'session_id': 'root_1',
      if (errorResponse) 'error': 'private relay detail that must not leak',
      if (!errorResponse)
        'agents': [
          {
            'id': 'agent_1',
            'thread_id': 'thread_agent_1',
            'parent_session_id': 'root_1',
            'name': 'Mobile audit',
            'task': 'Inspect the mobile detail window',
            'status': status,
            if (updatedAt != null) 'updated_at': updatedAt,
            'progress': 55,
            'current_activity': 'Reading encrypted activity',
            'activity_log': [
              {
                'id': 'activity_1',
                'kind': 'tool',
                'label': 'Read workbench_screen.dart',
                'occurred_at': createdAt,
              },
            ],
          },
        ],
    };
    return OpaqueFrame(
      deviceId: 'device',
      sessionId: 'root_1',
      requestId: requestId,
      aad: aad,
      envelope: await RelayCipher().sealJson(key, payload, aad),
    );
  }
}

ServerBootstrap _bootstrap() => ServerBootstrap(
  email: 'owner@example.com',
  device: const RelayDevice(
    id: 'device',
    name: 'Test Mac',
    online: true,
    agentConnected: true,
    lastSeenAt: '2026-08-10T08:00:00.000Z',
  ),
  catalog: null,
  events: const [],
  cursor: 0,
  ackSequence: 0,
  queuedCommands: 0,
);

String _testKey() => base64Url
    .encode(List<int>.generate(32, (index) => index))
    .replaceAll('=', '');

AppController _controller({String provider = 'codex', RelayApi? api}) {
  final session = RelaySession.fromJson({
    'id': 'root_1',
    'name': 'Root session',
    'project': 'relayune',
    'branch': 'main',
    'cwd': '/workspace/relayune',
    'status': 'active',
    'updated_at': '2026-08-10T08:00:00.000Z',
    'provider': provider,
    'is_subagent': false,
    'root_session_id': 'root_1',
  });
  return AppController(api: api)
    ..sessions = [session]
    ..activeSessionId = session.id;
}

RelayEvent _turnEvent(String kind) => RelayEvent(
  cursor: 1,
  eventId: 'evt_$kind',
  sessionId: 'root_1',
  agentId: null,
  createdAt: '2026-08-10T08:00:00.000Z',
  event: {'kind': kind, 'turn_id': 'turn_1'},
);

RelayEvent _agentEvent({
  required String agentId,
  String kind = 'agent.updated',
  String status = 'running',
  int progress = 10,
  String? summary,
  String rootSessionId = 'root_1',
}) => RelayEvent(
  cursor: progress,
  eventId: 'evt_${agentId}_${kind}_$progress',
  sessionId: rootSessionId,
  agentId: agentId,
  createdAt: '2026-08-10T08:00:00.000Z',
  event: {
    'kind': kind,
    'agent_status': status,
    'root_session_id': rootSessionId,
    'thread_id': 'thread_$agentId',
    'name': agentId,
    'task': 'Task for $agentId',
    'progress': progress,
    if (summary != null) 'summary': summary,
    'updated_at': '2026-08-10T08:00:00.000Z',
  },
);
