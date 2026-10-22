import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';

import '../support/workbench_fixture.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';

void main() {
  testWidgets(
    '[MOB-CWK-001][flutter] Cowork projects and sessions have their own provider filter',
    (tester) async {
      final controller = workbenchController(
        baseController: AppController(secureStore: _CoworkSecureStore()),
        sessions: [
          relaySession(id: 'codex', name: 'Codex session', project: 'Relayune'),
          relaySession(
            id: 'cowork',
            name: 'Cowork planning',
            project: 'Game design',
            cwd: '/workspace/game-design',
            provider: 'claude-cowork',
          ),
        ],
      );
      addTearDown(controller.dispose);
      expect(await controller.setVisibleAgents(['codex', 'claude-cowork']), isTrue);
      await pumpWorkbench(tester, controller, size: const Size(320, 700));

      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      await tester.tap(
        find.byKey(const ValueKey('drawer-agent-claude-cowork')),
      );
      await tester.pump();

      expect(find.text('Game design'), findsOneWidget);
      expect(
        find.byKey(
          const ValueKey('project-group-title-path:/workspace/relayune'),
        ),
        findsNothing,
      );
      await tester.tap(find.text('Game design'));
      await tester.pump(const Duration(milliseconds: 320));
      expect(find.text('Cowork planning'), findsOneWidget);
      expect(
        find.text('请先在 Claude Desktop 创建 Cowork 任务；已有任务可在这里控制。'),
        findsOneWidget,
      );
      final createButton = tester.widget<TextButton>(
        find.byKey(
          const ValueKey('project-create-session-path:/workspace/game-design'),
        ),
      );
      expect(createButton.onPressed, isNull);
      expect(tester.takeException(), isNull);
    },
  );

  test(
    '[MOB-CWK-004][flutter] Cowork creation stops before transport',
    () async {
      final session = relaySession(
        id: 'cowork',
        project: 'Game design',
        cwd: '/workspace/game-design',
        provider: 'claude-cowork',
      );
      final controller = workbenchController(sessions: [session]);
      addTearDown(controller.dispose);

      await controller.createSessionInProject(session, 'New Cowork task');

      expect(controller.error, '请先在 Claude Desktop 创建 Cowork 任务，再从这里控制。');
      expect(controller.sessionCreationInFlight, isFalse);
      expect(controller.activeSessionId, 'cowork');
    },
  );

  testWidgets(
    '[MOB-CWK-002][flutter] Cowork conversation sends messages, resolves approvals, and configures model and permissions',
    (tester) async {
      final base = relaySession(
        id: 'cowork',
        name: 'Cowork session',
        project: 'Game design',
        cwd: '/workspace/game-design',
        provider: 'claude-cowork',
      );
      final session = RelaySession.fromJson({
        ...base.raw,
        'session_config_options': [
          {
            'type': 'select',
            'id': 'model',
            'name': 'Model',
            'currentValue': 'sonnet',
            'options': [
              {'value': 'sonnet', 'name': 'Sonnet'},
              {'value': 'opus', 'name': 'Opus'},
            ],
          },
          {
            'type': 'select',
            'id': 'mode',
            'name': 'Permission mode',
            'currentValue': 'default',
            'options': [
              {'value': 'default', 'name': 'Ask every time'},
              {
                'value': 'bypassPermissions',
                'name': 'Bypass permissions',
                'description': 'Allow every local tool without asking.',
              },
            ],
          },
        ],
      });
      final capture = _CoworkCaptureController();
      final controller = workbenchController(
        baseController: capture,
        sessions: [session],
        approvals: [_approval('allow'), _approval('reject')],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller, size: const Size(390, 844));

      expect(find.textContaining('Claude Cowork'), findsWidgets);
      await tester.tap(
        find.byKey(const ValueKey('cowork-session-settings-button')),
      );
      await tester.pump();
      expect(
        find.byKey(const ValueKey('cowork-session-settings-panel')),
        findsOneWidget,
      );
      expect(find.text('Model'), findsOneWidget);
      expect(find.text('Permission mode'), findsOneWidget);

      await tester.tap(find.text('Opus'));
      await tester.pump();
      expect(capture.configurations, [(id: 'model', value: 'opus')]);

      await tester.ensureVisible(find.text('Bypass permissions'));
      await tester.tap(find.text('Bypass permissions'));
      await tester.pump();
      expect(find.text('更改权限模式？'), findsOneWidget);
      expect(
        find.text('Allow every local tool without asking.'),
        findsOneWidget,
      );
      await tester.tap(find.text('确认启用'));
      await tester.pump();
      expect(capture.configurations, [
        (id: 'model', value: 'opus'),
        (id: 'mode', value: 'bypassPermissions'),
      ]);

      await tester.tap(find.byTooltip('关闭'));
      await tester.pump();
      final allow = find.byKey(
        const ValueKey('conversation-approval-allow-allow'),
      );
      await tester.ensureVisible(allow);
      await tester.tap(allow);
      await tester.pump();
      final reject = find.byKey(
        const ValueKey('conversation-approval-reject-reject'),
      );
      await tester.ensureVisible(reject);
      await tester.tap(reject);
      await tester.pump();
      expect(capture.decisions, [
        (id: 'allow', decision: 'approved'),
        (id: 'reject', decision: 'rejected'),
      ]);

      await tester.enterText(find.byType(TextField).last, 'Continue in Cowork');
      await tester.tap(find.byKey(const ValueKey('composer-send-button')));
      await tester.pump();
      expect(capture.sentMessages, ['Continue in Cowork']);
      expect(tester.takeException(), isNull);
    },
  );
}

RelayApproval _approval(String id) => RelayApproval(
  id: id,
  sessionId: 'cowork',
  action: const {
    'type': 'command.execute',
    'display': 'flutter test',
    'cwd': '/workspace/game-design',
    'command_hash': 'sha256:cowork',
  },
  riskLevel: 'low',
  state: 'pending',
  requestedAt: '2026-09-05T08:00:00.000Z',
  expiresAt: '2099-09-05T09:00:00.000Z',
);

class _CoworkCaptureController extends AppController {
  final List<String> sentMessages = [];
  final List<({String id, Object value})> configurations = [];
  final List<({String id, String decision})> decisions = [];

  @override
  Future<MessageSendOutcome> sendMessage(
    String content, {
    List<UploadAttachment> attachments = const [],
  }) async {
    sentMessages.add(content);
    return MessageSendOutcome.delivered;
  }

  @override
  Future<void> configureSession(String configId, Object value) async {
    configurations.add((id: configId, value: value));
  }

  @override
  Future<void> decideApproval(
    RelayApproval approval,
    String decision, {
    String? optionId,
    String? answer,
    bool acknowledgeWithHaptics = true,
  }) async {
    decisions.add((id: approval.id, decision: decision));
  }
}

class _CoworkSecureStore extends SecureStore {
  @override
  Future<void> saveVisibleAgents(List<String> values) async {}
}
