import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/ui/settings_page.dart';
import 'package:relayune_mobile/src/ui/theme.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets(
    'expanded subtask dock fits above keyboard with multiline draft',
    (tester) async {
      final controller = _layoutController();
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller, size: const Size(393, 740));
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      tester.view.viewInsets = const FakeViewPadding(bottom: 336);
      addTearDown(tester.view.resetViewInsets);
      await tester.enterText(
        find.byType(TextField).first,
        'first line\nsecond line\nthird line',
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(tester.takeException(), isNull);
      expect(
        tester.getRect(find.byType(TextField).first).bottom,
        lessThanOrEqualTo(740 - 336),
      );
    },
  );
  testWidgets(
    'native workbench keeps account identity and settings in the drawer',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);

      final theme = Theme.of(tester.element(find.byType(Scaffold).first));
      expect(theme.brightness, Brightness.dark);
      expect(theme.scaffoldBackgroundColor, const Color(0xFF0D0D0D));
      expect(theme.cardTheme.color, const Color(0xFF181818));
      expect(RelayTheme.green, const Color(0xFF7FD6A3));
      expect(
        find.byKey(const ValueKey('project-session-picker')),
        findsNothing,
      );
      expect(find.byType(NavigationBar), findsNothing);
      expect(
        tester
            .getSize(
              find
                  .ancestor(
                    of: find.byKey(const ValueKey('conversation-message-list')),
                    matching: find.byType(Align),
                  )
                  .first,
            )
            .height,
        // Short histories shrink to their content; measure the reading viewport.
        greaterThan(844 * .69),
      );
      expect(
        find.byKey(const ValueKey('workbench-brand-mark')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('workbench-project-name')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('workbench-session-name')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('workbench-online-status')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('account-menu-button')), findsNothing);

      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));

      expect(
        find.byKey(const ValueKey('drawer-account-panel')),
        findsOneWidget,
      );
      expect(find.text('owner@example.com'), findsOneWidget);
      expect(find.byKey(const ValueKey('drawer-account-label')), findsNothing);
      expect(
        find.byKey(const ValueKey('drawer-settings-entry')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('drawer-release-notes-entry')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('drawer-redemption-entry')),
        findsNothing,
      );
      expect(find.byKey(const ValueKey('drawer-referral-entry')), findsNothing);
      expect(find.byKey(const ValueKey('drawer-logout-entry')), findsNothing);
      expect(find.text('7 天试用 · 有效至 2026/9/7'), findsNothing);

      await tester.tap(find.byKey(const ValueKey('drawer-settings-entry')));
      await tester.pumpAndSettle();

      expect(find.byType(SettingsPage), findsOneWidget);
      expect(
        find.byKey(const ValueKey('settings-referral-entry')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('settings-redemption-entry')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('settings-release-notes-entry')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('settings-logout-entry')),
        findsOneWidget,
      );
      expect(controller.phase, AppPhase.ready);
    },
  );

  testWidgets(
    '[MOB-LAY-006][flutter] long project and session names fit the 320px context header at 1.3 text scale',
    (tester) async {
      final controller = workbenchController(
        sessions: [
          relaySession(
            project:
                'A deliberately long Relayune project name that must not displace status',
            name:
                'A very long active conversation title that remains readable without wrapping the app bar',
            cwd: '/workspace/a-very-long-relayune-project-path',
          ),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(
        tester,
        controller,
        size: const Size(320, 700),
        textScale: 1.3,
      );

      final project = tester.widget<Text>(
        find.byKey(const ValueKey('workbench-project-name')),
      );
      final session = tester.widget<Text>(
        find.byKey(const ValueKey('workbench-session-name')),
      );
      expect(project.maxLines, 1);
      expect(project.overflow, TextOverflow.ellipsis);
      expect(session.maxLines, 1);
      expect(session.overflow, TextOverflow.ellipsis);
      expect(
        find.byKey(const ValueKey('workbench-online-status')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('workbench-brand-mark')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-LAY-001][flutter] conversation and device settings have no overflow at 320 360 and 390 widths',
    (tester) async {
      for (final width in [320.0, 360.0, 390.0]) {
        final controller = _layoutController();
        addTearDown(controller.dispose);
        await pumpWorkbench(tester, controller, size: Size(width, 700));
        expect(
          tester.takeException(),
          isNull,
          reason: '$width px · conversation',
        );
        await openDeviceSettings(tester);
        expect(tester.takeException(), isNull, reason: '$width px · device');
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      }
    },
  );

  testWidgets(
    '[MOB-LAY-002][flutter] pages remain usable at 320px with 1.3 text scale',
    (tester) async {
      final controller = _layoutController();
      addTearDown(controller.dispose);
      await pumpWorkbench(
        tester,
        controller,
        size: const Size(320, 700),
        textScale: 1.3,
      );

      expect(tester.takeException(), isNull, reason: '1.3× · conversation');
      await openDeviceSettings(tester);
      expect(tester.takeException(), isNull, reason: '1.3× · device');
      expect(find.byType(NavigationBar), findsNothing);
    },
  );

  testWidgets(
    '[MOB-LAY-003][flutter] composer and navigation respect keyboard and safe-area insets',
    (tester) async {
      tester.view.viewInsets = const FakeViewPadding(bottom: 280);
      tester.view.padding = const FakeViewPadding(bottom: 24);
      addTearDown(tester.view.resetViewInsets);
      addTearDown(tester.view.resetPadding);
      final controller = _layoutController();
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.pump();

      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 240));

      final inputBottom = tester.getRect(find.byType(TextField).first).bottom;
      expect(inputBottom, lessThanOrEqualTo(844 - 280));
      expect(
        tester
            .getSize(find.byKey(const ValueKey('composer-agent-status-list')))
            .height,
        lessThanOrEqualTo((844 - 280) * .43 + 1),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-LAY-004][flutter] inline Agent rows preserve hierarchy progress semantics and 44px actions',
    (tester) async {
      final controller = _layoutController();
      addTearDown(controller.dispose);
      await pumpWorkbench(
        tester,
        controller,
        size: const Size(320, 700),
        textScale: 1.3,
      );

      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 240));

      final agentInk = find.byKey(
        const ValueKey('composer-agent-status-agent-agent-long'),
      );
      expect(tester.getSize(agentInk).height, greaterThanOrEqualTo(44));
      expect(find.text('委派'), findsNothing);
      expect(
        find.byKey(const ValueKey('agent-live-command-agent-long')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-AGT-007][flutter] long agent name task activity and summary fit at 320px and 1.3 text scale',
    (tester) async {
      final controller = _layoutController();
      addTearDown(controller.dispose);
      await pumpWorkbench(
        tester,
        controller,
        size: const Size(320, 700),
        textScale: 1.3,
      );

      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 240));
      final agentRow = find.byKey(
        const ValueKey('composer-agent-status-agent-agent-long'),
      );
      await tester.ensureVisible(agentRow);
      await tester.pump();
      await tester.tap(agentRow);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 240));

      expect(
        find.byKey(const ValueKey('composer-agent-detail-agent-long')),
        findsOneWidget,
      );
      expect(find.text(_longAgentName), findsWidgets);
      for (final label in tester.widgetList<Text>(find.text(_longAgentName))) {
        expect(label.overflow, TextOverflow.ellipsis);
        expect(label.maxLines, 1);
      }
      expect(find.text('最新结果'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.textContaining(_longActivity).first,
        100,
        scrollable: find
            .descendant(
              of: find.byKey(const ValueKey('composer-agent-detail-scroll')),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      expect(find.textContaining(_longActivity), findsWidgets);
      final detailScroll = find.byKey(
        const ValueKey('composer-agent-detail-scroll'),
      );
      await tester.drag(detailScroll, const Offset(0, 600));
      await tester.pump();
      expect(find.text('最新结果'), findsOneWidget);
      expect(find.text(_longSummary, findRichText: true), findsWidgets);
      expect(tester.takeException(), isNull);
    },
  );
}

const _longAgentName =
    'Researcher with an intentionally very long mobile display name';
const _longTask =
    'Audit every realtime state transition and compare the current project hierarchy across providers without losing the active root session.';
const _longActivity =
    'Inspecting a deeply nested worktree while preparing a detailed encrypted execution summary for the parent Agent.';
const _longSummary =
    'Completed a long multi-provider audit and preserved the final summary without allowing the card to grow beyond a useful mobile reading boundary.';

RelayAgent _longAgent() => const RelayAgent(
  id: 'agent-long',
  threadId: 'agent-thread',
  parentSessionId: 'root',
  name: _longAgentName,
  task: _longTask,
  status: 'running',
  progress: 67,
  activity: _longActivity,
  summary: _longSummary,
  updatedAt: '2026-08-10T10:01:00Z',
);

RelayAgent _completedAgent() => const RelayAgent(
  id: 'agent-complete',
  threadId: 'agent-complete-thread',
  parentSessionId: 'root',
  name: 'Completed reviewer',
  task: 'Review the final mobile layout.',
  status: 'completed',
  progress: 100,
  summary: _longSummary,
  updatedAt: '2026-08-10T10:00:00Z',
);

AppController _layoutController() =>
    workbenchController(agents: [_longAgent(), _completedAgent()]);
