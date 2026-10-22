import 'dart:convert';
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/device_connection.dart';

import '../support/codex_message_settings_fixture.dart';

void main() {
  test(
    '[MOB-PRJ-017] Codex selection is local, survives stale catalogs and is frozen inside each encrypted message',
    () async {
      final api = _CaptureRelayApi();
      final session = codexMessageSettingsSession();
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = RelayKey.import(_testKey())
        ..sessions = [session, codexMessageSettingsSession(id: 'peer')]
        ..activeSessionId = session.id
        ..connectionSnapshot = const DeviceConnectionSnapshot(
          online: true,
          lastSeenAt: '2026-08-12T08:00:00.000Z',
          revision: 1,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        );
      addTearDown(controller.dispose);
      controller.runningSessions.add(session.id);
      await controller.configureSession('model', 'next');
      expect(api.commandTypes, isEmpty);
      expect(controller.configuringSessions, isEmpty);
      expect(
        controller
            .sessionConfigOptions(session)
            .firstWhere((x) => x['id'] == 'reasoning')['currentValue'],
        'medium',
      );
      await controller.configureSession('reasoning', 'high');
      await controller.configureSession('permissions', 'manual');
      controller.replaceSessionsForTesting([
        session,
        codexMessageSettingsSession(id: 'peer'),
      ]);
      expect(
        controller
            .sessionConfigOptions(controller.activeSession!)
            .first['currentValue'],
        'next',
      );
      expect(
        controller
            .sessionConfigOptions(controller.sessions.last)
            .first['currentValue'],
        'first',
      );
      expect(
        controller
            .sessionConfigOptions(controller.activeSession!)
            .last['currentValue'],
        'manual',
      );
      expect(
        controller
            .sessionConfigOptions(controller.sessions.last)
            .last['currentValue'],
        'default',
      );
      // The choice made while the send is in flight belongs to the following message.
      api.onSend = () {
        unawaited(controller.configureSession('model', 'first'));
        unawaited(controller.configureSession('permissions', 'auto'));
      };
      expect((await controller.sendMessage('one')).accepted, isTrue);
      var sent = await RelayCipher().openJson<Map<String, dynamic>>(
        controller.relayKey!,
        api.envelope!,
        api.aad!,
      );
      expect(sent['payload']['runtime_settings'], {
        'model': 'next',
        'effort': 'high',
        'permissions': 'manual',
      });
      expect(sent['payload']['interrupt_running'], isTrue);
      expect(api.commandFrames.single, isNot(contains('runtime_settings')));
      expect(
        controller
            .sessionConfigOptions(controller.activeSession!)
            .first['currentValue'],
        'first',
      );
      api.onSend = null;
      expect((await controller.sendMessage('two')).accepted, isTrue);
      sent = await RelayCipher().openJson<Map<String, dynamic>>(
        controller.relayKey!,
        api.envelope!,
        api.aad!,
      );
      expect(sent['payload']['runtime_settings'], {
        'model': 'first',
        'effort': 'high',
        'permissions': 'auto',
      });
      expect(api.commandTypes, [
        'session.submit_message',
        'session.submit_message',
      ]);
    },
  );

  test(
    'permission-only preselection neither selects a model nor sends a configure request',
    () async {
      final api = _CaptureRelayApi();
      final session = codexMessageSettingsSession();
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = RelayKey.import(_testKey())
        ..sessions = [session]
        ..activeSessionId = session.id
        ..connectionSnapshot = const DeviceConnectionSnapshot(
          online: true,
          lastSeenAt: '2026-08-12T08:00:00.000Z',
          revision: 1,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        );
      addTearDown(controller.dispose);
      await controller.configureSession('permissions', 'manual');
      expect(
        controller.sessionConfigOptions(session).first['currentValue'],
        'first',
      );
      expect(api.commandTypes, isEmpty);
      expect(
        (await controller.sendMessage('use chosen permissions')).accepted,
        isTrue,
      );
      final sent = await RelayCipher().openJson<Map<String, dynamic>>(
        controller.relayKey!,
        api.envelope!,
        api.aad!,
      );
      expect(sent['payload']['runtime_settings'], {'permissions': 'manual'});
      expect(api.commandTypes, ['session.submit_message']);
    },
  );

  test(
    '[MOB-PRJ-017] offline local selection validates effort and stays scoped to its session',
    () async {
      final api = _CaptureRelayApi();
      final session = codexMessageSettingsSession();
      final controller = AppController(api: api)
        ..sessions = [session]
        ..activeSessionId = session.id;
      addTearDown(controller.dispose);
      await controller.configureSession('model', 'next');
      await controller.configureSession('reasoning', 'low');
      expect(
        controller
            .sessionConfigOptions(session)
            .firstWhere((x) => x['id'] == 'reasoning')['currentValue'],
        'medium',
      );
      await controller.configureSession('permissions', 'manual');
      await controller.configureSession('permissions', 'bogus');
      expect(
        controller.sessionConfigOptions(session).last['currentValue'],
        'manual',
      );
      await controller.configureSession('model', 'unknown');
      expect(
        controller.sessionConfigOptions(session).first['currentValue'],
        'next',
      );
      expect(api.commandTypes, isEmpty);
    },
  );

  for (final provider in ['codex', 'claude', 'kimi']) {
    test(
      '[MOB-PRJ-008] $provider creation navigates without reading empty history',
      () async {
        final api = _CaptureRelayApi();
        final controller = _creationFixture(api, provider: provider);
        addTearDown(controller.dispose);
        await controller.createSessionInProject(
          controller.activeSession!,
          'QA',
        );
        expect(api.commandTypes, ['session.create']);
        expect(controller.activeSessionId, 'created');
        expect(controller.pendingWorkbenchTarget, 'conversation');
        expect(controller.workbenchNavigationRevision, 1);
        expect(controller.historyLoading, isEmpty);
        expect(controller.sessionCreationInFlight, isFalse);
        expect(
          (await controller.sendMessage('first message')).accepted,
          isTrue,
        );
        expect(api.commandSessionIds.last, 'created');
      },
    );
  }

  for (final transient in ['post', 'read']) {
    test(
      '[MOB-PRJ-008] creation recovers a transient $transient error without another operation',
      () async {
        final api = _CaptureRelayApi()
          ..transientConfigurationPost = transient == 'post'
          ..transientConfigurationRead = transient == 'read';
        final controller = _creationFixture(api);
        addTearDown(controller.dispose);
        await controller.createSessionInProject(
          controller.activeSession!,
          'QA',
        );
        expect(controller.error, isEmpty);
        expect(controller.activeSessionId, 'created');
        expect(
          api.commandTypes,
          List.filled(transient == 'post' ? 2 : 1, 'session.create'),
        );
        expect(api.commandFrames.toSet(), hasLength(1));
        expect(api.responseReads, transient == 'read' ? 2 : 1);
      },
    );
  }

  test(
    '[MOB-PRJ-008] retry after uncertain creation only recovers the original request',
    () async {
      final api = _CaptureRelayApi();
      final controller = _creationFixture(
        api,
        base: _CreationRecoveryController(api: api),
      );
      addTearDown(controller.dispose);
      final project = controller.activeSession!;
      await controller.createSessionInProject(project, 'QA');
      expect(controller.activeSessionId, project.id);
      expect(controller.error, isNotEmpty);
      expect(controller.notice, isEmpty);
      final originalId = api.aad!.requestId;
      await controller.createSessionInProject(project, 'QA');
      expect(controller.activeSessionId, 'created');
      expect(controller.error, isEmpty);
      expect(api.commandTypes, ['session.create', 'session.create']);
      expect(api.commandFrames.toSet(), hasLength(1));
      expect((controller as _CreationRecoveryController).requestedIds, [
        originalId,
        originalId,
      ]);
      await controller.createSessionInProject(project, 'QA');
      expect(api.commandTypes, List.filled(3, 'session.create'));
      expect(api.commandFrames.toSet(), hasLength(2));
      expect(api.aad!.requestId, isNot(originalId));
    },
  );

  test(
    '[MOB-PRJ-008] explicit creation rejection allows a new attempt',
    () async {
      final api = _CaptureRelayApi();
      final controller = _creationFixture(api);
      addTearDown(controller.dispose);
      final project = controller.activeSession!;
      api.creationError = 'cannot create';
      await controller.createSessionInProject(project, 'QA');
      final originalId = api.aad!.requestId;
      expect(controller.activeSessionId, project.id);
      expect(controller.notice, isEmpty);
      api.creationError = null;
      await controller.createSessionInProject(project, 'QA');
      expect(controller.activeSessionId, 'created');
      expect(api.aad!.requestId, isNot(originalId));
    },
  );

  test(
    '[MOB-PRJ-008] overlapping clicks and stale authorization cannot activate a creation',
    () async {
      final api = _CaptureRelayApi();
      final held = _HeldCreationController(api: api);
      final controller = _creationFixture(api, base: held);
      addTearDown(controller.dispose);
      final project = controller.activeSession!;
      final first = controller.createSessionInProject(project, 'QA');
      await held.entered.future;
      await controller.createSessionInProject(project, 'QA');
      expect(api.commandTypes, ['session.create']);
      controller.relayKey = RelayKey.import(_testKey());
      held.release.complete();
      await first;
      expect(controller.activeSessionId, project.id);
      expect(controller.workbenchNavigationRevision, 0);
      expect(controller.sessionCreationInFlight, isFalse);
    },
  );

  for (final provider in ['claude', 'kimi', 'pi']) {
    test(
      '$provider running replacement uses encrypted interrupt flag',
      () async {
        final api = _CaptureRelayApi();
        final session = RelaySession.fromJson({
          'id': 'replacement',
          'provider': provider,
          'supports_steering': false,
          'supports_interrupt_and_send': true,
        });
        final controller = AppController(api: api)
          ..phase = AppPhase.ready
          ..bootstrap = _bootstrap()
          ..relayKey = RelayKey.import(_testKey())
          ..connectionSnapshot = const DeviceConnectionSnapshot(
            online: true,
            lastSeenAt: '2026-09-20T00:00:00Z',
            revision: 1,
            transport: RealtimeTransportState.connected,
            realtimeConfirmed: true,
          )
          ..sessions = [session]
          ..activeSessionId = session.id;
        controller.runningSessions.add(session.id);
        addTearDown(controller.dispose);
        expect((await controller.sendMessage('replace')).accepted, isTrue);
        final sent = await RelayCipher().openJson<Map<String, dynamic>>(
          controller.relayKey!,
          api.envelope!,
          api.aad!,
        );
        expect(sent['payload']['interrupt_running'], isTrue);
        expect(sent['payload']['content'], 'replace');
      },
    );
  }
  for (final transient in ['none', 'read', 'post']) {
    test(
      '[MOB-PRJ-017][flutter] Claude configuration uses the encrypted channel and blocks overlapping sends (transient=$transient)',
      () async {
        final api = _CaptureRelayApi()
          ..transientConfigurationRead = transient == 'read'
          ..transientConfigurationPost = transient == 'post';
        final key = RelayKey.import(_testKey());
        final session = RelaySession.fromJson({
          'id': 'claude_model',
          'provider': 'claude',
        });
        final controller = AppController(api: api)
          ..phase = AppPhase.ready
          ..bootstrap = _bootstrap()
          ..relayKey = key
          ..sessions = [session]
          ..activeSessionId = session.id
          ..connectionSnapshot = const DeviceConnectionSnapshot(
            online: true,
            lastSeenAt: '2026-08-12T08:00:00.000Z',
            revision: 1,
            transport: RealtimeTransportState.connected,
            realtimeConfirmed: true,
          );
        addTearDown(controller.dispose);
        api
          ..responseKey = key
          ..configurationSessionId = session.id
          ..configurationConfigId = 'model'
          ..configurationOptions = [
            {'id': 'model', 'currentValue': 'sonnet', 'options': []},
          ];
        final updating = controller.configureSession('model', 'sonnet');
        expect(controller.configuringSessions, contains(session.id));
        await controller.configureSession('model', 'opus');
        expect((await controller.sendMessage('wait')).accepted, isFalse);
        await updating;
        expect(api.commandTypes, ['session.configure']);
        expect(api.responseReads, transient == 'read' ? 2 : 1);
        final command = await RelayCipher().openJson<Map<String, dynamic>>(
          key,
          api.envelope!,
          api.aad!,
        );
        expect(command['payload'], {'config_id': 'model', 'value': 'sonnet'});
        expect(controller.activeSession!.raw['model'], 'sonnet');
        expect(controller.configuringSessions, isEmpty);
        controller.runningSessions.add(session.id);
        await controller.configureSession('model', 'opus');
        expect(api.commandTypes.length, 1);
      },
    );
  }

  test(
    '[MOB-PRJ-008][flutter] a partial catalog cannot replace the conversation or reroute its next message',
    () async {
      final api = _CaptureRelayApi();
      final selected = RelaySession.fromJson({
        'id': 'session_selected',
        'name': '正在对话',
        'cwd': '/workspace/relayune',
      });
      final other = RelaySession.fromJson({
        'id': 'session_other',
        'name': '其他会话',
        'cwd': '/workspace/other',
      });
      // No temporary creation protection: also covers a new conversation
      // after its 30-second catalog grace period has expired.
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = RelayKey.import(_testKey())
        ..connectionSnapshot = const DeviceConnectionSnapshot(
          online: true,
          lastSeenAt: '2026-08-12T08:00:00.000Z',
          revision: 1,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        )
        ..sessions = [selected, other]
        ..activeSessionId = selected.id
        ..messages[selected.id] = [
          const RelayMessage(
            id: 'reply',
            role: 'codex',
            content: '当前回复',
            createdAt: '2026-08-12T08:00:00.000Z',
            kind: 'message',
          ),
        ];
      addTearDown(controller.dispose);

      for (final catalog in <List<RelaySession>>[
        [other],
        [],
        [other],
      ]) {
        controller.replaceSessionsForTesting(catalog);
        expect(controller.activeSessionId, selected.id);
        expect(controller.activeSession?.cwd, selected.cwd);
        expect(controller.activeMessages.single.content, '当前回复');
      }

      final outcome = await controller.sendMessage('继续这个会话');
      expect(outcome.accepted, isTrue);
      final sent = await RelayCipher().openJson<Map<String, dynamic>>(
        controller.relayKey!,
        api.envelope!,
        api.aad!,
      );
      expect(sent['payload']['interrupt_running'], isTrue);
      expect(api.commandSessionIds.last, selected.id);

      final updated = RelaySession.fromJson({
        ...selected.raw,
        'name': '同步后的名称',
        'status': 'active',
      });
      controller.replaceSessionsForTesting([other, updated]);
      expect(controller.activeSession?.name, '同步后的名称');
      expect(controller.sessionHasRunningAgent(selected.id), isTrue);

      // Once the user leaves it, a missing session need not stay in the list.
      controller.markHistoryLoadedForTesting(other.id);
      await controller.selectSession(other.id);
      controller.replaceSessionsForTesting([other]);
      expect(controller.activeSessionId, other.id);
      expect(controller.sessions.map((session) => session.id), [other.id]);
    },
  );

  test(
    '[MOB-PRJ-008][flutter] a missing subagent keeps its selected project context',
    () {
      final root = RelaySession.fromJson({
        'id': 'root',
        'cwd': '/workspace/relayune',
      });
      final child = RelaySession.fromJson({
        'id': 'child',
        'is_subagent': true,
        'root_session_id': root.id,
        'cwd': root.cwd,
      });
      final controller = AppController()
        ..sessions = [root, child]
        ..activeSessionId = child.id;
      addTearDown(controller.dispose);

      controller.replaceSessionsForTesting([]);
      expect(controller.activeSessionId, child.id);
      expect(controller.activeSession, child);
      expect(controller.activeRootSession, root);

      controller.replaceSessionsForTesting([root, child]);
      expect(controller.sessions.map((session) => session.id), [
        'root',
        'child',
      ]);
    },
  );

  test(
    '[MOB-PRJ-008][flutter] named session creation binds the encrypted command to the current project',
    () async {
      final api = _CaptureRelayApi();
      final key = RelayKey.import(_testKey());
      final session = RelaySession.fromJson({
        'id': 'session_current',
        'name': 'Current',
        'project': 'Relayune',
        'cwd': '/workspace/relayune',
        'provider': 'codex',
      });
      final controller = _CreationResponseController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [session]
        ..activeSessionId = session.id
        ..connectionSnapshot = const DeviceConnectionSnapshot(
          online: true,
          lastSeenAt: '2026-08-12T08:00:00.000Z',
          revision: 1,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        );
      addTearDown(controller.dispose);

      final created = RelaySession.fromJson({
        'id': 'session_created',
        'name': '登录修复',
        'project': 'Relayune',
        'cwd': '/workspace/relayune',
        'provider': 'kimi',
      });
      api
        ..responseKey = key
        ..creationResult = created;

      await controller.createSessionInCurrentProject(
        '  登录修复  ',
        provider: 'kimi',
      );

      final plaintext = await RelayCipher().openJson<Map<String, dynamic>>(
        key,
        api.envelope!,
        api.aad!,
      );
      expect(plaintext['type'], 'session.create');
      expect(plaintext['session_id'], isNull);
      expect(plaintext['payload'], {
        'cwd': '/workspace/relayune',
        'name': '登录修复',
        'provider': 'kimi',
      });
      expect(api.commandType, 'session.create');
      expect(controller.usedUnifiedResponse, isTrue);
      expect(controller.activeSessionId, 'session_created');
      expect(controller.notice, contains('登录修复'));
      expect(controller.sessionCreationInFlight, isFalse);
    },
  );

  test(
    '[MOB-PRJ-008][flutter] blank session names never leave the plaintext endpoint',
    () async {
      final api = _CaptureRelayApi();
      final session = RelaySession.fromJson({
        'id': 'session_current',
        'name': 'Current',
        'project': 'Relayune',
        'cwd': '/workspace/relayune',
        'provider': 'codex',
      });
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = RelayKey.import(_testKey())
        ..sessions = [session]
        ..activeSessionId = session.id
        ..connectionSnapshot = const DeviceConnectionSnapshot(
          online: true,
          lastSeenAt: '2026-08-12T08:00:00.000Z',
          revision: 1,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        );
      addTearDown(controller.dispose);

      await controller.createSessionInCurrentProject('   ');

      expect(api.envelope, isNull);
      expect(controller.error, contains('会话名称'));
    },
  );

  test(
    '[MOB-PRJ-008][flutter] explicit project creation does not use the active project',
    () async {
      final api = _CaptureRelayApi();
      final key = RelayKey.import(_testKey());
      final activeProject = RelaySession.fromJson({
        'id': 'session_project_a',
        'name': 'Project A',
        'project': 'Project A',
        'cwd': '/workspace/project-a',
        'provider': 'codex',
      });
      final targetProject = RelaySession.fromJson({
        'id': 'session_project_b',
        'name': 'Project B',
        'project': 'Project B',
        'cwd': '/workspace/project-b',
        'provider': 'kimi',
      });
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [activeProject, targetProject]
        ..activeSessionId = activeProject.id
        ..connectionSnapshot = const DeviceConnectionSnapshot(
          online: true,
          lastSeenAt: '2026-08-12T08:00:00.000Z',
          revision: 1,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        );
      addTearDown(controller.dispose);
      String? activeSessionAtSend;
      api.onSend = () => activeSessionAtSend = controller.activeSessionId;

      final created = RelaySession.fromJson({
        'id': 'session_project_b_created',
        'name': '项目 B 任务',
        'project': 'Project B',
        'cwd': '/workspace/project-b',
        'provider': 'kimi',
      });
      api
        ..responseKey = key
        ..creationResult = created;

      await controller.createSessionInProject(targetProject, '项目 B 任务');

      final plaintext = await RelayCipher().openJson<Map<String, dynamic>>(
        key,
        api.envelope!,
        api.aad!,
      );
      expect(activeSessionAtSend, activeProject.id);
      expect(plaintext['payload'], {
        'cwd': '/workspace/project-b',
        'name': '项目 B 任务',
        'provider': 'kimi',
      });

      expect(controller.activeSessionId, created.id);
      expect(controller.notice, contains('项目 B 任务'));
    },
  );

  test(
    '[MOB-PRJ-008][flutter] authoritative creation result survives a lagging catalog and routes the first message to the new id',
    () async {
      final api = _CaptureRelayApi();
      final key = RelayKey.import(_testKey());
      final oldSession = RelaySession.fromJson({
        'id': 'session_old',
        'name': '旧会话',
        'project': 'Relayune',
        'cwd': '/workspace/relayune',
        'provider': 'codex',
      });
      final created = RelaySession.fromJson({
        'id': 'session_created',
        'name': '新会话',
        'project': 'Relayune',
        'cwd': '/workspace/relayune',
        'provider': 'codex',
      });
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [oldSession]
        ..activeSessionId = oldSession.id
        ..messages[oldSession.id] = [
          const RelayMessage(
            id: 'old_message',
            role: 'codex',
            content: '旧会话正文',
            createdAt: '2026-08-12T08:00:00.000Z',
            kind: 'message',
          ),
        ]
        ..connectionSnapshot = const DeviceConnectionSnapshot(
          online: true,
          lastSeenAt: '2026-08-12T08:00:00.000Z',
          revision: 1,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        );
      addTearDown(controller.dispose);
      api
        ..responseKey = key
        ..creationResult = created;

      await controller.createSessionInProject(oldSession, '新会话');

      expect(controller.activeSessionId, created.id);
      expect(controller.activeMessages, isEmpty);
      expect(api.commandTypes, isNot(contains('session.read_history')));

      controller.replaceSessionsForTesting([created, oldSession]);
      expect(controller.activeSessionId, created.id);
      expect(controller.activeMessages, isEmpty);

      controller.replaceSessionsForTesting([oldSession]);
      expect(
        controller.sessions.map((session) => session.id),
        contains(created.id),
      );
      expect(controller.activeSessionId, created.id);
      expect(controller.activeMessages, isEmpty);

      controller.replaceSessionsForTesting([oldSession, created]);
      expect(controller.activeSessionId, created.id);
      expect(controller.activeMessages, isEmpty);

      final outcome = await controller.sendMessage('第一条消息');
      expect(outcome.accepted, isTrue);
      expect(api.commandTypes.last, 'session.submit_message');
      expect(api.commandSessionIds.last, created.id);
      final plaintext = await RelayCipher().openJson<Map<String, dynamic>>(
        key,
        api.envelope!,
        api.aad!,
      );
      expect(plaintext['session_id'], created.id);
      expect(plaintext['payload']['content'], '第一条消息');
    },
  );

  for (final provider in const ['kimi', 'claude']) {
    test(
      '[MOB-CHAT-001][flutter] a new $provider session accepts the first daily message on its authoritative id',
      () async {
        final api = _CaptureRelayApi();
        final key = RelayKey.import(_testKey());
        final project = RelaySession.fromJson({
          'id': 'codex_project',
          'name': 'Codex project',
          'project': 'Relayune',
          'cwd': '/workspace/relayune',
          'provider': 'codex',
        });
        final created = RelaySession.fromJson({
          'id': '${provider}_created',
          'name': '新对话',
          'project': 'Relayune',
          'cwd': '/workspace/relayune',
          'provider': provider,
          'supports_steering': false,
        });
        final controller = AppController(api: api)
          ..phase = AppPhase.ready
          ..bootstrap = _bootstrap()
          ..relayKey = key
          ..sessions = [project]
          ..activeSessionId = project.id
          ..connectionSnapshot = const DeviceConnectionSnapshot(
            online: true,
            lastSeenAt: '2026-08-12T08:00:00.000Z',
            revision: 1,
            transport: RealtimeTransportState.connected,
            realtimeConfirmed: true,
          );
        addTearDown(controller.dispose);
        api
          ..responseKey = key
          ..creationResult = created;

        await controller.createSessionInProject(
          project,
          '新对话',
          provider: provider,
        );
        final outcome = await controller.sendMessage('你好，请用一句话介绍你自己');

        expect(controller.activeSessionId, created.id);
        expect(controller.activeSession?.provider, provider);
        expect(outcome, MessageSendOutcome.delivered);
        expect(api.commandTypes.last, 'session.submit_message');
        expect(api.commandSessionIds.last, created.id);
        final plaintext = await RelayCipher().openJson<Map<String, dynamic>>(
          key,
          api.envelope!,
          api.aad!,
        );
        expect(plaintext['session_id'], created.id);
        expect(plaintext['payload']['content'], '你好，请用一句话介绍你自己');

        await controller.delegateAgents('调研问题\n实现修复\n复核测试');
        final agentsCommand = await RelayCipher()
            .openJson<Map<String, dynamic>>(key, api.envelope!, api.aad!);
        expect(api.commandTypes.last, 'session.create_agents');
        expect(api.commandSessionIds.last, created.id);
        expect(agentsCommand['session_id'], created.id);
        expect(agentsCommand['payload']['tasks'], ['调研问题', '实现修复', '复核测试']);
      },
    );
  }

  test(
    '[MOB-PRJ-016][flutter] desktop creation errors are decrypted and surfaced instead of looking inert',
    () async {
      final api = _CaptureRelayApi();
      final key = RelayKey.import(_testKey());
      final session = RelaySession.fromJson({
        'id': 'session_current',
        'name': 'Current',
        'project': 'Relayune',
        'cwd': '/workspace/relayune',
        'provider': 'codex',
      });
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [session]
        ..activeSessionId = session.id
        ..connectionSnapshot = const DeviceConnectionSnapshot(
          online: true,
          lastSeenAt: '2026-08-12T08:00:00.000Z',
          revision: 1,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        );
      addTearDown(controller.dispose);
      api
        ..responseKey = key
        ..creationError = '本机 Codex 拒绝创建会话。';

      await controller.createSessionInProject(session, '失败会话');

      expect(api.responseReads, greaterThan(0));
      expect(controller.error, '电脑端创建会话失败。');
      expect(controller.error, isNot(contains('本机 Codex 拒绝创建会话')));
      expect(controller.notice, isEmpty);
      expect(controller.activeSessionId, session.id);
      expect(controller.sessionCreationInFlight, isFalse);
    },
  );

  test(
    '[MOB-CWK-003][flutter] Cowork mode updates only after the encrypted desktop result arrives',
    () async {
      final api = _CaptureRelayApi();
      final key = RelayKey.import(_testKey());
      final session = RelaySession.fromJson({
        'id': 'session_current',
        'name': 'Current',
        'project': 'Relayune',
        'cwd': '/workspace/relayune',
        'provider': 'claude-cowork',
        'session_config_options': [
          {
            'type': 'select',
            'id': 'mode',
            'name': '权限模式',
            'currentValue': 'default',
            'options': [
              {'value': 'default', 'name': '逐次询问'},
              {'value': 'bypassPermissions', 'name': '无限制'},
            ],
          },
        ],
      });
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [session]
        ..activeSessionId = session.id
        ..connectionSnapshot = const DeviceConnectionSnapshot(
          online: true,
          lastSeenAt: '2026-08-12T08:00:00.000Z',
          revision: 1,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        );
      addTearDown(controller.dispose);
      api
        ..responseKey = key
        ..configurationSessionId = session.id
        ..configurationConfigId = 'mode'
        ..configurationOptions = [
          {
            'type': 'select',
            'id': 'mode',
            'name': '权限模式',
            'currentValue': 'bypassPermissions',
            'options': [
              {'value': 'default', 'name': '逐次询问'},
              {'value': 'bypassPermissions', 'name': '无限制'},
            ],
          },
        ];

      await controller.configureSession('mode', 'bypassPermissions');

      final plaintext = await RelayCipher().openJson<Map<String, dynamic>>(
        key,
        api.envelope!,
        api.aad!,
      );
      expect(plaintext['type'], 'session.configure');
      expect(plaintext['payload'], {
        'config_id': 'mode',
        'value': 'bypassPermissions',
      });
      final options =
          controller.activeSession!.raw['session_config_options'] as List;
      final mode = options.whereType<Map>().firstWhere(
        (option) => option['id'] == 'mode',
      );
      expect(mode['currentValue'], 'bypassPermissions');
      expect(
        controller.activeSession!.raw['permission_mode'],
        'bypassPermissions',
      );
      expect(controller.notice, '会话设置已应用。');
      expect(controller.error, isEmpty);
      expect(api.responseReads, greaterThan(0));
    },
  );

  test(
    '[MOB-PRJ-016][flutter] runtime setting failures use the stable localized desktop error',
    () async {
      final api = _CaptureRelayApi();
      final key = RelayKey.import(_testKey());
      final session = RelaySession.fromJson({
        'id': 'session_current',
        'name': 'Current',
        'project': 'Relayune',
        'cwd': '/workspace/relayune',
        'provider': 'codex',
      });
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [session]
        ..activeSessionId = session.id
        ..connectionSnapshot = const DeviceConnectionSnapshot(
          online: true,
          lastSeenAt: '2026-08-12T08:00:00.000Z',
          revision: 1,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        );
      addTearDown(controller.dispose);
      api
        ..responseKey = key
        ..configurationSessionId = session.id
        ..configurationConfigId = 'reasoning'
        ..configurationError = '本机 Codex 拒绝该推理强度。';

      await controller.configureSession('reasoning', 'high');

      expect(controller.error, '电脑端未能应用会话设置。');
      expect(controller.error, isNot(contains('本机 Codex 拒绝该推理强度')));
      expect(controller.notice, isEmpty);
      expect(api.responseReads, greaterThan(0));
    },
  );
}

