import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/notifications/notification_coordinator.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';

void main() {
  test(
    'active remote delivery suppresses duplicate background alerts, with local fallback',
    () async {
      final gateway = _FakeGateway();
      final coordinator = RelayNotificationCoordinator(
        gateway: gateway,
        now: () => DateTime.parse('2026-08-11T10:00:00Z'),
      );
      addTearDown(coordinator.dispose);
      await coordinator.initialize();
      coordinator.setForeground(false);
      coordinator.remoteBackgroundDeliveryActive = true;
      coordinator.handleDecryptedEvent(
        _event(id: 'remote', kind: 'turn.completed'),
      );
      await Future<void>.delayed(Duration.zero);
      expect(gateway.shown, isEmpty);
      coordinator.remoteBackgroundDeliveryActive = false;
      coordinator.handleDecryptedEvent(
        _event(id: 'local', kind: 'turn.completed'),
      );
      await Future<void>.delayed(Duration.zero);
      expect(gateway.shown, hasLength(1));
    },
  );

  test(
    'events arriving during slow startup are delivered once in order',
    () async {
      final gate = Completer<void>();
      final gateway = _FakeGateway(initializationGate: gate.future);
      final coordinator = RelayNotificationCoordinator(
        gateway: gateway,
        now: () => DateTime.parse('2026-08-11T10:00:00Z'),
      );
      addTearDown(coordinator.dispose);
      coordinator.setForeground(false);
      final initializing = coordinator.initialize();
      final event = _event(id: 'evt_startup', kind: 'turn.completed');
      coordinator.handleDecryptedEvent(event);
      expect(gateway.shown, isEmpty);
      gate.complete();
      await initializing;
      coordinator.handleDecryptedEvent(event);
      expect(gateway.shown, hasLength(1));
    },
  );

  test('disposing during plugin startup discards pending events', () async {
    final gate = Completer<void>();
    final gateway = _FakeGateway(initializationGate: gate.future);
    final coordinator = RelayNotificationCoordinator(gateway: gateway);
    coordinator.setForeground(false);
    final initializing = coordinator.initialize();
    coordinator.handleDecryptedEvent(
      _event(id: 'evt_disposed_startup', kind: 'turn.completed'),
    );
    coordinator.dispose();
    gate.complete();
    await initializing;
    expect(gateway.shown, isEmpty);
    expect(coordinator.initialized, isFalse);
  });

  test(
    '[MOB-NOT-001][flutter] decrypted approval creates generic local notification',
    () async {
      final gateway = _FakeGateway();
      final coordinator = RelayNotificationCoordinator(
        gateway: gateway,
        now: () => DateTime.parse('2026-08-11T10:00:00Z'),
      );
      addTearDown(coordinator.dispose);
      await coordinator.initialize();
      coordinator.setForeground(false);

      coordinator.handleDecryptedEvent(
        _event(
          id: 'evt_approval',
          kind: 'approval.requested',
          extra: {
            'approval_id': 'apr_command',
            'expires_at': '2026-08-11T10:02:00Z',
            'action': {
              'type': 'command.execute',
              'command': 'print-secret',
              'cwd': '/private/project',
            },
          },
        ),
      );
      await Future<void>.delayed(Duration.zero);

      expect(gateway.shown, hasLength(1));
      final notification = gateway.shown.single;
      expect(notification.title, '操作等待确认');
      expect(notification.subtitle, 'Codex · 任务已暂停');
      expect(notification.body, '请在 2 分钟内允许或拒绝这项操作。');
      expect(notification.kind, RelayNotificationKind.approval);
      expect(notification.actions, [
        RelayNotificationAction.approveOnce,
        RelayNotificationAction.reject,
      ]);
      expect(notification.title, isNot(contains('print-secret')));
      expect(notification.body, isNot(contains('/private/project')));
      expect(jsonDecode(notification.payload), {
        'session_id': 'session_root',
        'target': 'conversation',
        'kind': 'approval',
        'approval_id': 'apr_command',
      });
    },
  );

  test(
    '[MOB-NOT-009][flutter] question approval has distinct generic copy and routes to its root conversation',
    () async {
      final gateway = _FakeGateway();
      final coordinator = RelayNotificationCoordinator(
        gateway: gateway,
        now: () => DateTime.parse('2026-08-11T10:00:00Z'),
      );
      addTearDown(coordinator.dispose);
      await coordinator.initialize();
      coordinator.setForeground(false);

      coordinator.handleDecryptedEvent(
        _event(
          id: 'evt_question',
          kind: 'approval.requested',
          sessionId: 'session_agent',
          extra: {
            'approval_id': 'apr_question',
            'root_session_id': 'session_root',
            'expires_at': '2026-08-11T10:02:00Z',
            'action': {
              'type': 'question.select',
              'display': 'Which private project should be opened?',
            },
          },
        ),
      );
      await Future<void>.delayed(Duration.zero);

      expect(gateway.shown, hasLength(1));
      final notification = gateway.shown.single;
      expect(notification.title, '需要你的回答');
      expect(notification.body, '请在 2 分钟内回答，任务会在提交后继续。');
      expect(notification.kind, RelayNotificationKind.question);
      expect(notification.actions, [RelayNotificationAction.answer]);
      expect(notification.sessionId, 'session_root');
      expect(notification.body, isNot(contains('private project')));
    },
  );

  test(
    '[MOB-NOT-002][flutter] current foreground session is silent but another session is visible',
    () async {
      final gateway = _FakeGateway();
      final coordinator = RelayNotificationCoordinator(
        gateway: gateway,
        now: () => DateTime.parse('2026-08-11T10:00:00Z'),
      );
      await coordinator.initialize();
      coordinator
        ..setForeground(true)
        ..setActiveSession('session_root');

      coordinator.handleDecryptedEvent(
        _event(id: 'evt_current', kind: 'turn.completed'),
      );
      coordinator.handleDecryptedEvent(
        _event(
          id: 'evt_other',
          kind: 'turn.completed',
          sessionId: 'session_other',
        ),
      );
      await Future<void>.delayed(Duration.zero);

      expect(gateway.shown, hasLength(1));
      expect(gateway.shown.single.sessionId, 'session_other');
    },
  );

  test(
    '[MOB-NOT-003][flutter] only a fresh root turn completion notifies once',
    () async {
      final gateway = _FakeGateway();
      final coordinator = RelayNotificationCoordinator(
        gateway: gateway,
        now: () => DateTime.parse('2026-08-11T10:00:00Z'),
      );
      await coordinator.initialize();
      coordinator
        ..setSessionCatalog([
          _session(id: 'session_root', name: '优化移动端通知栏', provider: 'claude'),
        ])
        ..setForeground(false);

      for (final event in [
        _event(id: 'agent_done', kind: 'agent.completed'),
        _event(id: 'agent_failed', kind: 'agent.failed'),
        _event(
          id: 'message_done',
          kind: 'message.completed',
          extra: {
            'turn_id': 'turn_root',
            'text':
                '已完成通知引导，用户可以先了解审批、提问和任务完成提醒；连接码 12345678。\n\n'
                '更多技术细节不应出现在通知里。',
          },
        ),
        _event(
          id: 'turn_done',
          kind: 'turn.completed',
          extra: {'turn_id': 'turn_root', 'status': 'completed'},
        ),
        _event(id: 'turn_failed', kind: 'turn.failed'),
      ]) {
        coordinator.handleDecryptedEvent(event);
      }
      coordinator.handleDecryptedEvent(
        _event(id: 'agent_done', kind: 'agent.completed'),
      );
      coordinator.handleDecryptedEvent(
        _event(
          id: 'stale',
          kind: 'turn.completed',
          createdAt: '2026-08-11T09:00:00Z',
        ),
      );
      await Future<void>.delayed(Duration.zero);

      expect(gateway.shown, hasLength(1));
      expect(gateway.shown.single.title, 'Claude 任务已完成');
      expect(gateway.shown.single.subtitle, '优化移动端通知栏');
      expect(
        gateway.shown.single.body,
        '已完成通知引导，用户可以先了解审批、提问和任务完成提醒；连接码 ••••••••。',
      );
      expect(gateway.shown.single.body, isNot(contains('更多技术细节')));
      expect(gateway.shown.single.body, isNot(contains('12345678')));
      expect(gateway.shown.single.kind, RelayNotificationKind.completion);
      expect(gateway.shown.single.actions, isEmpty);
    },
  );

  test(
    '[MOB-NOT-010][flutter] subagent and user-ended turns do not create completion notifications',
    () async {
      final gateway = _FakeGateway();
      final coordinator = RelayNotificationCoordinator(
        gateway: gateway,
        now: () => DateTime.parse('2026-08-11T10:00:00Z'),
      );
      await coordinator.initialize();
      coordinator.setForeground(false);

      coordinator.handleDecryptedEvent(
        _event(id: 'subagent_done', kind: 'turn.completed'),
        isRootSession: false,
      );
      for (final status in ['interrupted', 'declined', 'cancelled']) {
        coordinator.handleDecryptedEvent(
          _event(
            id: 'turn_$status',
            kind: 'turn.completed',
            extra: {'status': status},
          ),
        );
      }
      await Future<void>.delayed(Duration.zero);

      expect(gateway.shown, isEmpty);
    },
  );

  test(
    '[MOB-NOT-011][flutter] unusable approvals stay silent and a resolution cancels an existing alert',
    () async {
      final gateway = _FakeGateway();
      final coordinator = RelayNotificationCoordinator(
        gateway: gateway,
        now: () => DateTime.parse('2026-08-11T10:00:00Z'),
      );
      addTearDown(coordinator.dispose);
      await coordinator.initialize();
      coordinator.setForeground(false);

      coordinator.handleDecryptedEvent(
        _event(
          id: 'approval_too_late',
          kind: 'approval.requested',
          extra: {
            'approval_id': 'apr_too_late',
            'expires_at': '2026-08-11T10:00:10Z',
            'action': {'type': 'command.execute'},
          },
        ),
      );
      coordinator.handleDecryptedEvent(
        _event(
          id: 'approval_pending',
          kind: 'approval.requested',
          extra: {
            'approval_id': 'apr_pending',
            'expires_at': '2026-08-11T10:02:00Z',
            'action': {'type': 'command.execute'},
          },
        ),
      );
      coordinator.handleDecryptedEvent(
        _event(
          id: 'approval_resolved',
          kind: 'approval.resolved',
          extra: {'approval_id': 'apr_pending', 'decision': 'approved'},
        ),
      );
      await Future<void>.delayed(Duration.zero);

      expect(gateway.shown, hasLength(1));
      expect(gateway.cancelled, [gateway.shown.single.id]);
    },
  );

  test(
    '[MOB-NOT-004][flutter] notification tap accepts routing only',
    () async {
      final gateway = _FakeGateway(
        launchPayload: jsonEncode({
          'session_id': 'session_root',
          'target': 'agents',
          'content': 'ignored',
        }),
      );
      final coordinator = RelayNotificationCoordinator(gateway: gateway);
      await coordinator.initialize();
      RelayNotificationOpenRequest? opened;
      coordinator.onOpenRequest = (request) => opened = request;

      expect(opened?.sessionId, 'session_root');
      expect(opened?.target, RelayNotificationTarget.agents);
    },
  );

  test(
    '[MOB-NOT-013][flutter] actionable approval responses route only opaque identifiers',
    () async {
      final gateway = _FakeGateway();
      final coordinator = RelayNotificationCoordinator(
        gateway: gateway,
        now: () => DateTime.parse('2026-08-11T10:00:00Z'),
      );
      await coordinator.initialize();
      coordinator.setForeground(false);
      coordinator.handleDecryptedEvent(
        _event(
          id: 'evt_action',
          kind: 'approval.requested',
          extra: {
            'approval_id': 'apr_action',
            'expires_at': '2026-08-11T10:02:00Z',
            'risk_level': 'medium',
            'action': {'type': 'command.execute', 'display': 'private command'},
          },
        ),
      );
      await Future<void>.delayed(Duration.zero);
      RelayNotificationActionRequest? actionRequest;
      coordinator.onActionRequest = (request) => actionRequest = request;

      gateway.respond(
        gateway.shown.single.payload,
        relayNotificationApproveActionId,
      );

      expect(actionRequest?.sessionId, 'session_root');
      expect(actionRequest?.approvalId, 'apr_action');
      expect(actionRequest?.action, RelayNotificationAction.approveOnce);
      expect(gateway.shown.single.payload, isNot(contains('private command')));
    },
  );

  test(
    '[MOB-NOT-014][flutter] high-risk and policy approvals never expose blind approval actions',
    () async {
      final gateway = _FakeGateway();
      final coordinator = RelayNotificationCoordinator(
        gateway: gateway,
        now: () => DateTime.parse('2026-08-11T10:00:00Z'),
      );
      await coordinator.initialize();
      coordinator.setForeground(false);
      coordinator.handleDecryptedEvent(
        _event(
          id: 'evt_high',
          kind: 'approval.requested',
          extra: {
            'approval_id': 'apr_high',
            'expires_at': '2026-08-11T10:02:00Z',
            'risk_level': 'high',
            'action': {'type': 'command.execute'},
          },
        ),
      );
      coordinator.handleDecryptedEvent(
        _event(
          id: 'evt_policy',
          kind: 'approval.requested',
          extra: {
            'approval_id': 'apr_policy',
            'expires_at': '2026-08-11T10:02:00Z',
            'risk_level': 'medium',
            'action': {
              'type': 'command.execute',
              'options': [
                {'option_id': 'allow_policy', 'kind': 'allow_policy'},
                {'option_id': 'reject_cancel', 'kind': 'reject_cancel'},
              ],
            },
          },
        ),
      );
      await Future<void>.delayed(Duration.zero);

      expect(gateway.shown[0].actions, [RelayNotificationAction.reject]);
      expect(gateway.shown[1].actions, isEmpty);
    },
  );

  test(
    '[MOB-NOT-006][flutter] initialization reads status without prompting and explicit action requests permission',
    () async {
      final gateway = _FakeGateway(currentAuthorizationEnabled: false);
      final coordinator = RelayNotificationCoordinator(gateway: gateway);

      await coordinator.initialize();
      expect(
        coordinator.authorization,
        RelayNotificationAuthorization.disabled,
      );
      expect(gateway.authorizationRequests, 0);

      await coordinator.requestAuthorization();
      expect(gateway.authorizationRequests, 1);
      expect(coordinator.authorization, RelayNotificationAuthorization.enabled);
    },
  );

  test(
    'locale changes update notification copy and propagate to the native gateway',
    () async {
      final gateway = _FakeGateway();
      final coordinator = RelayNotificationCoordinator(
        gateway: gateway,
        now: () => DateTime.parse('2026-08-11T10:00:00Z'),
      );
      addTearDown(coordinator.dispose);
      await coordinator.initialize();
      coordinator
        ..setForeground(false)
        ..setLocale(const Locale('ar'));

      coordinator.handleDecryptedEvent(
        _event(
          id: 'evt_arabic_approval',
          kind: 'approval.requested',
          extra: {
            'approval_id': 'apr_arabic',
            'expires_at': '2026-08-11T10:02:00Z',
            'action': {'type': 'command.execute'},
          },
        ),
      );
      await Future<void>.delayed(Duration.zero);

      expect(gateway.locales, [const Locale('ar')]);
      expect(
        gateway.shown.single.title,
        relayuneLocalizationsFor(const Locale('ar')).notificationApprovalTitle,
      );
    },
  );

  test(
    '[MOB-NOT-005][flutter] controller forwards an event only after decrypt/apply dedup',
    () {
      final sink = _RecordingSink();
      final controller = AppController(eventNotifications: sink);
      final event = _event(id: 'evt_forwarded', kind: 'turn.completed');

      controller.applyEventForTesting(event);
      controller.applyEventForTesting(event);

      expect(sink.events, [event]);
      expect(sink.rootSessionFlags, [true]);
      controller.dispose();
    },
  );

  test(
    '[MOB-NOT-012][flutter] controller marks catalog subagent turns as non-root notification events',
    () {
      final sink = _RecordingSink();
      final controller = AppController(eventNotifications: sink);
      controller.replaceSessionsForTesting([
        _session(id: 'session_root'),
        _session(
          id: 'session_agent',
          isSubagent: true,
          rootSessionId: 'session_root',
        ),
      ]);
      final event = _event(
        id: 'evt_agent_turn',
        kind: 'turn.completed',
        sessionId: 'session_agent',
      );

      controller.applyEventForTesting(event);

      expect(sink.events, [event]);
      expect(sink.rootSessionFlags, [false]);
      controller.dispose();
    },
  );
}

