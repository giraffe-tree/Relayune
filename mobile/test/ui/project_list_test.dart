import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/device_connection.dart';
import 'package:relayune_mobile/src/state/session_projects.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';
import 'package:relayune_mobile/src/ui/workbench_screen.dart';

void main() {
  test(
    '[MOB-PRJ-001][flutter] canonical paths group root sessions without including subagents',
    () {
      final sessions = [
        _session(
          'a',
          cwd: '/work/relayune/',
          updatedAt: '2026-08-10T08:00:00Z',
        ),
        _session(
          'b',
          cwd: '/work/./relayune',
          updatedAt: '2026-08-10T09:00:00Z',
        ),
        _session(
          'child',
          cwd: '/work/relayune',
          isSubagent: true,
          rootSessionId: 'a',
        ),
        _session('other', cwd: '/work/other'),
      ];

      final groups = groupRootSessionsByProject(sessions);

      expect(groups, hasLength(2));
      expect(groups.first.sessions.map((item) => item.id), ['b', 'a']);
      expect(
        groups.expand((group) => group.sessions),
        isNot(contains(sessions[2])),
      );
      expect(canonicalProjectPath(r'C:\work\relayune\..\app\'), 'c:/work/app');
    },
  );

  test(
    '[MOB-PRJ-002][flutter] provider metadata stays attached to roots and child threads stay isolated',
    () {
      final codex = _session('codex', cwd: '/work/app');
      final kimi = RelaySession.fromJson({
        ..._session('kimi', cwd: '/work/app').raw,
        'provider': 'kimi',
      });
      final claude = RelaySession.fromJson({
        ..._session('claude', cwd: '/work/app').raw,
        'provider': 'claude',
      });
      final cowork = RelaySession.fromJson({
        ..._session('cowork', cwd: '/work/app').raw,
        'provider': 'claude-cowork',
      });
      final child = _session(
        'child',
        cwd: '/work/app',
        isSubagent: true,
        rootSessionId: codex.id,
      );

      final visible = groupRootSessionsByProject([
        codex,
        kimi,
        claude,
        cowork,
        child,
      ]).expand((group) => group.sessions).toList();

      expect(
        visible.map((session) => session.id),
        containsAll(['codex', 'kimi', 'claude', 'cowork']),
      );
      expect(
        visible.map((session) => session.provider),
        containsAll(['codex', 'kimi', 'claude', 'claude-cowork']),
      );
      expect(visible.map((session) => session.id), isNot(contains('child')));
    },
  );

  test(
    '[MOB-PRJ-017][flutter] each provider owns a distinct project catalog and saved projects need no session',
    () {
      final codex = _session('codex', cwd: '/work/relayune');
      final kimi = _session('kimi', cwd: '/work/other', provider: 'kimi');

      final claudeGroups = groupProviderSessionsByKnownProject([
        codex,
        kimi,
      ], 'claude');
      expect(claudeGroups, isEmpty);

      final codexGroups = groupProviderSessionsByKnownProject(
        [codex, kimi],
        'codex',
        projects: const [
          RelayProject(
            id: '3d-galaxy',
            name: '3d-galaxy',
            cwd: '/work/3d-galaxy',
            updatedAt: '2026-09-02T08:00:00.000Z',
            provider: 'codex',
          ),
        ],
      );
      expect(codexGroups.map((group) => group.path), [
        '/work/3d-galaxy',
        '/work/relayune',
      ]);
      final saved = codexGroups.first;
      expect(saved.sessions, isEmpty);
      expect(saved.projectSession.provider, 'codex');
      expect(saved.projectSession.cwd, '/work/3d-galaxy');
    },
  );

  test(
    '[MOB-PRJ-003][flutter] project and session ordering stays deterministic with invalid dates',
    () {
      final input = [
        _session('z', name: 'Zed', cwd: '/work/b', updatedAt: 'invalid'),
        _session('b', name: 'Beta', cwd: '/work/a', updatedAt: 'invalid'),
        _session('a', name: 'Alpha', cwd: '/work/a', updatedAt: ''),
      ];
      List<String> snapshot(List<RelaySession> sessions) =>
          groupRootSessionsByProject(sessions)
              .expand(
                (group) => [
                  group.key,
                  ...group.sessions.map((item) => item.id),
                ],
              )
              .toList();

      expect(snapshot(input), snapshot(input.reversed.toList()));
      expect(snapshot(input), ['path:/work/a', 'a', 'b', 'path:/work/b', 'z']);
    },
  );

  test(
    '[MOB-PRJ-004][flutter] catalog replacement preserves a valid active project and session',
    () {
      final controller = AppController()
        ..sessions = [
          _session('a', cwd: '/work/a'),
          _session('b', cwd: '/work/b'),
        ]
        ..activeSessionId = 'b';
      addTearDown(controller.dispose);

      controller.replaceSessionsForTesting([
        _session('new', cwd: '/work/new', updatedAt: '2026-08-10T10:00:00Z'),
        _session('b', cwd: '/work/b', updatedAt: '2026-08-10T09:00:00Z'),
      ]);

      expect(controller.activeSessionId, 'b');
      expect(controller.activeRootSession?.id, 'b');
    },
  );

  testWidgets(
    '[MOB-PRJ-005][flutter] empty duplicate and long project paths remain usable at 320px',
    (tester) async {
      await _pumpWorkbench(tester);

      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      expect(
        Directionality.of(tester.element(find.text('owner@example.com'))),
        TextDirection.ltr,
      );
      await tester.tap(
        find.byKey(
          const ValueKey('project-group-title-path:/workspace/client/relayune'),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(
        find.byKey(const ValueKey('workbench-section-home')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('workbench-section-conversation')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('workbench-section-device')),
        findsNothing,
      );
      expect(find.text('/workspace/client/relayune'), findsNothing);
      expect(
        find.text(
          '/workspace/server/a-very-long-relayune-worktree-name-for-mobile',
        ),
        findsNothing,
      );
      expect(find.byTooltip('配置信息'), findsNothing);
      expect(find.byTooltip('项目配置'), findsOneWidget);
      expect(find.text('新会话'), findsOneWidget);
      expect(
        find.byKey(
          const ValueKey(
            'project-create-session-path:/workspace/client/relayune',
          ),
        ),
        findsOneWidget,
      );
      const projectKey = 'path:/workspace/client/relayune';
      final configurationTouch = tester.getSize(
        find.byKey(const ValueKey('project-configuration-$projectKey')),
      );
      final configurationVisual = tester.getSize(
        find.byKey(const ValueKey('project-configuration-visual-$projectKey')),
      );
      final createTouch = tester.getSize(
        find.byKey(const ValueKey('project-create-session-$projectKey')),
      );
      final createVisual = tester.getSize(
        find.byKey(const ValueKey('project-create-session-visual-$projectKey')),
      );
      expect(configurationTouch, const Size(44, 44));
      expect(configurationVisual, const Size(34, 34));
      expect(createTouch.height, 44);
      expect(createVisual.height, 34);
      expect(configurationTouch.width + createTouch.width, lessThan(160));
      expect(find.text('Child agent'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-PRJ-006][flutter] opening a large drawer does no collapsed session work',
    (tester) async {
      final controller = _CountingDrawerController();
      await _pumpWorkbench(
        tester,
        controller: controller,
        sessions: [
          for (var project = 0; project < 100; project++)
            for (var session = 0; session < 20; session++)
              _session(
                '$project-$session',
                name: 'Session $project-$session',
                cwd: '/work/project-${project.toString().padLeft(3, '0')}',
                updatedAt: '2026-08-10T10:00:00Z',
              ),
        ],
      );
      controller.statusReads = 0;
      final watch = Stopwatch()..start();
      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      watch.stop();
      // Structural assertion avoids a flaky wall-clock threshold in CI.
      debugPrint(
        'Large drawer: ${watch.elapsedMilliseconds} ms, '
        '${controller.statusReads} session status reads',
      );
      expect(controller.statusReads, 0);
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget.key is ValueKey<String> &&
              (widget.key! as ValueKey<String>).value.startsWith(
                'drawer-session-',
              ),
          skipOffstage: false,
        ),
        findsNothing,
      );
      await tester.tap(
        find.byKey(
          const ValueKey('project-group-title-path:/work/project-000'),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      // Five cached tiles render immediately, then the same page refreshes.
      expect(controller.statusReads, inInclusiveRange(5, 10));
      expect(find.byKey(const ValueKey('drawer-session-0-0')), findsOneWidget);
      final projectTitle = find.byKey(
        const ValueKey('project-group-title-path:/work/project-000'),
      );
      final projectScroll = tester.state<ScrollableState>(
        find
            .ancestor(of: projectTitle, matching: find.byType(Scrollable))
            .first,
      );
      projectScroll.position.jumpTo(projectScroll.position.maxScrollExtent);
      await tester.pump();
      expect(projectTitle, findsNothing);
      projectScroll.position.jumpTo(0);
      await tester.pump();
      expect(find.byKey(const ValueKey('drawer-session-0-0')), findsOneWidget);

      // A new project sorts ahead of the expanded card during a live refresh.
      controller.replaceSessionsForTesting([
        _session('newest', cwd: '/work/new', updatedAt: '2026-09-01T10:00:00Z'),
        ...controller.sessions,
      ]);
      await tester.pump();
      expect(find.byKey(const ValueKey('drawer-session-0-0')), findsOneWidget);
      expect(find.byKey(const ValueKey('drawer-session-newest')), findsNothing);

      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-PRJ-009][flutter] project configuration reveals the full path and updates the local display name',
    (tester) async {
      await _pumpWorkbench(tester);

      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      await tester.tap(
        find.byKey(
          const ValueKey('project-group-title-path:/workspace/client/relayune'),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      await tester.tap(
        find.byKey(
          const ValueKey(
            'project-configuration-path:/workspace/client/relayune',
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));

      expect(find.text('项目配置信息'), findsOneWidget);
      expect(find.text('/workspace/client/relayune'), findsOneWidget);
      expect(
        tester
            .widget<SelectableText>(
              find.descendant(
                of: find.byKey(const ValueKey('project-full-path')),
                matching: find.byType(SelectableText),
              ),
            )
            .textDirection,
        TextDirection.ltr,
      );
      expect(find.textContaining('仅修改本 App 中显示的名称'), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('project-display-name-field')),
        '移动端项目',
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('project-display-name-save')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      await tester.pump();

      expect(
        find.descendant(of: find.byType(Drawer), matching: find.text('移动端项目')),
        findsOneWidget,
      );
      expect(find.text('/workspace/client/relayune'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  test(
    '[MOB-PRJ-010][flutter] project display names persist only within the current device authorization scope',
    () async {
      final store = _CapturingSecureStore();
      final controller = AppController(secureStore: store)
        ..sessions = [_session('a', cwd: '/work/app')];
      addTearDown(controller.dispose);
      controller.restoreProjectAliasesForTesting(
        const StoredCredentials(deviceId: 'mac-1', browserId: 'ios-1'),
      );

      await controller.renameProject(controller.projectGroups.single, '客户项目');

      expect(controller.projectGroups.single.title, '客户项目');
      expect(store.aliases.values, contains('客户项目'));
      final restored = AppController(secureStore: store)
        ..sessions = [_session('b', cwd: '/work/app')];
      addTearDown(restored.dispose);
      restored.restoreProjectAliasesForTesting(
        StoredCredentials(
          deviceId: 'mac-1',
          browserId: 'ios-1',
          projectAliases: store.aliases,
        ),
      );
      expect(restored.projectGroups.single.title, '客户项目');

      final otherAuthorization = AppController(secureStore: store)
        ..sessions = [_session('c', cwd: '/work/app')];
      addTearDown(otherAuthorization.dispose);
      otherAuthorization.restoreProjectAliasesForTesting(
        StoredCredentials(
          deviceId: 'mac-1',
          browserId: 'ios-2',
          projectAliases: store.aliases,
        ),
      );
      expect(otherAuthorization.projectGroups.single.title, 'Relayune');
    },
  );

  testWidgets(
    '[MOB-PRJ-006][flutter] projects stay collapsed across catalog refresh until tapped',
    (tester) async {
      final controller = AppController();
      await _pumpWorkbench(tester, controller: controller);

      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));

      expect(
        find.descendant(
          of: find.byType(Drawer),
          matching: find.text('Active session'),
        ),
        findsNothing,
      );

      controller.replaceSessionsForTesting([...controller.sessions]);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));

      expect(
        find.descendant(
          of: find.byType(Drawer),
          matching: find.text('Active session'),
        ),
        findsNothing,
      );
      await tester.tap(
        find.byKey(
          const ValueKey('project-group-title-path:/workspace/client/relayune'),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(
        find.descendant(
          of: find.byType(Drawer),
          matching: find.text('Active session'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('drawer-session-idle-icon-active')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('drawer-agent-rail')), findsOneWidget);
      expect(find.text('Codex'), findsNWidgets(2));
      for (final label in ['Codex', 'Kimi', 'Claude Code']) {
        expect(
          find.descendant(
            of: find.byKey(const ValueKey('drawer-agent-rail')),
            matching: find.text(label),
          ),
          findsOneWidget,
        );
      }
      expect(find.byTooltip('Kimi Code'), findsOneWidget);
      expect(find.byTooltip('Claude Code'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('drawer-agent-kimi')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      expect(find.byType(Drawer), findsOneWidget);
      expect(find.text('Kimi Code'), findsOneWidget);
      expect(tester.takeException(), isNull);
      expect(find.byIcon(Icons.terminal), findsNothing);
      expect(find.byIcon(Icons.auto_awesome_outlined), findsNothing);
      expect(find.text('Child agent'), findsNothing);
    },
  );

  testWidgets(
    '[MOB-PRJ-007][flutter] new sessions open directly without asking for a name',
    (tester) async {
      final controller = _RecordingAppController();
      await _pumpWorkbench(tester, controller: controller);

      expect(find.byTooltip('新建会话'), findsNothing);
      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      await tester.tap(
        find.byKey(
          const ValueKey('project-group-title-path:/workspace/client/relayune'),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      await tester.tap(
        find.byKey(
          const ValueKey(
            'project-create-session-path:/workspace/client/relayune',
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));

      expect(controller.createdName, AppController.defaultSessionName);
      expect(controller.createdProvider, 'codex');
      expect(controller.createdProjectId, 'active');
      expect(find.text('会话名称'), findsNothing);
      expect(
        find.byKey(const ValueKey('create-session-name-field')),
        findsNothing,
      );
      expect(find.text('项目与会话'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-PRJ-011][flutter] a project action creates the session in that explicit project',
    (tester) async {
      final controller = _RecordingAppController();
      await _pumpWorkbench(tester, controller: controller);

      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      await tester.tap(
        find.byKey(
          const ValueKey(
            'project-group-title-path:/workspace/server/a-very-long-relayune-worktree-name-for-mobile',
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      await tester.tap(
        find.byKey(
          const ValueKey(
            'project-create-session-path:/workspace/server/a-very-long-relayune-worktree-name-for-mobile',
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));

      expect(controller.createdName, AppController.defaultSessionName);
      expect(controller.createdProvider, 'codex');
      expect(controller.createdProjectId, 'second');
      expect(
        find.byKey(const ValueKey('create-session-name-field')),
        findsNothing,
      );
      expect(find.text('项目与会话'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  test(
    '[MOB-PRJ-012][flutter] drawer session timestamps stay compact and deterministic',
    () {
      final iso = DateTime(2026, 8, 28, 9, 5).toUtc().toIso8601String();
      expect(
        formatSessionTimestamp(iso, now: DateTime(2026, 8, 28, 18, 30)),
        '09:05',
      );
      expect(
        formatSessionTimestamp(iso, now: DateTime(2026, 8, 27, 18, 30)),
        '08-28 09:05',
      );
      expect(
        formatSessionTimestamp(iso, now: DateTime(2025, 12, 31, 18, 30)),
        '2026-08-28',
      );
      expect(
        formatSessionTimestamp('not-a-date', now: DateTime(2026, 8, 28)),
        '',
      );
      expect(formatSessionTimestamp('', now: DateTime(2026, 8, 28)), '');
    },
  );

  testWidgets(
    '[MOB-PRJ-013][flutter] agent switcher gives each provider its own session list',
    (tester) async {
      await _pumpWorkbench(
        tester,
        sessions: [
          _session('codex-a', name: 'Codex 会话', cwd: '/work/app'),
          _session(
            'kimi-a',
            name: 'Kimi 会话',
            cwd: '/work/app',
            provider: 'kimi',
          ),
          _session(
            'claude-a',
            name: 'Claude 会话',
            cwd: '/work/app',
            provider: 'claude',
          ),
        ],
      );

      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));

      Finder drawerText(String value) =>
          find.descendant(of: find.byType(Drawer), matching: find.text(value));

      await tester.tap(
        find.byKey(const ValueKey('project-group-title-path:/work/app')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(drawerText('Codex 会话'), findsOneWidget);
      expect(drawerText('Kimi 会话'), findsNothing);
      expect(drawerText('Claude 会话'), findsNothing);

      await tester.tap(find.byKey(const ValueKey('drawer-agent-kimi')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      expect(drawerText('Kimi 会话'), findsOneWidget);
      expect(drawerText('Codex 会话'), findsNothing);

      await tester.tap(find.byKey(const ValueKey('drawer-agent-claude')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      expect(drawerText('Claude 会话'), findsOneWidget);
      expect(drawerText('Kimi 会话'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-PRJ-017][flutter] a Codex saved project appears without a session and can create one',
    (tester) async {
      final controller = _RecordingAppController()
        ..projects = const [
          RelayProject(
            id: '3d-galaxy',
            name: '3d-galaxy',
            cwd: '/work/3d-galaxy',
            updatedAt: '2026-09-02T08:00:00.000Z',
            provider: 'codex',
          ),
        ];
      await _pumpWorkbench(
        tester,
        controller: controller,
        sessions: [_session('codex-root', cwd: '/work/app')],
      );

      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      expect(find.text('3d-galaxy'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('project-group-title-path:/work/3d-galaxy')),
      );
      await tester.pump(const Duration(milliseconds: 500));
      final create = find.byKey(
        const ValueKey('project-create-session-path:/work/3d-galaxy'),
      );
      tester.widget<TextButton>(create).onPressed!();
      await tester.pump();

      expect(controller.createdProjectId, 'project:codex:3d-galaxy');
      expect(controller.createdProvider, 'codex');
      expect(controller.createdName, AppController.defaultSessionName);
      expect(tester.takeException(), isNull);
    },
  );

  for (final provider in const ['Kimi', 'Claude']) {
    testWidgets(
      '[MOB-PRJ-018][flutter] $provider does not inherit Codex directories',
      (tester) async {
        final controller = AppController()
          ..projects = const [
            RelayProject(
              id: '3d-galaxy',
              name: '3d-galaxy',
              cwd: '/work/3d-galaxy',
              updatedAt: '2026-09-02T08:00:00.000Z',
              provider: 'codex',
            ),
          ];
        await _pumpWorkbench(
          tester,
          controller: controller,
          sessions: [_session('codex-root', cwd: '/work/app')],
        );

        await tester.tap(
          find.byKey(const ValueKey('workbench-navigation-button')),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 320));
        await tester.tap(
          find.byKey(ValueKey('drawer-agent-${provider.toLowerCase()}')),
        );
        await tester.pump();

        expect(find.text('3d-galaxy'), findsNothing);
        expect(
          find.byKey(const ValueKey('project-group-title-path:/work/app')),
          findsNothing,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    '[MOB-PRJ-014][flutter] project reveals five more compact sessions per expansion',
    (tester) async {
      final controller = _ProjectPagingController();
      await _pumpWorkbench(
        tester,
        controller: controller,
        size: const Size(360, 1180),
        sessions: [
          for (var index = 0; index < 12; index++)
            _session(
              's$index',
              name: '会话 $index',
              cwd: '/work/app',
              branch: 'feature/$index',
              updatedAt:
                  '2026-08-10T10:${index.toString().padLeft(2, '0')}:00Z',
            ),
        ],
      );

      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      await tester.tap(
        find.byKey(const ValueKey('project-group-title-path:/work/app')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(find.byKey(const ValueKey('drawer-session-s11')), findsOneWidget);
      expect(find.byKey(const ValueKey('drawer-session-s7')), findsOneWidget);
      expect(find.byKey(const ValueKey('drawer-session-s6')), findsNothing);
      expect(find.byKey(const ValueKey('drawer-session-s2')), findsNothing);
      expect(find.byKey(const ValueKey('drawer-session-s1')), findsNothing);
      expect(find.byKey(const ValueKey('drawer-session-s0')), findsNothing);

      final first = tester.getSize(
        find.byKey(const ValueKey('drawer-session-s11')),
      );
      final last = tester.getSize(
        find.byKey(const ValueKey('drawer-session-s7')),
      );
      expect(first, last);
      expect(first.height, lessThanOrEqualTo(57));

      expect(find.textContaining('feature/11'), findsOneWidget);
      final time = formatSessionTimestamp('2026-08-10T10:11:00Z');
      expect(time, isNotEmpty);
      expect(find.textContaining(time), findsOneWidget);

      final more = find.byKey(
        const ValueKey('project-more-sessions-path:/work/app'),
      );
      expect(more, findsOneWidget);
      expect(find.text('加载更多'), findsOneWidget);
      await tester.ensureVisible(more);
      await tester.pump();
      await tester.tap(more);
      await tester.pump();

      expect(find.byKey(const ValueKey('drawer-session-s6')), findsOneWidget);
      expect(find.byKey(const ValueKey('drawer-session-s2')), findsOneWidget);
      expect(find.byKey(const ValueKey('drawer-session-s1')), findsNothing);
      expect(find.byKey(const ValueKey('drawer-session-s0')), findsNothing);
      expect(more, findsOneWidget);
      expect(find.text('加载更多'), findsOneWidget);

      final title = find.byKey(
        const ValueKey('project-group-title-path:/work/app'),
      );
      await tester.ensureVisible(title);
      await tester.tap(title);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(
        find.byKey(const ValueKey('drawer-session-s2'), skipOffstage: false),
        findsNothing,
      );
      await tester.tap(title);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.byKey(const ValueKey('drawer-session-s2')), findsOneWidget);
      expect(find.byKey(const ValueKey('drawer-session-s1')), findsNothing);

      tester
          .state<ScaffoldState>(
            find.byKey(const ValueKey('workbench-scaffold')),
          )
          .closeDrawer();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      expect(find.byKey(const ValueKey('drawer-session-s2')), findsOneWidget);
      await tester.ensureVisible(more);
      await tester.pump();
      await tester.tap(more);
      await tester.pump();

      expect(find.byKey(const ValueKey('drawer-session-s0')), findsOneWidget);
      expect(find.byKey(const ValueKey('drawer-session-s1')), findsOneWidget);
      expect(more, findsNothing);
      controller.replaceSessionsForTesting([
        _session(
          'newly-created',
          cwd: '/work/app',
          updatedAt: '2026-09-17T10:00:00Z',
        ),
        ...controller.sessions,
      ]);
      await tester.pump();
      expect(
        find.byKey(const ValueKey('drawer-session-newly-created')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'opening and loading more only expand local cache without upstream calls',
    (tester) async {
      final controller = _SlowProjectController();
      await _pumpWorkbench(
        tester,
        controller: controller,
        size: const Size(390, 1180),
        sessions: [
          for (var i = 0; i < 12; i++)
            _session(
              'cached-$i',
              name: 'Cached $i',
              cwd: '/work/app',
              updatedAt: '2026-09-18T12:${i.toString().padLeft(2, '0')}:00Z',
            ),
        ],
      );
      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      await tester.tap(
        find.byKey(const ValueKey('project-group-title-path:/work/app')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      expect(
        find.byKey(const ValueKey('drawer-session-cached-11')),
        findsOneWidget,
      );
      final more = find.byKey(
        const ValueKey('project-more-sessions-path:/work/app'),
      );
      await tester.ensureVisible(more);
      await tester.tap(more);
      await tester.pump();
      expect(
        find.byKey(const ValueKey('drawer-session-cached-2')),
        findsOneWidget,
      );
      await tester.ensureVisible(more);
      await tester.tap(more);
      await tester.pump();
      expect(
        find.byKey(const ValueKey('drawer-session-cached-0')),
        findsOneWidget,
      );
      expect(more, findsNothing);
      expect(controller.requests, 0);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-PRJ-015][flutter] session SVG state follows live turn evidence and never title text',
    (tester) async {
      final misleadingIdle = _session(
        'misleading-idle',
        name: '[进行中] 仅标题写着运行',
        cwd: '/work/app',
        updatedAt: '2026-08-10T10:00:00Z',
        status: 'idle',
      );
      final actuallyRunning = _session(
        'actually-running',
        name: '[已完成] 实际 Agent 仍在运行',
        cwd: '/work/app',
        updatedAt: '2026-08-10T09:00:00Z',
        rootSessionId: 'stale-server-root-id',
        status: 'active',
      );
      final runningChild = _session(
        'running-child',
        name: 'Hidden running child',
        cwd: '/work/app',
        isSubagent: true,
        rootSessionId: actuallyRunning.id,
        status: 'active',
      );
      final controller = AppController();

      await _pumpWorkbench(
        tester,
        controller: controller,
        sessions: [misleadingIdle, actuallyRunning, runningChild],
        size: const Size(390, 844),
      );
      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));
      await tester.tap(
        find.byKey(const ValueKey('project-group-title-path:/work/app')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(
        find.byKey(const ValueKey('drawer-session-idle-icon-misleading-idle')),
        findsOneWidget,
      );
      expect(
        find.byKey(
          const ValueKey('drawer-session-idle-icon-actually-running'),
        ),
        findsOneWidget,
      );

      controller.applyEventForTesting(
        RelayEvent(
          cursor: 0,
          eventId: 'root-turn-started',
          sessionId: actuallyRunning.id,
          agentId: null,
          createdAt: '2026-08-10T10:01:00Z',
          event: const {'kind': 'turn.started', 'turn_id': 'root-turn'},
        ),
      );
      controller.activeSessionId = runningChild.id;
      controller.applyEventForTesting(
        RelayEvent(
          cursor: 1,
          eventId: 'live-message-delta',
          sessionId: runningChild.id,
          agentId: null,
          createdAt: '2026-08-10T10:01:00Z',
          event: const {
            'kind': 'message.delta',
            'turn_id': 'active-turn',
            'text': 'Working',
          },
        ),
      );
      controller.replaceSessionsForTesting([
        misleadingIdle,
        actuallyRunning,
        runningChild,
      ]);
      await tester.pump();

      expect(
        find.byKey(
          const ValueKey('drawer-session-running-icon-actually-running'),
        ),
        findsOneWidget,
      );
      expect(controller.runningSessions, {actuallyRunning.id, runningChild.id});
      expect(controller.sessionActivity(runningChild.id), '正在回复');
      expect(controller.sessionHasRunningAgent('misleading-idle'), isFalse);
      expect(controller.sessionHasRunningAgent('actually-running'), isTrue);
      expect(
        tester
            .getSize(find.byKey(const ValueKey('workbench-section-home')))
            .height,
        lessThanOrEqualTo(60),
      );
      expect(tester.getSize(find.byType(Drawer)).width, 360);
      expect(tester.takeException(), isNull);
    },
  );
}

Future<void> _pumpWorkbench(
  WidgetTester tester, {
  AppController? controller,
  List<RelaySession>? sessions,
  Size size = const Size(320, 700),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final root = _session(
    'active',
    name: 'Active session',
    cwd: '/workspace/client/relayune',
    updatedAt: '2026-08-10T10:00:00Z',
  );
  final second = _session(
    'second',
    name: 'Another session with a long descriptive name',
    cwd: '/workspace/server/a-very-long-relayune-worktree-name-for-mobile',
    updatedAt: '2026-08-10T09:00:00Z',
  );
  final child = _session(
    'child',
    name: 'Child agent',
    cwd: root.cwd,
    isSubagent: true,
    rootSessionId: root.id,
  );
  final catalog = sessions ?? [root, second, child];
  final workbenchController = (controller ?? _ProjectPagingController())
    ..phase = AppPhase.ready
    ..email = 'owner@example.com'
    ..bootstrap = const ServerBootstrap(
      email: 'owner@example.com',
      device: RelayDevice(
        id: 'device',
        name: 'Test Mac',
        online: true,
        agentConnected: true,
        lastSeenAt: '2026-08-10T10:00:00Z',
      ),
      catalog: null,
      events: [],
      cursor: 0,
      ackSequence: 0,
      queuedCommands: 0,
    )
    ..sessions = catalog
    ..activeSessionId = catalog
        .where((item) => !item.isSubagent)
        .firstOrNull
        ?.id
    ..connectionSnapshot = const DeviceConnectionSnapshot(
      online: true,
      lastSeenAt: '2026-08-10T10:00:00Z',
      revision: 1,
      transport: RealtimeTransportState.connected,
      realtimeConfirmed: true,
    );
  for (final session in catalog) {
    workbenchController.messages[session.id] = [];
  }
  addTearDown(workbenchController.dispose);
  await tester.pumpWidget(
    MaterialApp(
      home: AnimatedBuilder(
        animation: workbenchController,
        builder: (context, _) =>
            WorkbenchScreen(controller: workbenchController),
      ),
    ),
  );
}

RelaySession _session(
  String id, {
  String name = 'Session',
  String cwd = '',
  String updatedAt = '',
  String branch = 'main',
  String provider = 'codex',
  String status = 'idle',
  bool isSubagent = false,
  String? rootSessionId,
}) => RelaySession.fromJson({
  'id': id,
  'name': name,
  'project': 'Relayune',
  'branch': branch,
  'cwd': cwd,
  'status': status,
  'updated_at': updatedAt,
  'provider': provider,
  'is_subagent': isSubagent,
  'root_session_id': rootSessionId ?? id,
});

class _CapturingSecureStore extends SecureStore {
  Map<String, String> aliases = const {};

  @override
  Future<void> saveProjectAliases(Map<String, String> aliases) async {
    this.aliases = Map.unmodifiable(aliases);
  }
}

class _RecordingAppController extends AppController {
  String? createdName;
  String? createdProvider;
  String? createdProjectId;

  @override
  Future<void> createSessionInProject(
    RelaySession project,
    String name, {
    String? provider,
  }) async {
    createdProjectId = project.id;
    createdName = name;
    createdProvider = provider;
  }
}

class _CountingDrawerController extends _ProjectPagingController {
  int statusReads = 0;

  @override
  bool sessionHasRunningAgent(String sessionId) {
    statusReads++;
    return super.sessionHasRunningAgent(sessionId);
  }
}

class _ProjectPagingController extends AppController {
  @override
  Future<Map<String, dynamic>> loadProjectSessionPage(
    RelaySession project,
    String? cursor,
  ) async {
    final matching =
        sessions.where((s) => s.cwd == project.cwd && !s.isSubagent).toList()
          ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    final offset = int.tryParse(cursor ?? '') ?? 0;
    final end = (offset + 5).clamp(0, matching.length);
    return {
      'sessions': matching.sublist(offset, end).map((s) => s.raw).toList(),
      'next_cursor': end < matching.length ? '$end' : null,
    };
  }
}

class _SlowProjectController extends AppController {
  var response = Completer<Map<String, dynamic>>();
  int requests = 0;
  String? selected;
  @override
  Future<void> selectSession(
    String sessionId, {
    bool waitForHistory = true,
  }) async {
    selected = sessionId;
    activeSessionId = sessionId;
    notifyListeners();
  }

  @override
  Future<Map<String, dynamic>> projectRequest(
    String type,
    Map<String, dynamic> payload,
  ) {
    requests++;
    expect(payload['cursor'], isNull);
    return response.future;
  }
}