class _CaptureRelayApi extends RelayApi {
  RelayAad? aad;
  SealedEnvelope? envelope;
  String? commandType;
  final List<String> commandTypes = [];
  final List<String> commandFrames = [];
  final List<String?> commandSessionIds = [];
  void Function()? onSend;
  RelayKey? responseKey;
  RelaySession? creationResult;
  String? creationError;
  String? configurationSessionId;
  String? configurationConfigId;
  List<Map<String, dynamic>>? configurationOptions;
  String? configurationError;
  int responseReads = 0;
  bool transientConfigurationRead = false;
  bool transientConfigurationPost = false;

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
    this.aad = aad;
    this.envelope = envelope;
    this.commandType = commandType;
    commandTypes.add(commandType);
    commandFrames.add(
      jsonEncode({
        'request_id': requestId,
        'aad': aad.toJson(),
        'envelope': envelope.toJson(),
        'created_at': createdAt,
        'expires_at': expiresAt,
      }),
    );
    commandSessionIds.add(sessionId);
    onSend?.call();
    if (transientConfigurationPost) {
      throw const RelayApiException('timeout', 0, 'network_timeout');
    }
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
    responseReads += 1;
    if (commandType == 'session.read_history') {
      final sessionId = commandSessionIds.last;
      final aad = RelayAad(
        direction: 'relay_to_web',
        type: 'session.history',
        deviceId: 'dev_test',
        sessionId: sessionId,
        requestId: requestId,
        eventSeq: null,
        createdAt: DateTime.now().toUtc().toIso8601String(),
        expiresAt: null,
      );
      return OpaqueFrame(
        deviceId: 'dev_test',
        sessionId: sessionId,
        requestId: requestId,
        aad: aad,
        envelope: await RelayCipher()
            .sealJson(responseKey ?? RelayKey.import(_testKey()), {
              'type': 'session.history',
              'request_id': requestId,
              'session_id': sessionId,
              'messages': [],
              'next_cursor': null,
              'has_more': false,
            }, aad),
      );
    }
    if (transientConfigurationRead && responseReads == 1) {
      throw const RelayApiException('timeout', 0, 'network_timeout');
    }
    final key = responseKey;
    final configuring = commandType == 'session.configure';
    final message = configuring ? configurationError : creationError;
    final created = configuring ? null : creationResult;
    final configOptions = configuring ? configurationOptions : null;
    if ((message == null && created == null && configOptions == null) ||
        key == null) {
      throw const RelayApiException('响应尚未就绪。', 404, 'response_pending');
    }
    final createdAt = DateTime.now().toUtc().toIso8601String();
    final responseType = configuring
        ? message == null
              ? 'session.configure_result'
              : 'session.configure_error'
        : message == null
        ? 'session.create_result'
        : 'session.create_error';
    final responseSessionId = configuring
        ? configurationSessionId
        : message == null
        ? created?.id
        : null;
    final aad = RelayAad(
      direction: 'relay_to_web',
      type: responseType,
      deviceId: 'dev_test',
      sessionId: responseSessionId,
      requestId: requestId,
      eventSeq: null,
      createdAt: createdAt,
      expiresAt: null,
    );
    return OpaqueFrame(
      deviceId: 'dev_test',
      sessionId: responseSessionId,
      requestId: requestId,
      aad: aad,
      envelope: await RelayCipher().sealJson(
        key,
        configuring
            ? {
                'type': responseType,
                'request_id': requestId,
                'session_id': responseSessionId,
                'config_id': configurationConfigId,
                if (message == null) 'config_options': configOptions,
                if (message != null) 'error': message,
              }
            : message == null
            ? {
                'type': responseType,
                'request_id': requestId,
                'session_id': created!.id,
                'session': created.raw,
              }
            : {'type': responseType, 'request_id': requestId, 'error': message},
        aad,
      ),
    );
  }
}