RelayEvent _event({
  required String id,
  required String kind,
  String sessionId = 'session_root',
  String createdAt = '2026-08-11T09:59:30Z',
  Map<String, dynamic> extra = const {},
}) => RelayEvent(
  cursor: 1,
  eventId: id,
  sessionId: sessionId,
  agentId: kind.startsWith('agent.') ? 'agent_1' : null,
  createdAt: createdAt,
  event: {'kind': kind, ...extra},
);

RelaySession _session({
  required String id,
  String? name,
  String provider = 'codex',
  bool isSubagent = false,
  String? rootSessionId,
}) => RelaySession(
  id: id,
  name: name ?? id,
  project: 'Relayune',
  branch: 'main',
  cwd: '/workspace',
  status: 'idle',
  updatedAt: '2026-08-11T10:00:00Z',
  provider: provider,
  isSubagent: isSubagent,
  rootSessionId: rootSessionId ?? id,
  supportsSteering: true,
  canInterrupt: true,
  raw: const {},
);

class _FakeGateway
    implements RelayNotificationGateway, RelayNotificationLocaleGateway {
  _FakeGateway({
    this.launchPayload,
    this.currentAuthorizationEnabled = true,
    this.initializationGate,
  });

  final Future<void>? initializationGate;

  final String? launchPayload;
  final bool? currentAuthorizationEnabled;
  final List<RelayLocalNotification> shown = [];
  final List<int> cancelled = [];
  final List<Locale> locales = [];
  int authorizationRequests = 0;
  RelayNotificationResponseCallback? responseCallback;

  @override
  Future<String?> initialize({
    required RelayNotificationResponseCallback onResponse,
  }) async {
    responseCallback = onResponse;
    await initializationGate;
    return launchPayload;
  }

  void respond(String payload, String? actionId) {
    responseCallback?.call(payload, actionId);
  }

  @override
  Future<bool> requestAuthorization() async {
    authorizationRequests += 1;
    return true;
  }

  @override
  Future<bool?> authorizationEnabled() async => currentAuthorizationEnabled;

  @override
  Future<void> openSettings() async {}

  @override
  Future<void> setLocale(Locale locale) async {
    locales.add(locale);
  }

  @override
  Future<void> show(RelayLocalNotification notification) async {
    shown.add(notification);
  }

  @override
  Future<void> cancel(int notificationId) async {
    cancelled.add(notificationId);
  }
}

class _RecordingSink implements RelayEventNotificationSink {
  final List<RelayEvent> events = [];
  final List<bool> rootSessionFlags = [];

  @override
  void handleDecryptedEvent(RelayEvent record, {bool isRootSession = true}) {
    events.add(record);
    rootSessionFlags.add(isRootSession);
  }
}
