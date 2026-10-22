import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';

import '../support/workbench_fixture.dart';

const _reply = RelayMessage(
  id: 'reply-a',
  role: 'codex',
  content: 'Answer A',
  createdAt: '2026-10-06T10:00:00Z',
  kind: 'message',
  turnId: 'turn-a',
  messagePhase: 'final_answer',
  turnStatus: 'completed',
);
const _laterReply = RelayMessage(
  id: 'reply-b',
  role: 'codex',
  content: 'Answer B',
  createdAt: '2026-10-06T10:01:00Z',
  kind: 'message',
  turnId: 'turn-b',
  messagePhase: 'final_answer',
  turnStatus: 'completed',
);
RelaySession _source({String? mode = 'turn', bool worktree = true}) =>
    RelaySession.fromJson({
      ...relaySession().raw,
      'status': 'idle',
      if (mode != null) 'fork_mode': mode,
      'supports_fork_worktree': worktree,
    });

void main() {
  test(
    'capability defaults hide branching; only completed final replies qualify',
    () {
      final controller = workbenchController(sessions: [_source()]);
      addTearDown(controller.dispose);
      final commentary = _reply.copyWith(messagePhase: 'commentary');
      controller.messages['root'] = [_reply];
      expect(controller.canBranchReply(_source(mode: null), _reply), isFalse);
      expect(_source(mode: null).supportsForkWorktree, isTrue);
      expect(
        RelaySession.fromJson({'id': 'legacy'}).supportsForkWorktree,
        isFalse,
      );
      controller.messages['root'] = [commentary];
      expect(controller.canBranchReply(_source(), commentary), isFalse);
      controller.messages['root'] = [_reply, _laterReply];
      expect(controller.canBranchReply(_source(), _reply), isTrue);
      expect(
        controller.canBranchReply(_source(mode: 'latest'), _reply),
        isFalse,
      );
      expect(
        controller.canBranchReply(_source(mode: 'latest'), _laterReply),
        isTrue,
      );
      controller.runningSessions.add('root');
      expect(
        controller.canBranchReply(_source(mode: 'latest'), _laterReply),
        isFalse,
      );
      expect(controller.canBranchReply(_source(), _reply), isTrue);
      expect(controller.canBranchReply(_source(), _laterReply), isFalse);
    },
  );

  test(
    'latest accepts idle native tail without status, but excludes failures and later tools',
    () {
      final controller = workbenchController(
        sessions: [_source(mode: 'latest')],
      );
      addTearDown(controller.dispose);
      const unknown = RelayMessage(
        id: 'tail',
        role: 'codex',
        content: 'Native reply',
        createdAt: '',
        kind: 'message',
        turnId: 'native-turn',
      );
      controller.messages['root'] = [unknown];
      expect(
        controller.canBranchReply(controller.activeSession!, unknown),
        isTrue,
      );
      controller.messages['root'] = [
        unknown.copyWith(turnStatus: 'interrupted'),
      ];
      expect(
        controller.canBranchReply(
          controller.activeSession!,
          controller.activeMessages.last,
        ),
        isFalse,
      );
      controller.messages['root'] = [
        unknown,
        const RelayMessage(
          id: 'tool',
          role: 'system',
          content: '',
          createdAt: '',
          kind: 'tool',
          turnId: 'native-turn',
          toolActivityLabel: 'Later tool',
        ),
      ];
      expect(
        controller.canBranchReply(controller.activeSession!, unknown),
        isFalse,
      );
    },
  );

  test(
    'latest mode hides live presentation aliases until native history hydration',
    () {
      final controller = workbenchController(
        sessions: [_source(mode: 'latest')],
      );
      addTearDown(controller.dispose);
      for (final id in [
        'codex_turn-a',
        'agent_turn-a',
        'agent_turn-a_native-item',
      ]) {
        final live = RelayMessage(
          id: id,
          role: 'codex',
          content: 'Answer A',
          createdAt: '',
          kind: 'message.completed',
          turnId: 'turn-a',
          messagePhase: 'final_answer',
          turnStatus: 'completed',
        );
        controller.messages['root'] = [live];
        expect(
          controller.canBranchReply(_source(mode: 'latest'), live),
          isFalse,
        );
        expect(controller.canBranchReply(_source(), live), isTrue);
      }
      controller.messages['root'] = [_reply];
      expect(
        controller.canBranchReply(controller.activeSession!, _reply),
        isTrue,
      );
    },
  );

  test(
    'reply fork sends encrypted cutoff and reads inherited history while preserving source',
    () async {
      final api = _BranchApi();
      final controller = _fixture(api);
      addTearDown(controller.dispose);
      final source = controller.activeSession!;
      // Real navigation registers the source among recently read conversations.
      await controller.selectSession(source.id);
      controller.messages[source.id] = [_reply, _laterReply];
      api.commands.clear();
      final oldHistory = List<RelayMessage>.from(controller.activeMessages);
      await controller.branchFromReply(source, _reply);
      expect(controller.error, isEmpty);
      expect(controller.activeSessionId, 'new-chat');
      expect(controller.pendingWorkbenchTarget, 'conversation');
      expect(controller.notice, '已分支到新聊天，继续使用原项目目录。');
      expect(controller.messages['new-chat']!.map((m) => m.content), [
        'Inherited answer A',
      ]);
      expect(controller.messages['root'], oldHistory);
      expect(api.commands.map((c) => c.aad.type), [
        'session.fork',
        'session.read_history',
      ]);
      expect(api.commands.first.aad.sessionId, 'root');
      final plain = await RelayCipher().openJson<Map<String, dynamic>>(
        controller.relayKey!,
        api.commands.first.envelope,
        api.commands.first.aad,
      );
      expect(plain['payload'], {
        'message_id': 'reply-a',
        'turn_id': 'turn-a',
        'mode': 'same_directory',
      });
      expect(api.commands.first.frame, isNot(contains('reply-a')));
    },
  );

  for (final uncertainty in [
    'response-timeout',
    'post-timeout',
    'native-unknown',
  ]) {
    test(
      '$uncertainty recovery retains immutable request ID and sealed frame',
      () async {
        final api = _BranchApi()..throwPostOnce = uncertainty == 'post-timeout';
        final base = _RecoveryController(api: api)
          ..timeoutOnce = uncertainty == 'response-timeout';
        if (uncertainty == 'native-unknown') {
          api.forkError = 'session_fork_outcome_unknown';
        }
        final controller = _fixture(api, base: base);
        addTearDown(controller.dispose);
        final source = controller.activeSession!;
        await controller.branchFromReply(source, _reply);
        if (uncertainty != 'post-timeout') {
          expect(controller.activeSessionId, 'root');
          expect(controller.error, contains('暂未确认'));
          api.forkError = null;
          await controller.branchFromReply(source, _reply);
        }
        expect(controller.activeSessionId, 'new-chat');
        final forks = api.commands
            .where((c) => c.aad.type == 'session.fork')
            .toList();
        expect(forks, hasLength(2));
        expect(forks.map((c) => c.aad.requestId).toSet(), hasLength(1));
        expect(forks.map((c) => c.frame).toSet(), hasLength(1));
        expect(controller.error, isEmpty);
      },
    );
  }

  test(
    'worktree failure stays in source without same-directory fallback; definitive retry has new ID',
    () async {
      final api = _BranchApi()
        ..forkError = 'session_worktree_failed'
        ..useWorktree = true;
      final controller = _fixture(api);
      addTearDown(controller.dispose);
      final source = controller.activeSession!;
      await controller.branchFromReply(source, _reply, worktree: true);
      expect(controller.activeSessionId, source.id);
      expect(controller.error, contains('未能创建 worktree'));
      expect(api.commands, hasLength(1));
      api.forkError = null;
      await controller.branchFromReply(source, _reply, worktree: true);
      expect(controller.activeSession!.cwd, '/workspace/branch-worktree');
      expect(controller.notice, '已分支到新聊天，使用独立 worktree。');
      final forks = api.commands
          .where((c) => c.aad.type == 'session.fork')
          .toList();
      expect(forks.map((c) => c.aad.requestId).toSet(), hasLength(2));
      for (final command in forks) {
        final plain = await RelayCipher().openJson<Map<String, dynamic>>(
          controller.relayKey!,
          command.envelope,
          command.aad,
        );
        expect(plain['payload']['mode'], 'worktree');
      }
    },
  );

  test(
    'authenticated result with mismatched payload and AAD session identity cannot navigate',
    () async {
      final api = _BranchApi()..responseRouteSessionId = 'wrong-routed-chat';
      final controller = _fixture(api);
      addTearDown(controller.dispose);
      final source = controller.activeSession!;
      await controller.branchFromReply(source, _reply);
      expect(controller.activeSessionId, source.id);
      expect(controller.sessions.where((s) => s.id == 'new-chat'), isEmpty);
      expect(api.commands.map((c) => c.aad.type), ['session.fork']);
      api.responseRouteSessionId = null;
      await controller.branchFromReply(source, _reply);
      expect(controller.activeSessionId, 'new-chat');
      final forks = api.commands
          .where((c) => c.aad.type == 'session.fork')
          .toList();
      expect(forks.map((c) => c.aad.requestId).toSet(), hasLength(1));
    },
  );

  test(
    'mismatched source response cannot activate a new chat; recovery keeps original operation',
    () async {
      final api = _BranchApi()..responseSource = 'another-source';
      final controller = _fixture(api);
      addTearDown(controller.dispose);
      final source = controller.activeSession!;
      await controller.branchFromReply(source, _reply);
      expect(controller.activeSessionId, source.id);
      expect(controller.error, isNotEmpty);
      expect(controller.sessions.where((s) => s.id == 'new-chat'), isEmpty);
      api.responseSource = 'root';
      await controller.branchFromReply(source, _reply);
      expect(controller.activeSessionId, 'new-chat');
      final forks = api.commands
          .where((c) => c.aad.type == 'session.fork')
          .toList();
      expect(forks.map((c) => c.aad.requestId).toSet(), hasLength(1));
    },
  );
  for (final provider in ['codex', 'pi']) {
    test(
      '$provider unknown fork outcome keeps sealed request after canonical hydration',
      () async {
        final api = _BranchApi()
          ..provider = provider
          ..forkError = 'session_fork_outcome_unknown';
        final source = RelaySession.fromJson({
          ..._source().raw,
          'provider': provider,
        });
        final controller = workbenchController(
          api: api,
          baseController: AppController(api: api),
          sessions: [source],
        );
        controller.relayKey = api.key;
        addTearDown(controller.dispose);
        final live = RelayMessage(
          id: provider == 'pi' ? 'agent_turn-a' : 'agent_turn-a_native-item',
          role: 'codex',
          content: 'Answer A',
          createdAt: '',
          kind: 'message.completed',
          turnId: 'turn-a',
          messagePhase: 'final_answer',
          turnStatus: 'completed',
        );
        final canonical = RelayMessage(
          id: provider == 'pi' ? 'codex_turn-a' : 'native-item',
          role: 'codex',
          content: 'Answer A',
          createdAt: '',
          kind: 'message',
          turnId: 'turn-a',
          messagePhase: 'final_answer',
          turnStatus: 'completed',
        );
        controller.messages['root'] = [live];
        await controller.branchFromReply(source, live);
        expect(controller.error, '暂未确认分支结果，请保持连接后重试查询。');
        controller.messages['root'] = [canonical];
        api.forkError = null;
        await controller.branchFromReply(source, canonical);
        final forks = api.commands
            .where((c) => c.aad.type == 'session.fork')
            .toList();
        expect(forks, hasLength(2));
        expect(forks[1].aad.requestId, forks[0].aad.requestId);
        expect(forks[1].frame, forks[0].frame);
        expect(controller.activeSessionId, 'new-chat');
      },
    );
  }

  for (final provider in ['kimi', 'mcode', 'opencode']) {
    test(
      'actual $provider completed producer hydrates visible native latest reply',
      () async {
        final api = _BranchApi()
          ..historyMessages = _nativeLatestHistory(provider);
        final source = RelaySession.fromJson({
          ..._source(mode: null, worktree: false).raw,
          'provider': provider,
        });
        final controller = workbenchController(
          api: api,
          baseController: AppController(api: api),
          sessions: [source],
        );
        controller.relayKey = api.key;
        addTearDown(controller.dispose);
        controller.historyHasMore['root'] = false;
        controller.historyViewportShown('root');
        _replayNativeProducer(controller, provider);
        controller.replaceSessionsForTesting([
          RelaySession.fromJson({...source.raw, 'fork_mode': 'latest'}),
        ]);
        await _waitForHydration(controller, api);
        final replies = controller.activeMessages
            .where((m) => m.role == 'codex')
            .toList();
        expect(replies, hasLength(2));
        expect(replies.last.content, 'FORK_MARKER_B_8e7a');
        expect(
          controller.canBranchReply(controller.activeSession!, replies.first),
          isFalse,
        );
        expect(
          controller.canBranchReply(controller.activeSession!, replies.last),
          isTrue,
        );
        expect(
          api.commands.where((c) => c.aad.type == 'session.read_history'),
          hasLength(1),
        );
      },
    );
  }

  test(
    'latest completion keeps hydration scoped to the visible conversation',
    () async {
      final api = _BranchApi()..historyMessages = _nativeLatestHistory('kimi');
      final source = _source(mode: 'latest');
      final controller = workbenchController(
        api: api,
        baseController: AppController(api: api),
        sessions: [source],
      );
      controller.relayKey = api.key;
      addTearDown(controller.dispose);
      controller.historyHasMore['root'] = false;
      controller.historyViewportShown('root');
      controller.historyViewportHidden('root');
      _replayNativeProducer(controller, 'kimi');
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(api.commands, isEmpty);
    },
  );

  for (final terminal in ['failed', 'interrupted']) {
    test('$terminal latest reply never starts successful hydration', () async {
      final api = _BranchApi()..historyMessages = _nativeLatestHistory('kimi');
      final source = _source(mode: 'latest');
      final controller = workbenchController(
        api: api,
        baseController: AppController(api: api),
        sessions: [source],
      );
      controller.relayKey = api.key;
      addTearDown(controller.dispose);
      controller.historyHasMore['root'] = false;
      controller.historyViewportShown('root');
      _replayNativeProducer(controller, 'kimi', terminal: terminal);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(api.commands, isEmpty);
      final reply = controller.activeMessages.lastWhere(
        (m) => m.role == 'codex',
      );
      expect(controller.canBranchReply(source, reply), isFalse);
    });
  }

  test(
    'failed canonical read retains live reply and does not enable branching',
    () async {
      final api = _BranchApi()..historyFails = true;
      final source = _source(mode: 'latest');
      final controller = workbenchController(
        api: api,
        baseController: AppController(api: api),
        sessions: [source],
      );
      controller.relayKey = api.key;
      addTearDown(controller.dispose);
      controller.historyHasMore['root'] = false;
      controller.historyViewportShown('root');
      _replayNativeProducer(controller, 'kimi', latestOnly: true);
      await _waitForHydration(controller, api);
      final reply = controller.activeMessages.lastWhere(
        (m) => m.role == 'codex',
      );
      expect(reply.content, 'FORK_MARKER_B_8e7a');
      expect(controller.canBranchReply(source, reply), isFalse);
      expect(
        api.commands.where((c) => c.aad.type == 'session.read_history'),
        hasLength(1),
      );
    },
  );
  for (final sameText in [false, true]) {
    test(
      'native history lagging one turn keeps live reply (same text: $sameText)',
      () async {
        final canonicalA = _nativeLatestHistory('kimi')[1]
          ..['turn_status'] = 'completed'
          ..['message_phase'] = 'final_answer';
        if (sameText) canonicalA['content'] = 'FORK_MARKER_B_8e7a';
        final api = _BranchApi()..historyMessages = [canonicalA];
        final source = _source(mode: 'latest');
        final controller = workbenchController(
          api: api,
          baseController: AppController(api: api),
          sessions: [source],
        );
        controller.relayKey = api.key;
        controller.messages['root'] = [RelayMessage.fromHistory(canonicalA)];
        addTearDown(controller.dispose);
        controller.historyViewportShown('root');
        _replayNativeProducer(controller, 'kimi', latestOnly: true);
        await _waitForHydration(controller, api);
        final live = controller.activeMessages.lastWhere(
          (m) => m.role == 'codex',
        );
        expect(live.id, startsWith('agent_'));
        expect(live.content, 'FORK_MARKER_B_8e7a');
        expect(controller.canBranchReply(source, live), isFalse);
        expect(
          api.commands.where((c) => c.aad.type == 'session.read_history'),
          hasLength(1),
        );
      },
    );
  }

  test(
    'one new native boundary replaces one of two completed live turns',
    () async {
      const previous = RelayMessage(
        id: 'native-previous',
        role: 'codex',
        content: 'Previous',
        kind: 'message',
        createdAt: '2026-10-06T08:00:00Z',
        turnId: 'native-previous-turn',
        messagePhase: 'final_answer',
        turnStatus: 'completed',
      );
      final prefix = {
        'id': previous.id,
        'role': 'codex',
        'content': previous.content,
        'created_at': previous.createdAt,
        'turn_id': previous.turnId,
        'turn_status': 'completed',
        'message_phase': 'final_answer',
      };
      final one = _nativeLatestHistory('kimi').take(2).toList();
      one.last['turn_status'] = 'completed';
      one.last['message_phase'] = 'final_answer';
      final api = _BranchApi()..historyMessages = [prefix, ...one];
      final source = _source(mode: 'latest');
      final controller = workbenchController(
        api: api,
        baseController: AppController(api: api),
        sessions: [source],
      );
      controller.relayKey = api.key;
      controller.messages['root'] = [previous];
      addTearDown(controller.dispose);
      _replayNativeProducer(controller, 'kimi'); // hidden: no automatic read
      controller.historyViewportShown('root');
      await controller.loadHistory('root');
      final live = controller.activeMessages
          .where((m) => m.role == 'codex' && m.id.startsWith('agent_'))
          .toList();
      expect(live, hasLength(1));
      expect(live.single.content, 'FORK_MARKER_B_8e7a');
      expect(controller.canBranchReply(source, live.single), isFalse);
      api.historyMessages = [prefix, ..._nativeLatestHistory('kimi')];
      await controller.loadHistory('root');
      expect(
        controller.activeMessages.where(
          (m) => m.role == 'codex' && m.id.startsWith('agent_'),
        ),
        isEmpty,
      );
      final latest = controller.activeMessages.lastWhere(
        (m) => m.role == 'codex',
      );
      expect(controller.canBranchReply(source, latest), isTrue);
    },
  );

  test(
    'hydration preserves activity newer than the history request watermark',
    () async {
      final native = _nativeLatestHistory('kimi');
      native[1]['turn_status'] = 'completed';
      native[1]['message_phase'] = 'final_answer';
      final gate = Completer<void>();
      final api = _BranchApi()
        ..historyMessages = native
        ..historyResponseGate = gate;
      final source = _source(mode: 'latest');
      final controller = workbenchController(
        api: api,
        baseController: AppController(api: api),
        sessions: [source],
      );
      controller.relayKey = api.key;
      controller.messages['root'] = [RelayMessage.fromHistory(native[1])];
      addTearDown(controller.dispose);
      controller.historyViewportShown('root');
      _replayNativeProducer(controller, 'kimi', latestOnly: true);
      for (var i = 0; i < 100 && api.commands.isEmpty; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      expect(api.commands, hasLength(1));
      for (final row in [
        {
          'kind': 'user.message',
          'turn_id': 'newer-turn',
          'item_id': 'newer-user',
          'text': 'Newer input',
        },
        {'kind': 'turn.started', 'turn_id': 'newer-turn'},
        {
          'kind': 'message.delta',
          'turn_id': 'newer-turn',
          'text': 'Newer output',
        },
      ].asMap().entries) {
        controller.applyEventForTesting(
          RelayEvent(
            cursor: 100 + row.key,
            sourceSequence: 100 + row.key,
            eventId: 'newer-${row.key}',
            sessionId: 'root',
            agentId: null,
            createdAt: '2026-10-06T11:00:00Z',
            event: row.value,
          ),
        );
      }
      gate.complete();
      await _waitForHydration(controller, api);
      expect(
        controller.activeMessages.any((m) => m.content == 'Newer input'),
        isTrue,
      );
      expect(
        controller.activeMessages.any((m) => m.content == 'Newer output'),
        isTrue,
      );
      expect(controller.runningSessions, contains('root'));
      final previousReply = controller.activeMessages.firstWhere(
        (m) => m.id == 'msg_kimi_history_B',
      );
      expect(controller.canBranchReply(source, previousReply), isFalse);
    },
  );

  test(
    'first advertised latest capability hydrates completed visible reply once',
    () async {
      final api = _BranchApi()..historyMessages = _nativeLatestHistory('kimi');
      final source = _source(mode: null);
      final controller = workbenchController(
        api: api,
        baseController: AppController(api: api),
        sessions: [source],
      );
      controller.relayKey = api.key;
      controller.historyHasMore['root'] = false;
      addTearDown(controller.dispose);
      controller.historyViewportShown('root');
      _replayNativeProducer(controller, 'kimi');
      expect(api.commands, isEmpty);
      final advertised = _source(mode: 'latest');
      controller.replaceSessionsForTesting([advertised]);
      await _waitForHydration(controller, api);
      final latest = controller.activeMessages.lastWhere(
        (m) => m.role == 'codex',
      );
      expect(controller.canBranchReply(advertised, latest), isTrue);
      controller.replaceSessionsForTesting([advertised]);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(
        api.commands.where((c) => c.aad.type == 'session.read_history'),
        hasLength(1),
      );
    },
  );

  test(
    'message and turn identities never share an unknown-operation key',
    () async {
      final api = _BranchApi()..forkError = 'session_fork_outcome_unknown';
      final controller = _fixture(api);
      addTearDown(controller.dispose);
      final source = controller.activeSession!;
      const withoutTurn = RelayMessage(
        id: 'turn-a',
        role: 'codex',
        content: 'Old',
        kind: 'message',
        createdAt: '',
        messagePhase: 'final_answer',
        turnStatus: 'completed',
      );
      controller.messages['root'] = [withoutTurn];
      await controller.branchFromReply(source, withoutTurn);
      controller.messages['root'] = [_reply];
      await controller.branchFromReply(source, _reply);
      final forks = api.commands
          .where((c) => c.aad.type == 'session.fork')
          .toList();
      expect(forks, hasLength(2));
      expect(forks[0].aad.requestId, isNot(forks[1].aad.requestId));
    },
  );
  test(
    'native catalog progress retries lagged history without periodic polling',
    () async {
      final prior = _nativeLatestHistory('kimi')[1]
        ..['turn_status'] = 'completed'
        ..['message_phase'] = 'final_answer';
      final api = _BranchApi()..historyMessages = [prior];
      final source = _source(mode: 'latest');
      final controller = workbenchController(
        api: api,
        baseController: AppController(api: api),
        sessions: [source],
      );
      controller.relayKey = api.key;
      controller.messages['root'] = [RelayMessage.fromHistory(prior)];
      addTearDown(controller.dispose);
      controller.historyViewportShown('root');
      _replayNativeProducer(controller, 'kimi', latestOnly: true);
      await _waitForHydration(controller, api);
      final live = controller.activeMessages.lastWhere(
        (m) => m.role == 'codex',
      );
      expect(live.id, startsWith('agent_'));
      controller.replaceSessionsForTesting([source]);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(api.commands, hasLength(1));
      api.historyMessages = _nativeLatestHistory('kimi');
      final advanced = RelaySession.fromJson({
        ...source.raw,
        'updated_at': '2026-10-06T11:00:00Z',
      });
      controller.replaceSessionsForTesting([advanced]);
      await _waitForHydration(controller, api);
      for (
        var i = 0;
        i < 100 &&
            controller.activeMessages.any(
              (m) => m.role == 'codex' && m.id.startsWith('agent_'),
            );
        i++
      ) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      final latest = controller.activeMessages.lastWhere(
        (m) => m.role == 'codex',
      );
      expect(controller.canBranchReply(advanced, latest), isTrue);
      expect(api.commands, hasLength(2));
      controller.replaceSessionsForTesting([advanced]);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(api.commands, hasLength(2));
    },
  );

  test(
    'loaded native user-only history is not an empty native baseline',
    () async {
      final native = _nativeLatestHistory('kimi');
      final api = _BranchApi()..historyMessages = native;
      final source = _source(mode: 'latest');
      final controller = workbenchController(
        api: api,
        baseController: AppController(api: api),
        sessions: [source],
      );
      controller.relayKey = api.key;
      controller.messages['root'] = [RelayMessage.fromHistory(native.first)];
      controller.historyHasMore['root'] = false;
      addTearDown(controller.dispose);
      controller.historyViewportShown('root');
      _replayNativeProducer(controller, 'kimi', latestOnly: true);
      await _waitForHydration(controller, api);
      expect(
        controller.activeMessages.any(
          (m) => m.role == 'codex' && m.id.startsWith('agent_'),
        ),
        isTrue,
      );
    },
  );
  for (final provider in ['kimi', 'mcode', 'opencode']) {
    test(
      '$provider later completion hydrates naturally from its prior native boundary',
      () async {
        final native = _nativeLatestHistory(provider);
        native[1]['turn_status'] = 'completed';
        native[1]['message_phase'] = 'final_answer';
        final api = _BranchApi()..historyMessages = native;
        final source = RelaySession.fromJson({
          ..._source(mode: 'latest', worktree: false).raw,
          'provider': provider,
        });
        final controller = workbenchController(
          api: api,
          baseController: AppController(api: api),
          sessions: [source],
        );
        controller.relayKey = api.key;
        controller.messages['root'] = [RelayMessage.fromHistory(native[1])];
        addTearDown(controller.dispose);
        controller.historyViewportShown('root');
        _replayNativeProducer(controller, provider, latestOnly: true);
        await _waitForHydration(controller, api);
        final latest = controller.activeMessages.lastWhere(
          (m) => m.role == 'codex',
        );
        expect(controller.canBranchReply(source, latest), isTrue);
        expect(
          controller.activeMessages.where(
            (m) => m.role == 'codex' && m.id.startsWith('agent_'),
          ),
          isEmpty,
        );
        expect(api.commands, hasLength(1));
      },
    );
  }

  test(
    'two completions coalesce then read the newer native boundary once',
    () async {
      final initial = _nativeLatestHistory('kimi')[1]
        ..['id'] = 'native-before'
        ..['turn_id'] = 'native-before-turn'
        ..['turn_status'] = 'completed'
        ..['message_phase'] = 'final_answer';
      final one = _nativeLatestHistory('kimi').take(2).toList();
      one.last['turn_status'] = 'completed';
      one.last['message_phase'] = 'final_answer';
      final api = _BranchApi()
        ..historyPages = [
          [initial, ...one],
          [initial, ..._nativeLatestHistory('kimi')],
        ];
      final source = _source(mode: 'latest');
      final controller = workbenchController(
        api: api,
        baseController: AppController(api: api),
        sessions: [source],
      );
      controller.relayKey = api.key;
      controller.messages['root'] = [RelayMessage.fromHistory(initial)];
      addTearDown(controller.dispose);
      controller.historyViewportShown('root');
      _replayNativeProducer(controller, 'kimi');
      await _waitForHydration(controller, api);
      final latest = controller.activeMessages.lastWhere(
        (m) => m.role == 'codex',
      );
      expect(
        controller.canBranchReply(source, latest),
        isTrue,
        reason: jsonEncode({
          'messages': controller.activeMessages
              .map(
                (m) => {
                  'id': m.id,
                  'turn': m.turnId,
                  'seq': m.sourceSequence,
                  'status': m.turnStatus,
                  'phase': m.messagePhase,
                },
              )
              .toList(),
          'requests': api.commands.length,
        }),
      );
      expect(api.commands, hasLength(2));
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(api.commands, hasLength(2));
    },
  );
  test(
    'catalog progress during a lagged read is delivered after that read',
    () async {
      final prior = _nativeLatestHistory('kimi')[1]
        ..['turn_status'] = 'completed'
        ..['message_phase'] = 'final_answer';
      final gate = Completer<void>();
      final api = _BranchApi()
        ..historyMessages = [prior]
        ..historyResponseGate = gate;
      final source = _source(mode: 'latest');
      final controller = workbenchController(
        api: api,
        baseController: AppController(api: api),
        sessions: [source],
      );
      controller.relayKey = api.key;
      controller.messages['root'] = [RelayMessage.fromHistory(prior)];
      addTearDown(controller.dispose);
      controller.historyViewportShown('root');
      _replayNativeProducer(controller, 'kimi', latestOnly: true);
      for (var i = 0; i < 100 && api.commands.isEmpty; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      expect(api.commands, hasLength(1));
      // The pending response captured A. Native B becomes durable while A's read
      // is blocked, and its catalog progression must survive the coalescing lane.
      api.historyMessages = _nativeLatestHistory('kimi');
      controller.replaceSessionsForTesting([
        RelaySession.fromJson({
          ...source.raw,
          'updated_at': '2026-10-06T11:00:00Z',
        }),
      ]);
      gate.complete();
      for (
        var i = 0;
        i < 100 &&
            (api.commands.length < 2 ||
                controller.activeMessages.any(
                  (m) => m.role == 'codex' && m.id.startsWith('agent_'),
                ));
        i++
      ) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      expect(api.commands, hasLength(2));
      final latest = controller.activeMessages.lastWhere(
        (m) => m.role == 'codex',
      );
      expect(
        controller.canBranchReply(controller.activeSession!, latest),
        isTrue,
      );
    },
  );
  for (final blank in [null, '', '   ']) {
    test(
      'blank turn $blank keeps different reply operations distinct',
      () async {
        final api = _BranchApi()..forkError = 'session_fork_outcome_unknown';
        final controller = _fixture(api);
        addTearDown(controller.dispose);
        final source = controller.activeSession!;
        for (final id in ['one', 'two']) {
          final reply = RelayMessage(
            id: id,
            role: 'codex',
            content: 'Done',
            createdAt: '',
            kind: 'message',
            turnId: blank,
            messagePhase: 'final_answer',
            turnStatus: 'completed',
          );
          controller.messages['root'] = [reply];
          await controller.branchFromReply(source, reply);
        }
        final forks = api.commands
            .where((c) => c.aad.type == 'session.fork')
            .toList();
        expect(forks, hasLength(2));
        expect(forks[0].aad.requestId, isNot(forks[1].aad.requestId));
      },
    );
  }

  test(
    'duplicate completed marker consumes its native boundary once',
    () async {
      final previous = _nativeLatestHistory('kimi')[1]
        ..['id'] = 'native-before'
        ..['turn_id'] = 'native-before-turn'
        ..['turn_status'] = 'completed'
        ..['message_phase'] = 'final_answer';
      final api = _BranchApi()
        ..historyMessages = [previous, ..._nativeLatestHistory('kimi')];
      final source = _source(mode: 'latest');
      final controller = workbenchController(
        api: api,
        baseController: AppController(api: api),
        sessions: [source],
      );
      controller.relayKey = api.key;
      controller.messages['root'] = [RelayMessage.fromHistory(previous)];
      addTearDown(controller.dispose);
      _replayNativeProducer(controller, 'kimi');
      final first = controller.activeMessages.firstWhere(
        (m) => m.kind == 'turn.completed',
      );
      controller.messages['root']!.add(
        RelayMessage(
          id: 'duplicate-terminal',
          role: 'system',
          content: '',
          createdAt: first.createdAt,
          kind: 'turn.completed',
          turnId: first.turnId,
          turnStatus: 'completed',
          sourceSequence: 5,
        ),
      );
      controller.historyViewportShown('root');
      await controller.loadHistory('root');
      expect(
        controller.activeMessages.where(
          (m) => m.role == 'codex' && m.id.startsWith('agent_'),
        ),
        isEmpty,
      );
      final latest = controller.activeMessages.lastWhere(
        (m) => m.role == 'codex',
      );
      expect(controller.canBranchReply(source, latest), isTrue);
    },
  );
}

AppController _fixture(_BranchApi api, {AppController? base}) {
  final controller = workbenchController(
    api: api,
    baseController: base ?? AppController(api: api),
    sessions: [_source()],
  );
  controller.relayKey = api.key;
  controller.messages['root'] = [_reply, _laterReply];
  return controller;
}

class _BranchCommand {
  _BranchCommand(this.aad, this.envelope);
  final RelayAad aad;
  final SealedEnvelope envelope;
  String get frame =>
      jsonEncode({'aad': aad.toJson(), 'envelope': envelope.toJson()});
}

class _BranchApi extends RelayApi {
  final key = RelayKey.import(
    base64Url.encode(List.generate(32, (i) => i)).replaceAll('=', ''),
  );
  final commands = <_BranchCommand>[];
  final byRequest = <String, _BranchCommand>{};
  bool throwPostOnce = false;
  bool useWorktree = false;
  String provider = 'codex';
  List<Map<String, dynamic>>? historyMessages;
  List<List<Map<String, dynamic>>>? historyPages;
  bool historyFails = false;
  Completer<void>? historyResponseGate;
  String? forkError;
  String responseSource = 'root';
  String? responseRouteSessionId;

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
    final command = _BranchCommand(aad, envelope);
    commands.add(command);
    byRequest[requestId] = command;
    if (throwPostOnce) {
      throwPostOnce = false;
      throw const RelayApiException('', 0, 'network_timeout');
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
    final command = byRequest[requestId]!;
    final history = command.aad.type == 'session.read_history';
    final snapshot = history && historyPages?.isNotEmpty == true
        ? historyPages!.removeAt(0)
        : historyMessages;
    if (history && historyResponseGate != null) {
      await historyResponseGate!.future;
    }
    final type = history
        ? historyFails
              ? 'session.history_error'
              : 'session.history'
        : forkError == null
        ? 'session.fork_result'
        : 'session.fork_error';
    final sessionId = history
        ? command.aad.sessionId
        : forkError == null
        ? 'new-chat'
        : 'root';
    final aad = RelayAad(
      direction: 'relay_to_web',
      type: type,
      deviceId: 'device',
      sessionId: responseRouteSessionId ?? sessionId,
      requestId: requestId,
      eventSeq: null,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      expiresAt: null,
    );
    final payload = {
      'type': type,
      'request_id': requestId,
      'session_id': sessionId,
      if (!history) 'source_session_id': responseSource,
      if (!history && forkError != null) 'error': forkError,
      if (!history && forkError == null)
        'session': {
          ..._source().raw,
          'id': 'new-chat',
          'provider': provider,
          'name': 'New chat',
          'cwd': useWorktree
              ? '/workspace/branch-worktree'
              : '/workspace/relayune',
        },
      if (history && historyFails) ...{
        'error': 'Fixture history read failed.',
        'error_code': 'history_read_failed',
      },
      if (history && !historyFails) ...{
        'messages':
            snapshot ??
            [
              {
                ...{
                  'id': 'inherited-a',
                  'role': 'codex',
                  'content': 'Inherited answer A',
                  'turn_id': 'turn-a',
                  'message_phase': 'final_answer',
                  'turn_status': 'completed',
                  'created_at': '2026-10-06T10:00:00Z',
                },
              },
            ],
        'has_more': false,
        'next_cursor': null,
      },
    };
    return OpaqueFrame(
      deviceId: 'device',
      sessionId: responseRouteSessionId ?? sessionId,
      requestId: requestId,
      aad: aad,
      envelope: await RelayCipher().sealJson(key, payload, aad),
    );
  }
}

class _RecoveryController extends AppController {
  _RecoveryController({required super.api});
  bool timeoutOnce = false;
  @override
  Future<Map<String, dynamic>> waitForEncryptedResponse(
    String requestId, {
    bool preserveCompression = false,
    Duration timeout = const Duration(seconds: 20),
    bool retryTransientErrors = false,
    DownloadProgressCallback? onProgress,
    bool serverOnly = false,
  }) {
    if (timeoutOnce) {
      timeoutOnce = false;
      throw TimeoutException('fixture response timeout');
    }
    return super.waitForEncryptedResponse(
      requestId,
      preserveCompression: preserveCompression,
      timeout: timeout,
      retryTransientErrors: retryTransientErrors,
      onProgress: onProgress,
      serverOnly: serverOnly,
    );
  }
}

List<Map<String, dynamic>> _nativeLatestHistory(String provider) => [
  for (final marker in ['A', 'B']) ...[
    {
      'id': 'native-user-$marker',
      'role': 'user',
      'content': 'ROUND_$marker',
      'turn_id': 'native-history-turn-$marker',
      'created_at': '2026-10-06T09:00:00Z',
    },
    {
      'id': 'msg_${provider}_history_$marker',
      'role': 'codex',
      'content': marker == 'A' ? 'FORK_MARKER_A_9b3d' : 'FORK_MARKER_B_8e7a',
      'turn_id': 'native-history-turn-$marker',
      'created_at': '2026-10-06T09:00:00Z',
      if (marker == 'B') 'turn_status': 'completed',
      if (marker == 'B') 'message_phase': 'final_answer',
    },
  ],
];

Future<void> _waitForHydration(AppController controller, _BranchApi api) async {
  for (var i = 0; i < 100; i++) {
    if (api.commands.any((c) => c.aad.type == 'session.read_history') &&
        !controller.historyLoading.contains('root')) {
      return;
    }
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
  expect(
    api.commands.where((c) => c.aad.type == 'session.read_history'),
    isNotEmpty,
  );
  expect(controller.historyLoading, isNot(contains('root')));
}

void _replayNativeProducer(
  AppController controller,
  String provider, {
  String? terminal,
  bool latestOnly = false,
}) {
  final all = jsonDecode(_nativeProducerEvents[provider]!) as List;
  final events = latestOnly
      ? all.sublist(
          all.lastIndexWhere((m) => (m as Map)['kind'] == 'turn.started'),
        )
      : all;
  var index = 0;
  for (final row in events) {
    final event = Map<String, dynamic>.from(row as Map);
    if (terminal != null && event['kind'] == 'turn.completed') {
      if (terminal == 'failed') {
        event['kind'] = 'turn.failed';
      }
      event['status'] = terminal;
    }
    controller.applyEventForTesting(
      RelayEvent(
        cursor: ++index,
        sourceSequence: index,
        eventId: 'native-$provider-$index',
        sessionId: 'root',
        agentId: null,
        createdAt: '2026-10-06T10:00:00Z',
        event: event,
      ),
    );
  }
}

// Actual local-model producer events: Kimi 2.1.1, MiniMax 0.6.3 and OpenCode
// 2.0.24. Only fixture source session IDs are omitted; wire fields are retained.
const _nativeProducerEvents = <String, String>{
  'kimi':
      r'''[{"kind": "turn.started", "turn_id": "turn_kimi_af3fab4910374667bece1ab346f3419c", "request_id": "fixture-0", "provider": "kimi"}, {"kind": "message.delta", "turn_id": "turn_kimi_af3fab4910374667bece1ab346f3419c", "text": "FORK_MARKER_A_9b3d", "provider": "kimi"}, {"kind": "message.completed", "turn_id": "turn_kimi_af3fab4910374667bece1ab346f3419c", "text": "FORK_MARKER_A_9b3d", "provider": "kimi"}, {"kind": "turn.completed", "turn_id": "turn_kimi_af3fab4910374667bece1ab346f3419c", "status": "completed", "provider": "kimi"}, {"kind": "turn.started", "turn_id": "turn_kimi_cf7a224236c64cb5847ad7b20f28ece0", "request_id": "fixture-4", "provider": "kimi"}, {"kind": "message.delta", "turn_id": "turn_kimi_cf7a224236c64cb5847ad7b20f28ece0", "text": "FORK_MARKER_B_8e7a", "provider": "kimi"}, {"kind": "message.completed", "turn_id": "turn_kimi_cf7a224236c64cb5847ad7b20f28ece0", "text": "FORK_MARKER_B_8e7a", "provider": "kimi"}, {"kind": "turn.completed", "turn_id": "turn_kimi_cf7a224236c64cb5847ad7b20f28ece0", "status": "completed", "provider": "kimi"}]''',
  'mcode':
      r'''[{"kind": "turn.started", "turn_id": "turn_mcode_e8e8a09cd1ed4b99b8ead0fb42bb21c6", "request_id": "fixture-0", "provider": "mcode"}, {"kind": "message.delta", "turn_id": "turn_mcode_e8e8a09cd1ed4b99b8ead0fb42bb21c6", "text": "FORK_MARKER_A_9b3d", "provider": "mcode"}, {"kind": "message.completed", "turn_id": "turn_mcode_e8e8a09cd1ed4b99b8ead0fb42bb21c6", "text": "FORK_MARKER_A_9b3d", "provider": "mcode"}, {"kind": "turn.completed", "turn_id": "turn_mcode_e8e8a09cd1ed4b99b8ead0fb42bb21c6", "status": "completed", "provider": "mcode"}, {"kind": "turn.started", "turn_id": "turn_mcode_e3bb441b61cc46f594c8862b809cbed6", "request_id": "fixture-4", "provider": "mcode"}, {"kind": "message.delta", "turn_id": "turn_mcode_e3bb441b61cc46f594c8862b809cbed6", "text": "FORK_MARKER_B_8e7a", "provider": "mcode"}, {"kind": "message.completed", "turn_id": "turn_mcode_e3bb441b61cc46f594c8862b809cbed6", "text": "FORK_MARKER_B_8e7a", "provider": "mcode"}, {"kind": "turn.completed", "turn_id": "turn_mcode_e3bb441b61cc46f594c8862b809cbed6", "status": "completed", "provider": "mcode"}]''',
  'opencode':
      r'''[{"kind": "turn.started", "turn_id": "turn_opencode_e75efc610bb94c708cc0bf9c3a4a2018", "request_id": "fixture-0", "provider": "opencode"}, {"kind": "message.delta", "turn_id": "turn_opencode_e75efc610bb94c708cc0bf9c3a4a2018", "text": "FORK_MARKER_A_9b3d", "provider": "opencode"}, {"kind": "message.completed", "turn_id": "turn_opencode_e75efc610bb94c708cc0bf9c3a4a2018", "text": "FORK_MARKER_A_9b3d", "provider": "opencode"}, {"kind": "turn.completed", "turn_id": "turn_opencode_e75efc610bb94c708cc0bf9c3a4a2018", "status": "end_turn", "provider": "opencode"}, {"kind": "turn.started", "turn_id": "turn_opencode_0719ae5f57ac4b56a96d6c1f235b4098", "request_id": "fixture-4", "provider": "opencode"}, {"kind": "message.delta", "turn_id": "turn_opencode_0719ae5f57ac4b56a96d6c1f235b4098", "text": "FORK_MARKER_B_8e7a", "provider": "opencode"}, {"kind": "message.completed", "turn_id": "turn_opencode_0719ae5f57ac4b56a96d6c1f235b4098", "text": "FORK_MARKER_B_8e7a", "provider": "opencode"}, {"kind": "turn.completed", "turn_id": "turn_opencode_0719ae5f57ac4b56a96d6c1f235b4098", "status": "end_turn", "provider": "opencode"}]''',
};
