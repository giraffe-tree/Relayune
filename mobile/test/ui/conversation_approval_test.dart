import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/notifications/notification_coordinator.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets(
    'late approval request and failure cannot reopen a resolved card',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      final now = DateTime.now();
      void apply(String id, Map<String, dynamic> event) =>
          controller.applyEventForTesting(
            RelayEvent(
              cursor: 1,
              eventId: id,
              sessionId: 'root',
              agentId: null,
              createdAt: now.toIso8601String(),
              event: event,
            ),
          );
      apply('resolved-first', {
        'kind': 'approval.resolved',
        'approval_id': 'replayed',
        'decision': 'approved',
      });
      apply('late-request', {
        'kind': 'approval.requested',
        'turn_id': 'original-turn',
        'approval_id': 'replayed',
        'requested_at': now
            .subtract(const Duration(minutes: 1))
            .toIso8601String(),
        'expires_at': now.add(const Duration(minutes: 2)).toIso8601String(),
        'action': {
          'type': 'question.select',
          'display': 'Old question',
          'command_hash': 'sha256:test',
        },
      });
      apply('late-failure', {
        'kind': 'approval.failed',
        'approval_id': 'replayed',
        'error': 'old failure',
      });
      expect(controller.approvals.single.state, 'approved');
      expect(controller.approvals.single.turnId, 'original-turn');
      expect(controller.pendingApprovalCount, 0);
    },
  );

  testWidgets('answered questions belong to their original collapsed process', (
    tester,
  ) async {
    final controller = workbenchController(
      approvals: [
        const RelayApproval(
          id: 'question-history',
          sessionId: 'root',
          turnId: 'older',
          action: {'type': 'question.select', 'display': 'Choose a marker'},
          riskLevel: 'medium',
          state: 'approved',
          requestedAt: '2026-09-18T00:01:00Z',
          expiresAt: '2026-09-18T00:11:00Z',
        ),
      ],
    );
    addTearDown(controller.dispose);
    controller.messages['root'] = [
      const RelayMessage(
        id: 'older-final',
        turnId: 'older',
        role: 'codex',
        content: 'Earlier answer',
        createdAt: '2026-09-18T00:02:00Z',
        kind: 'message',
        messagePhase: 'final_answer',
      ),
      const RelayMessage(
        id: 'newer-final',
        turnId: 'newer',
        role: 'codex',
        content: 'Latest answer',
        createdAt: '2026-09-18T00:03:00Z',
        kind: 'message',
        messagePhase: 'final_answer',
      ),
    ];
    await pumpWorkbench(tester, controller);
    expect(find.text('Choose a marker'), findsNothing);
    final process = find.byKey(
      const ValueKey('turn-activity-header-turn:older'),
    );
    expect(process, findsOneWidget);
    await tester.tap(process);
    await tester.pump(const Duration(milliseconds: 300));
    final card = find.byKey(
      const ValueKey('conversation-approval-question-history'),
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('turn-activity-turn:older')),
        matching: card,
      ),
      findsOneWidget,
    );
    expect(
      find.text(
        AppLocalizations.of(tester.element(card)).workbenchStateAnswered,
      ),
      findsOneWidget,
    );
    expect(
      tester.getTopLeft(card).dy,
      lessThan(tester.getTopLeft(find.text('Earlier answer')).dy),
    );
    expect(
      tester.getTopLeft(card).dy,
      lessThan(tester.getTopLeft(find.text('Latest answer')).dy),
    );
  });

  testWidgets(
    'three questions switch independently, retain drafts and advance after an answer',
    (tester) async {
      final now = DateTime.now();
      final approvals = List.generate(
        3,
        (i) => RelayApproval(
          id: 'multi-$i',
          sessionId: 'root',
          turnId: 'multi-turn',
          riskLevel: 'medium',
          state: 'pending',
          requestedAt: now.toIso8601String(),
          expiresAt: now.add(const Duration(minutes: 10)).toIso8601String(),
          action: {
            'type': 'question.select',
            'display': 'Question $i',
            'allows_freeform': true,
            'question_index': i,
            'question_count': 3,
            'question_group': 'call-multi',
            'options': <Map<String, dynamic>>[],
            'command_hash': 'sha256:test',
          },
        ),
      );
      final controller = workbenchController(
        approvals: approvals.reversed.toList(),
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      expect(find.text('Question 0'), findsOneWidget);
      expect(find.text('Question 1'), findsNothing);
      expect(find.text('1 / 3'), findsOneWidget);
      await tester.enterText(
        find.byKey(
          const ValueKey('conversation-approval-multi-0-answer-input'),
        ),
        'first draft',
      );
      await tester.tap(find.byKey(const ValueKey('question-select-multi-1')));
      await tester.pump(const Duration(milliseconds: 300));
      await tester.enterText(
        find.byKey(
          const ValueKey('conversation-approval-multi-1-answer-input'),
        ),
        'second draft',
      );
      await tester.tap(find.byKey(const ValueKey('question-select-multi-0')));
      await tester.pump(const Duration(milliseconds: 300));
      expect(
        tester
            .widget<TextField>(
              find.byKey(
                const ValueKey('conversation-approval-multi-0-answer-input'),
              ),
            )
            .controller!
            .text,
        'first draft',
      );
      controller.applyEventForTesting(
        RelayEvent(
          cursor: 1,
          eventId: 'resolve-multi-0',
          sessionId: 'root',
          agentId: null,
          createdAt: now.toIso8601String(),
          event: {
            'kind': 'approval.resolved',
            'approval_id': 'multi-0',
            'decision': 'approved',
          },
        ),
      );
      controller.notifyListeners();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Question 1'), findsOneWidget);
      expect(find.text('2 / 3'), findsOneWidget);
      expect(
        tester
            .widget<TextField>(
              find.byKey(
                const ValueKey('conversation-approval-multi-1-answer-input'),
              ),
            )
            .controller!
            .text,
        'second draft',
      );
      expect(
        controller.approvals.where(controller.approvalIsPending).length,
        2,
      );
      expect(tester.takeException(), isNull);
    },
  );

  for (final resolveBeforeResponse in [false, true]) {
    testWidgets(
      'resolved approval clears waiting notice (early=$resolveBeforeResponse)',
      (tester) async {
        final api = _ApprovalCaptureApi();
        final controller = workbenchController(
          api: api,
          approvals: [_approval(id: 'approval-root', sessionId: 'root')],
        )..relayKey = RelayKey.import(_testKey);
        addTearDown(controller.dispose);
        void resolve() => controller.applyEventForTesting(
          RelayEvent(
            cursor: 9,
            eventId: 'resolved',
            sessionId: 'root',
            agentId: null,
            createdAt: DateTime.now().toIso8601String(),
            event: {
              'kind': 'approval.resolved',
              'approval_id': 'approval-root',
              'decision': 'approved',
            },
          ),
        );
        if (resolveBeforeResponse) api.onDecision = resolve;
        await controller.decideApproval(
          controller.approvals.single,
          'approved',
          acknowledgeWithHaptics: false,
        );
        if (!resolveBeforeResponse) {
          expect(controller.notice, '允许决定已发送，等待电脑确认。');
          resolve();
        }
        expect(controller.approvals.single.state, 'approved');
        expect(controller.notice, isEmpty);
        await tester.pump(const Duration(milliseconds: 350));
      },
    );
  }
  testWidgets('approval confirmation preserves an unrelated notice', (
    tester,
  ) async {
    final controller = workbenchController(
      api: _ApprovalCaptureApi(),
      approvals: [_approval(id: 'approval-root', sessionId: 'root')],
    )..relayKey = RelayKey.import(_testKey);
    addTearDown(controller.dispose);
    await controller.decideApproval(
      controller.approvals.single,
      'approved',
      acknowledgeWithHaptics: false,
    );
    controller.notice = 'unrelated update';
    controller.applyEventForTesting(
      RelayEvent(
        cursor: 9,
        eventId: 'resolved',
        sessionId: 'root',
        agentId: null,
        createdAt: DateTime.now().toIso8601String(),
        event: {
          'kind': 'approval.resolved',
          'approval_id': 'approval-root',
          'decision': 'approved',
        },
      ),
    );
    expect(controller.notice, 'unrelated update');
    await tester.pump(const Duration(milliseconds: 350));
  });

  for (final compact in [false, true]) {
    testWidgets(
      'optionless question exposes answer and scrolls with keyboard (compact=$compact)',
      (tester) async {
        final api = _ApprovalCaptureApi();
        final controller = workbenchController(
          api: api,
          approvals: [
            _approvalWithAction(
              id: 'direct',
              action: const {
                'type': 'question.select',
                'display': '请重新用 USB 连接 vivo 手机并允许 USB 调试，连接好后告诉我，我会安装这次优化版本。',
                'command_hash': 'sha256:direct',
                'allows_freeform': true,
                'options': [],
              },
            ),
          ],
        )..relayKey = RelayKey.import(_testKey);
        addTearDown(controller.dispose);
        await pumpWorkbench(
          tester,
          controller,
          size: compact ? const Size(320, 700) : const Size(390, 844),
          textScale: compact ? 1.6 : 1,
        );
        final input = find.byKey(
          const ValueKey('conversation-approval-direct-answer-input'),
        );
        expect(input, findsOneWidget);
        expect(
          find.byKey(const ValueKey('conversation-approval-direct-freeform')),
          findsNothing,
        );
        if (!compact) expect(input.hitTestable(), findsOneWidget);
        await tester.ensureVisible(input);
        await tester.enterText(input, '已连接');
        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        addTearDown(tester.view.resetViewInsets);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 260));
        final submit = find.byKey(
          const ValueKey('conversation-approval-direct-answer-submit'),
        );
        await tester.ensureVisible(submit);
        await tester.pump();
        expect(submit.hitTestable(), findsOneWidget);
        await tester.tap(submit);
        await tester.pump();
        final command = await api.openCommand(0);
        expect(command['payload']['answer'], '已连接');
        expect(command['payload']['approval_id'], 'direct');
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('free answer draft survives switching conversations', (
    tester,
  ) async {
    final controller = workbenchController(
      sessions: [
        relaySession(id: 'root'),
        relaySession(id: 'other'),
      ],
      approvals: [
        _approvalWithAction(
          id: 'answer',
          action: const {
            'type': 'question.select',
            'display': 'Choose a color',
            'allows_freeform': true,
            'options': [
              {'option_id': 'red', 'name': 'Red', 'kind': 'allow_once'},
            ],
          },
        ),
      ],
    );
    addTearDown(controller.dispose);
    await pumpWorkbench(tester, controller, size: const Size(390, 844));
    await tester.ensureVisible(
      find.byKey(const ValueKey('conversation-approval-answer-freeform')),
    );
    await tester.tap(
      find.byKey(const ValueKey('conversation-approval-answer-freeform')),
    );
    await tester.pump();
    final input = find.byKey(
      const ValueKey('conversation-approval-answer-answer-input'),
    );
    await tester.enterText(input, 'CEDAR_DRAFT_7316');
    await controller.selectSession('other');
    await tester.pump();
    expect(find.text('CEDAR_DRAFT_7316'), findsNothing);
    await controller.selectSession('root');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));
    if (input.evaluate().isEmpty) {
      await tester.ensureVisible(
        find.byKey(const ValueKey('conversation-approval-answer-freeform')),
      );
      await tester.tap(
        find.byKey(const ValueKey('conversation-approval-answer-freeform')),
      );
      await tester.pump();
    }
    expect(
      tester.widget<TextField>(input).controller!.text,
      'CEDAR_DRAFT_7316',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'child approval keeps root routing and the native target after deciding',
    (tester) async {
      final api = _ApprovalCaptureApi();
      final controller = workbenchController(api: api)
        ..relayKey = RelayKey.import(_testKey);
      controller.applyEventForTesting(
        RelayEvent(
          cursor: 1,
          eventId: 'child-request',
          sessionId: 'root',
          agentId: null,
          createdAt: DateTime.now().toIso8601String(),
          event: {
            'kind': 'approval.requested',
            'approval_id': 'child-approval',
            'session_id': 'child',
            'root_session_id': 'root',
            'action': {
              'type': 'command.execute',
              'display': 'cat sub-r3-a.txt',
              'command_hash': 'sha256:child',
            },
            'risk_level': 'high',
            'expires_at': DateTime.now()
                .add(const Duration(minutes: 2))
                .toIso8601String(),
          },
        ),
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      final allow = find.byKey(
        const ValueKey('conversation-approval-child-approval-allow'),
      );
      await tester.ensureVisible(allow);
      await tester.tap(allow);
      await tester.pump();
      final command = await api.openCommand(0);
      expect(command['session_id'], 'root');
      expect(command['payload']['session_id'], 'child');
      expect(controller.approvals.single.targetSessionId, 'child');
      expect(controller.approvals.single.state, 'deciding');
      await tester.pump(const Duration(milliseconds: 350));
    },
  );

  testWidgets(
    '[MOB-APR-001][flutter] approval cards live in their conversation and the drawer has no approval page',
    (tester) async {
      final api = _ApprovalCaptureApi();
      final controller = workbenchController(
        baseController: _ApprovalController(api: api),
        sessions: [
          relaySession(id: 'root'),
          relaySession(id: 'other', name: 'Other session'),
        ],
        approvals: [
          _approval(id: 'approval-other', sessionId: 'other'),
          _approval(id: 'approval-root-pending', sessionId: 'root'),
          _approval(id: 'approval-root', sessionId: 'root'),
        ],
      )..relayKey = RelayKey.import(_testKey);
      addTearDown(controller.dispose);
      await pumpWorkbench(
        tester,
        controller,
        size: const Size(320, 700),
        textScale: 1.3,
      );

      expect(
        find.byKey(const ValueKey('conversation-approval-approval-root')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('conversation-approval-approval-other')),
        findsNothing,
      );
      expect(find.text('执行命令'), findsWidgets);
      expect(find.text('允许'), findsWidgets);
      expect(find.text('拒绝'), findsWidgets);

      final rootAllow = find.byKey(
        const ValueKey('conversation-approval-approval-root-allow'),
      );
      await tester.ensureVisible(rootAllow);
      await tester.pump(const Duration(milliseconds: 200));
      await tester.tap(rootAllow);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      expect(api.commandTypes, ['approval.resolve']);
      expect(controller.notice, '允许决定已发送，等待电脑确认。');

      await tester.tap(
        find.byKey(const ValueKey('workbench-pending-approval-button')),
      );
      await tester.pump();
      expect(controller.activeSessionId, 'other');
      expect(
        find.byKey(const ValueKey('conversation-approval-approval-other')),
        findsOneWidget,
      );
      final otherReject = find.byKey(
        const ValueKey('conversation-approval-approval-other-reject'),
      );
      await tester.ensureVisible(otherReject);
      await tester.pump(const Duration(milliseconds: 200));
      await tester.tap(otherReject);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      expect(api.commandTypes, ['approval.resolve', 'approval.resolve']);
      expect(controller.notice, '拒绝决定已发送，等待电脑确认。');

      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));

      expect(
        find.byKey(const ValueKey('workbench-section-approvals')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('workbench-section-home')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('workbench-section-conversation')),
        findsNothing,
      );
      expect(find.text('Agents'), findsNothing);
      expect(
        find.byKey(const ValueKey('workbench-section-device')),
        findsNothing,
      );
      await tester.tap(
        find.byKey(
          const ValueKey('project-group-title-path:/workspace/relayune'),
        ),
      );
      await tester.pump(const Duration(milliseconds: 320));
      await tester.pump();
      final badge = tester.widget<Badge>(
        find.byKey(const ValueKey('drawer-session-approval-badge-root')),
      );
      expect(badge.isLabelVisible, isTrue);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-APR-003][flutter] choices are full rows and tray gestures retain the chat draft',
    (tester) async {
      final controller = workbenchController(
        approvals: [
          _approvalWithAction(
            id: 'rows',
            action: const {
              'type': 'question.select',
              'display': 'Which device?',
              'options': [
                {'option_id': 'phone', 'name': 'Phone', 'kind': 'allow_once'},
                {'option_id': 'tablet', 'name': 'Tablet', 'kind': 'allow_once'},
              ],
            },
          ),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      final composer = find.byKey(
        const ValueKey('conversation-composer-input'),
      );
      await tester.enterText(composer, 'Keep this draft');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 260));
      final phone = find.byKey(
        const ValueKey('conversation-approval-rows-option-phone'),
      );
      final tablet = find.byKey(
        const ValueKey('conversation-approval-rows-option-tablet'),
      );
      expect(tester.getRect(phone).left, tester.getRect(tablet).left);
      expect(tester.getRect(phone).width, tester.getRect(tablet).width);
      expect(
        tester.getRect(phone).bottom,
        lessThanOrEqualTo(tester.getRect(tablet).top),
      );
      expect(tester.getSize(phone).height, greaterThanOrEqualTo(44));
      expect(composer.hitTestable(), findsOneWidget);
      final panel = find.byKey(const ValueKey('conversation-activity-panel'));
      final compact = tester.getSize(panel).height;
      expect(
        compact,
        lessThanOrEqualTo(300),
        reason: 'two choices use a compact tray',
      );
      await tester.drag(
        find.byKey(const ValueKey('conversation-activity-drag-handle')),
        const Offset(0, -80),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 260));
      expect(tester.getSize(panel).height, greaterThan(compact));
      await tester.tap(
        find.byKey(const ValueKey('conversation-activity-panel-close')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 260));
      expect(
        tester.widget<TextField>(composer).controller!.text,
        'Keep this draft',
      );
      expect(
        controller.pendingApprovalCount,
        1,
        reason: 'collapse never denies a question',
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-APR-002][flutter] a subagent approval is shown in its root conversation',
    (tester) async {
      final controller = workbenchController(
        sessions: [
          relaySession(id: 'root'),
          relaySession(
            id: 'child',
            name: 'Worker',
            isSubagent: true,
            rootSessionId: 'root',
          ),
        ],
        approvals: [_approval(id: 'approval-child', sessionId: 'child')],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);

      expect(
        find.byKey(const ValueKey('conversation-approval-approval-child')),
        findsOneWidget,
      );
      expect(find.text('来源：Worker'), findsOneWidget);
      expect(
        find.byKey(
          const ValueKey('conversation-approval-approval-child-allow'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(
          const ValueKey('conversation-approval-approval-child-reject'),
        ),
        findsOneWidget,
      );
      expect(controller.pendingApprovalCountForSession('root'), 1);
      expect(controller.nextPendingApprovalSessionId, 'root');
    },
  );

  testWidgets(
    '[MOB-APR-003][flutter] Codex question and rejection options preserve their encrypted decisions',
    (tester) async {
      final api = _ApprovalCaptureApi();
      final controller = workbenchController(
        api: api,
        sessions: [relaySession(id: 'root')],
        approvals: [
          _approvalWithAction(
            id: 'question',
            action: const {
              'type': 'question.select',
              'display': 'Which theme?',
              'cwd': '/workspace/relayune',
              'command_hash': 'sha256:question',
              'allows_freeform': true,
              'options': [
                {
                  'option_id': 'codex_question_0_0',
                  'name': 'Dark',
                  'kind': 'allow_once',
                },
              ],
            },
          ),
        ],
      )..relayKey = RelayKey.import(_testKey);
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);

      await tester.tap(find.text('Dark'));
      await tester.pump();
      final selected = await api.openCommand(0);
      expect(selected['payload']['decision'], 'approved');
      expect(selected['payload']['option_id'], 'codex_question_0_0');

      controller.approvals = [
        _approvalWithAction(
          id: 'cancel',
          action: const {
            'type': 'command.execute',
            'display': 'npm run deploy',
            'cwd': '/workspace/relayune',
            'command_hash': 'sha256:cancel',
            'options': [
              {
                'option_id': 'codex_decision_0',
                'name': 'Reject and stop',
                'kind': 'reject_cancel',
              },
            ],
          },
        ),
      ];
      controller.notifyListeners();
      await tester.pump();
      await tester.tap(find.text('拒绝并停止当前任务'));
      await tester.pump();
      final rejected = await api.openCommand(1);
      expect(rejected['payload']['decision'], 'rejected');
      expect(rejected['payload']['option_id'], 'codex_decision_0');
    },
  );

  for (final provider in ['codex', 'kimi', 'claude', 'claude-cowork']) {
    for (final decision in ['approved', 'rejected']) {
      testWidgets(
        '[MOB-APR-001][flutter] $provider high-risk $decision is sent directly from the conversation',
        (tester) async {
          final api = _ApprovalCaptureApi();
          final controller = workbenchController(
            api: api,
            sessions: [relaySession(provider: provider)],
            approvals: [
              _approvalWithAction(
                id: 'direct',
                riskLevel: 'high',
                action: const {
                  'type': 'command.execute',
                  'display': 'echo fixture > acceptance.txt',
                  'cwd': '/workspace/relayune',
                  'command_hash': 'sha256:direct',
                },
              ),
            ],
          )..relayKey = RelayKey.import(_testKey);
          addTearDown(controller.dispose);
          await pumpWorkbench(tester, controller);

          final button = find.byKey(
            ValueKey(
              'conversation-approval-direct-${decision == 'approved' ? 'allow' : 'reject'}',
            ),
          );
          await tester.ensureVisible(button);
          await tester.tap(button);
          await tester.pump();

          expect(find.byType(AlertDialog), findsNothing);
          expect(controller.activeSessionId, 'root');
          expect(api.commands, hasLength(1));
          final command = await api.openCommand(0);
          expect(command['payload']['decision'], decision);
          expect(command['payload']['approval_id'], 'direct');
          expect(command['payload']['command_hash'], 'sha256:direct');
          expect(controller.approvals.single.state, 'deciding');
          expect(tester.widget<ButtonStyleButton>(button).onPressed, isNull);
        },
      );
    }
    for (final kind in ['allow_once', 'allow_always', 'reject_cancel']) {
      testWidgets(
        '[MOB-APR-003][flutter] $provider $kind preserves the chosen scope without a dialog',
        (tester) async {
          final api = _ApprovalCaptureApi();
          final controller = workbenchController(
            api: api,
            sessions: [relaySession(provider: provider)],
            approvals: [
              _approvalWithAction(
                id: 'option',
                riskLevel: 'high',
                action: {
                  'type': 'command.execute',
                  'display': 'echo fixture',
                  'command_hash': 'sha256:option',
                  'options': [
                    {'option_id': 'chosen', 'kind': kind, 'name': kind},
                  ],
                },
              ),
            ],
          )..relayKey = RelayKey.import(_testKey);
          addTearDown(controller.dispose);
          await pumpWorkbench(tester, controller);
          final button = find.byKey(
            const ValueKey('conversation-approval-option-option-chosen'),
          );
          await tester.ensureVisible(button);
          await tester.tap(button);
          await tester.pump();
          expect(find.byType(AlertDialog), findsNothing);
          expect(api.commands, hasLength(1));
          final command = await api.openCommand(0);
          expect(
            command['payload']['decision'],
            kind.startsWith('reject') ? 'rejected' : 'approved',
          );
          expect(command['payload']['option_id'], 'chosen');
          expect(controller.activeSessionId, 'root');
        },
      );
    }
  }

  testWidgets(
    '[MOB-APR-003][flutter] approvals questions and Agents share a dock and preserve answers across tabs',
    (tester) async {
      final api = _ApprovalCaptureApi();
      final controller = workbenchController(
        api: api,
        agents: [
          RelayAgent(
            id: 'worker',
            threadId: 'worker-thread',
            parentSessionId: 'root',
            name: 'Worker',
            task: 'Check fixture',
            status: 'running',
            progress: 10,
            updatedAt: '2026-09-05T06:00:00Z',
          ),
        ],
        approvals: [
          _approval(id: 'command', sessionId: 'root'),
          _approvalWithAction(
            id: 'answer',
            action: const {
              'type': 'question.select',
              'display': 'Which device?',
              'command_hash': 'sha256:answer',
              'allows_freeform': true,
              'options': [
                {'option_id': 'phone', 'name': 'Phone', 'kind': 'allow_once'},
              ],
            },
          ),
        ],
      )..relayKey = RelayKey.import(_testKey);
      addTearDown(controller.dispose);
      await pumpWorkbench(
        tester,
        controller,
        size: const Size(320, 700),
        textScale: 1.3,
      );
      expect(
        find.byKey(const ValueKey('conversation-activity-panel')),
        findsOneWidget,
      );
      expect(find.byType(AlertDialog), findsNothing);
      await tester.tap(
        find.byKey(const ValueKey('conversation-activity-tab-questions')),
      );
      await tester.pump(const Duration(milliseconds: 240));
      final freeform = find.byKey(
        const ValueKey('conversation-approval-answer-freeform'),
      );
      await tester.ensureVisible(freeform);
      await tester.tap(freeform);
      await tester.pump();
      final input = find.byKey(
        const ValueKey('conversation-approval-answer-answer-input'),
      );
      await tester.ensureVisible(input);
      await tester.enterText(input, 'iOS simulator');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 260));
      await tester.tap(
        find.byKey(const ValueKey('conversation-activity-tab-agents')),
      );
      await tester.pump(const Duration(milliseconds: 240));
      expect(
        find.byKey(const ValueKey('composer-agent-status-list')),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(const ValueKey('conversation-activity-tab-questions')),
      );
      await tester.pump(const Duration(milliseconds: 240));
      expect(tester.widget<TextField>(input).controller!.text, 'iOS simulator');
      final submit = find.byKey(
        const ValueKey('conversation-approval-answer-answer-submit'),
      );
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pump();
      expect(find.byType(AlertDialog), findsNothing);
      final command = await api.openCommand(0);
      expect(command['payload']['answer'], 'iOS simulator');
      expect(command['payload']['approval_id'], 'answer');
      expect(controller.activeSessionId, 'root');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-APR-001][flutter] closed dock reopens for a new approval and fits above the keyboard',
    (tester) async {
      final controller = workbenchController(
        approvals: [_approval(id: 'first', sessionId: 'root')],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(
        tester,
        controller,
        size: const Size(320, 700),
        textScale: 1.3,
      );
      await tester.tap(
        find.byKey(const ValueKey('conversation-activity-panel-close')),
      );
      await tester.pump(const Duration(milliseconds: 240));
      expect(
        find.byKey(const ValueKey('conversation-activity-panel')),
        findsNothing,
      );
      controller.approvals = [
        ...controller.approvals,
        _approval(id: 'second', sessionId: 'root'),
      ];
      controller.notifyListeners();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 240));
      expect(
        find.byKey(const ValueKey('conversation-activity-panel')),
        findsOneWidget,
      );
      tester.view.viewInsets = const FakeViewPadding(bottom: 280);
      addTearDown(tester.view.resetViewInsets);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 240));
      final allow = find.byKey(
        const ValueKey('conversation-approval-second-allow'),
      );
      await tester.ensureVisible(allow);
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(tester.getBottomLeft(allow).dy, lessThan(420));
    },
  );

  testWidgets(
    '[MOB-APR-001][flutter] long command details never push decision buttons under the panel tabs',
    (tester) async {
      final controller = workbenchController(
        approvals: [
          _approvalWithAction(
            id: 'pinned',
            action: {
              'type': 'command.execute',
              'display': 'echo fixture > panel.txt',
              'cwd':
                  '/workspace/${List.filled(20, 'long-directory').join('/')}',
              'command_hash': 'sha256:pinned',
            },
          ),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.pump(const Duration(milliseconds: 240));
      final allow = find.byKey(
        const ValueKey('conversation-approval-pinned-allow'),
      );
      final reject = find.byKey(
        const ValueKey('conversation-approval-pinned-reject'),
      );
      final tab = find.byKey(const ValueKey('conversation-composer-input'));
      expect(allow.hitTestable(), findsOneWidget);
      expect(reject.hitTestable(), findsOneWidget);
      expect(
        tester.getBottomLeft(allow).dy,
        lessThan(tester.getTopLeft(tab).dy),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-APR-001][flutter] expired approvals remain in history without occupying the activity dock',
    (tester) async {
      final controller = workbenchController(
        approvals: [
          RelayApproval(
            id: 'expired',
            sessionId: 'root',
            action: const {'type': 'command.execute', 'display': 'echo stale'},
            riskLevel: 'medium',
            state: 'pending',
            requestedAt: '2020-01-01T00:00:00Z',
            expiresAt: '2020-01-01T00:05:00Z',
          ),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      expect(
        find.byKey(const ValueKey('conversation-activity-panel')),
        findsNothing,
      );
      // A request older than loaded history must not become a tail card.
      expect(
        find.byKey(const ValueKey('conversation-approval-expired')),
        findsNothing,
      );
      expect(controller.pendingApprovalCount, 0);
    },
  );

  testWidgets('RTL approval isolates cwd and renders commands LTR', (
    tester,
  ) async {
    const cwd = '/workspace/مشروع';
    final controller = workbenchController(
      baseController: AppController(locale: const Locale('ar')),
      approvals: [
        _approvalWithAction(
          id: 'rtl',
          action: const {
            'type': 'command.execute',
            'display': 'npm run mobile:check -- --target=مرحبا',
            'cwd': cwd,
            'command_hash': 'sha256:rtl',
          },
        ),
      ],
    );
    addTearDown(controller.dispose);
    await pumpWorkbench(tester, controller);

    expect(
      Directionality.of(
        tester.element(find.byKey(const ValueKey('conversation-approval-rtl'))),
      ),
      TextDirection.rtl,
    );
    expect(
      tester
          .widget<SelectableText>(
            find.byKey(const ValueKey('conversation-approval-rtl-display')),
          )
          .textDirection,
      TextDirection.ltr,
    );
    await tester.tap(
      find.byKey(const ValueKey('conversation-approval-rtl-details-toggle')),
    );
    await tester.pump();
    expect(
      tester
          .widget<Text>(
            find.byKey(const ValueKey('conversation-approval-rtl-directory')),
          )
          .data,
      relayuneLocalizationsFor(
        const Locale('ar'),
      ).workbenchApprovalDirectory('\u2066$cwd\u2069'),
    );
  });

  test(
    '[MOB-NOT-015][flutter] notification actions allow one low-risk decision but never blind-approve high-risk work',
    () async {
      final api = _ApprovalCaptureApi();
      final controller = workbenchController(
        api: api,
        sessions: [relaySession(id: 'root')],
        approvals: [_approval(id: 'medium', sessionId: 'root')],
      )..relayKey = RelayKey.import(_testKey);
      addTearDown(controller.dispose);

      expect(
        await controller.decideApprovalFromNotification(
          'medium',
          RelayNotificationAction.approveOnce,
        ),
        isTrue,
      );
      final approved = await api.openCommand(0);
      expect(approved['payload']['decision'], 'approved');

      controller.approvals = [
        RelayApproval(
          id: 'high',
          sessionId: 'root',
          action: const {
            'type': 'command.execute',
            'display': 'dangerous command',
            'command_hash': 'sha256:high',
          },
          riskLevel: 'high',
          state: 'pending',
          requestedAt: DateTime.now().toUtc().toIso8601String(),
          expiresAt: DateTime.now()
              .add(const Duration(minutes: 5))
              .toUtc()
              .toIso8601String(),
        ),
      ];
      expect(
        await controller.decideApprovalFromNotification(
          'high',
          RelayNotificationAction.approveOnce,
        ),
        isFalse,
      );
      expect(api.commands, hasLength(1));
    },
  );
}

RelayApproval _approval({required String id, required String sessionId}) =>
    RelayApproval(
      id: id,
      sessionId: sessionId,
      action: const {
        'type': 'command.execute',
        'display': 'npm run mobile:check',
        'cwd': '/workspace/relayune',
        'command_hash': 'sha256:test',
      },
      riskLevel: 'medium',
      state: 'pending',
      requestedAt: DateTime.now().toUtc().toIso8601String(),
      expiresAt: DateTime.now()
          .add(const Duration(minutes: 5))
          .toUtc()
          .toIso8601String(),
    );

RelayApproval _approvalWithAction({
  required String id,
  required Map<String, dynamic> action,
  String riskLevel = 'medium',
}) => RelayApproval(
  id: id,
  sessionId: 'root',
  action: action,
  riskLevel: riskLevel,
  state: 'pending',
  requestedAt: DateTime.now().toUtc().toIso8601String(),
  expiresAt: DateTime.now()
      .add(const Duration(minutes: 5))
      .toUtc()
      .toIso8601String(),
);

// The drawer loads a project page independently of approval decisions.
class _ApprovalController extends AppController {
  _ApprovalController({super.api});

  // This widget fixture supplies its conversation messages up front. Navigation
  // must not start an unrelated real HTTP read with a 60-second deadline.
  @override
  Future<void> loadHistory(
    String sessionId, {
    bool earlier = false,
    bool silent = false,
    bool localOnly = false,
  }) async {}

  @override
  Future<Map<String, dynamic>> loadProjectSessionPage(
    RelaySession project,
    String? cursor,
  ) async => {
    'sessions': sessions.map((session) => {'id': session.id}).toList(),
    'next_cursor': null,
  };
}

class _ApprovalCaptureApi extends RelayApi {
  VoidCallback? onDecision;
  final List<String> commandTypes = [];
  final List<(RelayAad, SealedEnvelope)> commands = [];

  Future<Map<String, dynamic>> openCommand(int index) async {
    final key = RelayKey.import(_testKey);
    try {
      final command = commands[index];
      return await RelayCipher().openJson<Map<String, dynamic>>(
        key,
        command.$2,
        command.$1,
      );
    } finally {
      key.dispose();
    }
  }

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
    // Opening a conversation also reads history and discovers subtasks. Keep these
    // background reads separate from the decisions asserted by this fixture.
    if (commandType == 'session.read_agents' ||
        commandType == 'session.read_history') {
      return CommandResult(requestId: requestId, delivery: 'delivered');
    }
    commandTypes.add(commandType);
    commands.add((aad, envelope));
    if (commandType == 'approval.resolve') onDecision?.call();
    return CommandResult(requestId: requestId, delivery: 'delivered');
  }
}

const _testKey = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