ServerBootstrap _bootstrap({OpaqueFrame? catalog}) => ServerBootstrap(
  email: 'owner@example.com',
  device: const RelayDevice(
    id: 'dev_test',
    name: 'Test Mac',
    online: true,
    agentConnected: true,
    lastSeenAt: '2026-08-12T08:00:00.000Z',
  ),
  catalog: catalog,
  events: const [],
  cursor: 0,
  ackSequence: 0,
  queuedCommands: 0,
);

String _testKey() => base64Url
    .encode(List<int>.generate(32, (index) => index))
    .replaceAll('=', '');

// Creation must consume the same response abstraction as WebRTC reads rather
// than independently polling the HTTP endpoint.
class _CreationResponseController extends AppController {
  _CreationResponseController({required super.api});
  bool usedUnifiedResponse = false;

  @override
  Future<Map<String, dynamic>> waitForEncryptedResponse(
    String requestId, {
    bool preserveCompression = false,
    Duration timeout = const Duration(seconds: 20),
    bool retryTransientErrors = false,
    DownloadProgressCallback? onProgress,
    bool serverOnly = false,
  }) {
    usedUnifiedResponse = true;
    return super.waitForEncryptedResponse(
      requestId,
      timeout: timeout,
      retryTransientErrors: retryTransientErrors,
      onProgress: onProgress,
      serverOnly: serverOnly,
    );
  }
}

