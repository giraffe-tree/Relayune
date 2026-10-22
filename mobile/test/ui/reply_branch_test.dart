import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/ui/theme.dart';

import '../support/workbench_fixture.dart';

const _reply = RelayMessage(
  id: 'reply-a',
  role: 'codex',
  content: 'Finished answer',
  createdAt: '2026-10-06T10:00:00Z',
  kind: 'message',
  turnId: 'turn-a',
  messagePhase: 'final_answer',
  turnStatus: 'completed',
);

void main() {
  testWidgets('unsupported provider has no reply branch entry', (tester) async {
    final controller = _fixture(mode: null);
    addTearDown(controller.dispose);
    await pumpWorkbench(tester, controller);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byKey(const ValueKey('reply-branch-reply-a')), findsNothing);
  });

  testWidgets(
    'latest reply action waits for canonical native history hydration',
    (tester) async {
      final controller = _fixture(mode: 'latest');
      addTearDown(controller.dispose);
      controller.messages['root'] = const [
        RelayMessage(
          id: 'agent_turn-a_item',
          role: 'codex',
          content: 'Finished answer',
          createdAt: '',
          kind: 'message.completed',
          turnId: 'turn-a',
          messagePhase: 'final_answer',
          turnStatus: 'completed',
        ),
      ];
      await pumpWorkbench(tester, controller);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(
        find.byKey(const ValueKey('reply-branch-agent_turn-a_item')),
        findsNothing,
      );
      controller.relayKey = RelayKey.import(
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      );
      controller.hydratedReply = _reply;
      controller.historyViewportShown('root');
      controller.applyEventForTesting(
        const RelayEvent(
          cursor: 1,
          sourceSequence: 1,
          eventId: 'native-completed',
          sessionId: 'root',
          agentId: null,
          createdAt: '2026-10-06T10:00:00Z',
          event: {
            'kind': 'turn.completed',
            'turn_id': 'turn-a',
            'status': 'completed',
          },
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(
        find.byKey(const ValueKey('reply-branch-reply-a')),
        findsOneWidget,
      );
      expect(controller.historyRefreshes, 1);
    },
  );

  testWidgets(
    'same-directory-only reply creates directly without a choice sheet',
    (tester) async {
      final controller = _fixture();
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tap(find.byKey(const ValueKey('reply-branch-reply-a')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(controller.calls, [false]);
      expect(
        find.byKey(const ValueKey('reply-branch-same-directory')),
        findsNothing,
      );
    },
  );

  testWidgets(
    'worktree choice uses two direct actions and sends explicit isolation selection',
    (tester) async {
      final controller = _fixture(worktree: true);
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tap(find.byKey(const ValueKey('reply-branch-reply-a')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(controller.calls, isEmpty);
      expect(find.text('继续共用项目文件'), findsOneWidget);
      expect(find.text('独立目录，基于当前提交'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('reply-branch-worktree')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(controller.calls, [true]);
    },
  );

  testWidgets(
    'offline reply entry is gray and explains computer connection on tap',
    (tester) async {
      final controller = _fixture(online: false);
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      final button = find.byKey(const ValueKey('reply-branch-reply-a'));
      expect(
        tester.widget<TextButton>(button).style!.foregroundColor!.resolve({}),
        RelayTheme.muted,
      );
      await tester.tap(button);
      await tester.pump();
      expect(find.text('连接电脑后可分支'), findsOneWidget);
      expect(controller.calls, isEmpty);
    },
  );
}

_BranchTapController _fixture({
  String? mode = 'turn',
  bool worktree = false,
  bool online = true,
}) {
  final source = RelaySession.fromJson({
    ...relaySession().raw,
    'status': 'idle',
    if (mode != null) 'fork_mode': mode,
    'supports_fork_worktree': worktree,
  });
  final controller =
      workbenchController(
            baseController: _BranchTapController(),
            sessions: [source],
            online: online,
          )
          as _BranchTapController;
  controller.messages['root'] = [_reply];
  return controller;
}

class _BranchTapController extends AppController {
  final calls = <bool>[];
  RelayMessage? hydratedReply;
  int historyRefreshes = 0;

  @override
  Future<void> loadHistory(
    String sessionId, {
    bool earlier = false,
    bool silent = false,
    bool localOnly = false,
  }) async {
    if (hydratedReply == null) return;
    historyRefreshes += 1;
    await Future<void>.value();
    messages[sessionId] = [hydratedReply!];
    replaceSessionsForTesting(sessions);
  }

  @override
  Future<void> branchFromReply(
    RelaySession source,
    RelayMessage message, {
    bool worktree = false,
  }) async {
    expect(source.id, 'root');
    expect(message.id, 'reply-a');
    calls.add(worktree);
  }
}