AppController _creationFixture(
  _CaptureRelayApi api, {
  String provider = 'codex',
  AppController? base,
}) {
  final key = RelayKey.import(_testKey());
  final project = RelaySession.fromJson({
    'id': 'old',
    'name': 'Old',
    'cwd': '/tmp/qa',
    'provider': provider,
  });
  api
    ..responseKey = key
    ..creationResult = RelaySession.fromJson({
      'id': 'created',
      'name': 'QA',
      'cwd': '/tmp/qa',
      'provider': provider,
    });
  return (base ?? AppController(api: api))
    ..phase = AppPhase.ready
    ..bootstrap = _bootstrap()
    ..relayKey = key
    ..sessions = [project]
    ..activeSessionId = project.id
    ..connectionSnapshot = const DeviceConnectionSnapshot(
      online: true,
      lastSeenAt: '2026-09-24T08:00:00Z',
      revision: 1,
      transport: RealtimeTransportState.connected,
      realtimeConfirmed: true,
    );
}

class _CreationRecoveryController extends _CreationResponseController {
  _CreationRecoveryController({required super.api});
  final requestedIds = <String>[];
  @override
  Future<Map<String, dynamic>> waitForEncryptedResponse(
    String requestId, {
    bool preserveCompression = false,
    Duration timeout = const Duration(seconds: 20),
    bool retryTransientErrors = false,
    DownloadProgressCallback? onProgress,
    bool serverOnly = false,
  }) async {
    requestedIds.add(requestId);
    if (requestedIds.length == 1) {
      throw const RelayApiException('timeout', 0, 'response_timeout');
    }
    return super.waitForEncryptedResponse(
      requestId,
      timeout: timeout,
      retryTransientErrors: retryTransientErrors,
      onProgress: onProgress,
      serverOnly: serverOnly,
    );
  }
}

class _HeldCreationController extends _CreationResponseController {
  _HeldCreationController({required super.api});
  final entered = Completer<void>();
  final release = Completer<void>();
  @override
  Future<Map<String, dynamic>> waitForEncryptedResponse(
    String requestId, {
    bool preserveCompression = false,
    Duration timeout = const Duration(seconds: 20),
    bool retryTransientErrors = false,
    DownloadProgressCallback? onProgress,
    bool serverOnly = false,
  }) async {
    if (!entered.isCompleted) entered.complete();
    await release.future;
    return super.waitForEncryptedResponse(
      requestId,
      timeout: timeout,
      retryTransientErrors: retryTransientErrors,
      onProgress: onProgress,
      serverOnly: serverOnly,
    );
  }
}
