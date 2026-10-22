import 'package:relayune_mobile/src/ui/workbench_home_page.dart';
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/device_connection.dart';
import 'package:relayune_mobile/src/ui/relayune_ready_screen.dart';
import 'package:relayune_mobile/src/ui/theme.dart';
import 'package:relayune_mobile/src/ui/workbench_screen.dart';
import 'package:relayune_mobile/src/widgets/device_connection_icon.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets(
    '[MOB-LAY-005][flutter] first recent-list load reserves five rows without reporting an empty list',
    (tester) async {
      final controller =
          workbenchController(
                baseController: _LoadingHomeController(),
                sessions: [],
              )
              as _LoadingHomeController;
      addTearDown(controller.dispose);
      await _pumpHome(tester, controller);
      expect(
        find.byKey(const ValueKey('home-recent-sessions-loading')),
        findsOneWidget,
      );
      for (var index = 0; index < 5; index++) {
        final row = find.byKey(
          ValueKey('home-recent-session-placeholder-$index'),
        );
        expect(row, findsOneWidget);
        expect(tester.getSize(row).height, greaterThanOrEqualTo(58));
      }
      expect(find.text('No other recent sessions'), findsNothing);
      final semantics = tester.ensureSemantics();
      await tester.pump();
      try {
        expect(
          find.bySemanticsLabel('Loading recent sessions'),
          findsOneWidget,
        );
      } finally {
        semantics.dispose();
      }
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('home-recent-sessions')),
          matching: find.byType(InkWell),
        ),
        findsNothing,
      );
      final reservedHeight = tester
          .getSize(find.byKey(const ValueKey('home-recent-sessions')))
          .height;
      controller
        ..sessions = [
          for (var index = 0; index < 7; index++)
            _homeSession(
              id: 'loaded-$index',
              name: 'Task $index',
              project: 'Fixture',
              updatedAt: DateTime.utc(2026, 10, 4, 0, index).toIso8601String(),
            ),
        ]
        ..loading = false
        ..notifyListeners();
      await tester.pump();
      expect(
        find.byKey(const ValueKey('home-recent-sessions-loading')),
        findsNothing,
      );
      for (var index = 2; index < 7; index++) {
        expect(
          find.byKey(ValueKey('home-recent-session-loaded-$index')),
          findsOneWidget,
        );
      }
      expect(
        find.byKey(const ValueKey('home-recent-session-loaded-1')),
        findsNothing,
      );
      final loadedHeight = tester
          .getSize(find.byKey(const ValueKey('home-recent-sessions')))
          .height;
      expect((reservedHeight - loadedHeight).abs(), lessThan(24));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('refresh keeps cached recent sessions visible and tappable', (
    tester,
  ) async {
    final controller = workbenchController(
      baseController: _LoadingHomeController(),
      sessions: [
        _homeSession(
          id: 'cached',
          name: 'Cached task',
          project: 'Fixture',
          updatedAt: '2026-10-03T10:00:00Z',
        ),
      ],
    );
    addTearDown(controller.dispose);
    await _pumpHome(tester, controller);
    final tile = tester.widget<InkWell>(
      find.byKey(const ValueKey('home-recent-session-cached')),
    );
    expect(tile.onTap, isNotNull);
    expect(
      find.byKey(const ValueKey('home-recent-sessions-loading')),
      findsNothing,
    );
    expect(find.text('No other recent sessions'), findsNothing);
  });

  testWidgets(
    'a completed empty list stops loading and shows its empty state',
    (tester) async {
      final controller =
          workbenchController(
                baseController: _LoadingHomeController(),
                sessions: [],
              )
              as _LoadingHomeController;
      addTearDown(controller.dispose);
      await _pumpHome(tester, controller, disableAnimations: false);
      controller
        ..loading = false
        ..notifyListeners();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('No other recent sessions'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('home-recent-sessions-loading')),
        findsNothing,
      );
    },
  );

  testWidgets('recent-list pulse stops when reduced motion is enabled', (
    tester,
  ) async {
    final controller = workbenchController(
      baseController: _LoadingHomeController(),
      sessions: [],
    );
    addTearDown(controller.dispose);
    final loading = find.byKey(const ValueKey('home-recent-sessions-loading'));
    double opacity() => tester.widget<FadeTransition>(loading).opacity.value;
    await _pumpHome(tester, controller, disableAnimations: false);
    final before = opacity();
    await tester.pump(const Duration(milliseconds: 400));
    expect(opacity(), isNot(closeTo(before, 0.01)));
    await _pumpHome(tester, controller, disableAnimations: true);
    await tester.pumpAndSettle();
    expect(opacity(), 1);
    await tester.pump(const Duration(seconds: 2));
    expect(opacity(), 1);
    expect(tester.binding.transientCallbackCount, 0);
    expect(find.text('No other recent sessions'), findsNothing);
  });

  for (final constraint in ['accessible navigation', 'hidden route']) {
    testWidgets('$constraint keeps the recent-list placeholders static', (
      tester,
    ) async {
      final controller = workbenchController(
        baseController: _LoadingHomeController(),
        sessions: [],
      );
      addTearDown(controller.dispose);
      await _pumpHome(
        tester,
        controller,
        disableAnimations: false,
        accessibleNavigation: constraint == 'accessible navigation',
        tickerEnabled: constraint != 'hidden route',
      );
      await tester.pump(const Duration(milliseconds: 400));
      final pulse = tester.widget<FadeTransition>(
        find.byKey(const ValueKey('home-recent-sessions-loading')),
      );
      expect(pulse.opacity.value, 1);
      await tester.pump(const Duration(seconds: 2));
      expect(pulse.opacity.value, 1);
    });
  }

  testWidgets('loading placeholders fit a narrow screen with large text', (
    tester,
  ) async {
    final controller = workbenchController(
      baseController: _LoadingHomeController(),
      sessions: [],
    );
    addTearDown(controller.dispose);
    await _pumpHome(
      tester,
      controller,
      size: const Size(320, 568),
      textScale: 2,
    );
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('home-recent-sessions-loading')),
      200,
      scrollable: find.descendant(
        of: find.byKey(const ValueKey('home-scroll-view')),
        matching: find.byType(Scrollable),
      ),
    );
    expect(
      find.byKey(const ValueKey('home-recent-sessions-loading')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'mark all read clears offscreen sessions and animates completion',
    (tester) async {
      final controller = workbenchController(
        sessions: [
          for (var i = 0; i < 8; i++)
            _homeSession(
              id: 'read-$i',
              name: 'Session $i',
              project: 'Test',
              updatedAt: '2026-09-02T11:00:00.000Z',
            ),
          _homeSession(
            id: 'running',
            name: 'Running',
            project: 'Test',
            status: 'active',
            updatedAt: '2026-09-02T12:00:00.000Z',
          ),
        ],
      );
      addTearDown(controller.dispose);
      await _pumpHome(tester, controller, disableAnimations: false);
      await tester.tap(find.byKey(const ValueKey('home-mark-all-read')));
      await tester.pump();
      expect(
        controller.sessions.any(controller.sessionHasUnopenedCompletion),
        isFalse,
      );
      final button = tester.widget<TextButton>(
        find.byKey(const ValueKey('home-mark-all-read')),
      );
      expect(button.onPressed, isNull);
      await tester.pump(const Duration(milliseconds: 150));
      expect(find.text('Mark all read'), findsOneWidget);
      expect(find.text('All caught up'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 250));
      expect(find.text('Mark all read'), findsNothing);
      expect(find.text('All caught up'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('home keeps session creation progress visible until failure', (
    tester,
  ) async {
    final controller = workbenchController(
      baseController: _CreatingHomeController(),
    );
    addTearDown(controller.dispose);
    controller.notice = 'Creating session…';
    await _pumpHome(tester, controller);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('Creating session…'), findsOneWidget);
    expect(find.byTooltip('Close'), findsNothing);
    (controller as _CreatingHomeController).creating = false;
    controller.error = 'Could not create session';
    controller.clearBanners();
    controller.error = 'Could not create session';
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Could not create session'), findsOneWidget);
  });

  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    testWidgets(
      'home opens a session in one frame with $platform animations enabled',
      (tester) async {
        final delayed = _DelayedSessionController();
        final controller = workbenchController(
          baseController: delayed,
          sessions: [
            _homeSession(
              id: 'instant',
              name: 'Open immediately',
              project: 'Relayune',
              updatedAt: DateTime.now().toUtc().toIso8601String(),
            ),
          ],
        );
        addTearDown(controller.dispose);
        await _pumpHome(
          tester,
          controller,
          platform: platform,
          disableAnimations: false,
        );
        await tester.tap(
          find.byKey(const ValueKey('home-recent-session-instant')),
        );
        await tester.pump();
        final route = ModalRoute.of(
          tester.element(find.byType(WorkbenchScreen, skipOffstage: false)),
        )!;
        expect(
          route.animation!.status,
          AnimationStatus.completed,
          reason:
              'Conversation entry must not wait for a platform page transition.',
        );
        expect(
          find.byKey(const ValueKey('history-loading-state')),
          findsOneWidget,
        );
        delayed.finishSelection();
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 16));
        await tester.tap(find.byKey(const ValueKey('workbench-home-button')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 16));
        expect(
          find.descendant(
            of: find.byType(RelayuneHomePage),
            matching: find.byType(Scaffold),
          ),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    '[MOB-LAY-005][flutter] home uses the native palette without bottom navigation or prices',
    (tester) async {
      final controller = workbenchController(
        sessions: [
          _homeSession(
            id: 'active',
            name: 'Design the Relayune mobile home',
            project: 'relayune-mobile',
            status: 'active',
            updatedAt: DateTime.now().toUtc().toIso8601String(),
          ),
          _homeSession(
            id: 'recent',
            name: 'Fix desktop sign-in callback',
            project: 'codex-remote',
            updatedAt: DateTime.now()
                .subtract(const Duration(days: 1))
                .toUtc()
                .toIso8601String(),
          ),
          for (var index = 2; index < 6; index++)
            _homeSession(
              id: 'recent-$index',
              name: 'Recent task $index',
              project: 'codex-remote',
              updatedAt: DateTime.now()
                  .subtract(Duration(days: index))
                  .toUtc()
                  .toIso8601String(),
            ),
        ],
      );
      final now = DateTime.now();
      controller.replaceUsageByProviderForTesting({
        'codex': ProviderUsageSnapshot(
          asOf: now.toUtc().toIso8601String(),
          daily: [
            ProviderDailyUsage(date: _date(now), totalTokens: 1000000),
            ProviderDailyUsage(
              date: _date(now.subtract(const Duration(days: 6))),
              totalTokens: 2000000,
            ),
            ProviderDailyUsage(
              date: _date(now.subtract(const Duration(days: 20))),
              totalTokens: 3000000,
            ),
          ],
        ),
        'kimi': ProviderUsageSnapshot(
          asOf: now.toUtc().toIso8601String(),
          daily: [
            ProviderDailyUsage(date: _date(now), totalTokens: 4000000),
            ProviderDailyUsage(
              date: _date(now.subtract(const Duration(days: 6))),
              totalTokens: 1000000,
            ),
          ],
        ),
        'claude': ProviderUsageSnapshot(
          asOf: now.toUtc().toIso8601String(),
          daily: [
            ProviderDailyUsage(
              date: _date(now.subtract(const Duration(days: 20))),
              totalTokens: 6000000,
            ),
          ],
        ),
      });
      addTearDown(controller.dispose);

      await _pumpHome(tester, controller);

      expect(
        find.descendant(
          of: find.byType(RelayuneHomePage),
          matching: find.byType(Scaffold),
        ),
        findsOneWidget,
      );
      expect(
        find.ancestor(
          of: find.byKey(const ValueKey('home-greeting')),
          matching: find.byType(Row),
        ),
        findsNothing,
      );
      final connectionButton = find.byKey(const ValueKey('home-online-status'));
      expect(connectionButton, findsOneWidget);
      expect(find.text('Relay online'), findsNothing);
      final connectionIcon = tester.widget<DeviceConnectionIcon>(
        find.byKey(const ValueKey('home-device-status-svg')),
      );
      expect(connectionIcon.online, isTrue);
      expect(connectionIcon.transport, RealtimeTransportState.connected);
      expect(find.byIcon(Icons.computer_rounded), findsNothing);
      expect(
        find.byKey(const ValueKey('home-active-session-card')),
        findsNothing,
      );
      expect(find.byKey(const ValueKey('home-token-usage')), findsOneWidget);
      expect(find.byKey(const ValueKey('home-activity')), findsNothing);
      expect(find.byType(NavigationBar), findsNothing);
      expect(find.text('Token usage'), findsOneWidget);
      expect(find.text('3/3 local agents synced'), findsOneWidget);
      expect(find.text('5M'), findsOneWidget);
      expect(find.text('8M'), findsOneWidget);
      expect(find.text('17M'), findsOneWidget);
      final tokenSegments = find.descendant(
        of: find.byKey(const ValueKey('home-token-bars')),
        matching: find.byType(ColoredBox),
      );
      expect(tokenSegments, findsNWidgets(6));
      expect(
        tokenSegments.evaluate().every((element) {
          final size = (element.renderObject! as RenderBox).size;
          return size.width > 0 && size.height > 0;
        }),
        isTrue,
      );
      for (final provider in ['codex', 'kimi', 'claude']) {
        expect(
          find.byKey(ValueKey('home-token-provider-$provider')),
          findsOneWidget,
        );
      }
      expect(find.text('View all'), findsNothing);
      expect(find.byTooltip('Open navigation menu'), findsNothing);
      for (final id in [
        'active',
        'recent',
        'recent-2',
        'recent-3',
        'recent-4',
      ]) {
        expect(find.byKey(ValueKey('home-recent-session-$id')), findsOneWidget);
      }
      expect(
        find.byKey(const ValueKey('home-recent-session-recent-5')),
        findsNothing,
      );
      expect(find.textContaining(r'$'), findsNothing);
      expect(find.textContaining('¥'), findsNothing);
      expect(find.textContaining('￥'), findsNothing);
      expect(
        Theme.of(tester.element(find.byType(Scaffold))).scaffoldBackgroundColor,
        RelayTheme.background,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-DEV-006][flutter] home connection icon opens details and turns gray offline',
    (tester) async {
      final onlineController = workbenchController();
      addTearDown(onlineController.dispose);
      await _pumpHome(tester, onlineController);

      await tester.tap(find.byKey(const ValueKey('home-online-status')));
      await tester.pumpAndSettle();
      expect(find.byType(DevicePage), findsOneWidget);
      expect(find.text('Test Mac'), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();

      final offlineController = workbenchController(online: false);
      addTearDown(offlineController.dispose);
      await _pumpHome(tester, offlineController);
      final offlineIcon = tester.widget<DeviceConnectionIcon>(
        find.byKey(const ValueKey('home-device-status-svg')),
      );
      expect(offlineIcon.online, isFalse);
      expect(
        deviceConnectionVisualState(
          online: offlineIcon.online,
          transport: offlineIcon.transport,
        ),
        DeviceConnectionVisualState.offline,
      );
      expect(find.text('Relay offline'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-DEV-007][flutter] home connection SVG distinguishes reconnecting transport',
    (tester) async {
      final controller = workbenchController(
        online: true,
        transport: RealtimeTransportState.reconnecting,
      );
      addTearDown(controller.dispose);
      await _pumpHome(tester, controller);

      final icon = tester.widget<DeviceConnectionIcon>(
        find.byKey(const ValueKey('home-device-status-svg')),
      );
      expect(
        deviceConnectionVisualState(
          online: icon.online,
          transport: icon.transport,
        ),
        DeviceConnectionVisualState.reconnecting,
      );
      expect(find.byIcon(Icons.computer_rounded), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-LAY-005][flutter] token card distinguishes unavailable local agents from zero usage',
    (tester) async {
      final controller = workbenchController();
      final now = DateTime.now();
      controller.replaceUsageByProviderForTesting({
        'codex': ProviderUsageSnapshot(
          asOf: now.toUtc().toIso8601String(),
          daily: const [],
        ),
      });
      addTearDown(controller.dispose);

      await _pumpHome(tester, controller);

      expect(find.text('1/3 local agents synced'), findsOneWidget);
      expect(find.text('No data yet'), findsNWidgets(2));
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('home-token-provider-codex')),
          matching: find.text('0 · 30 days'),
        ),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('home-token-empty')), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-LAY-005][flutter] shared drawer opens by button, right swipe and left-edge gesture and returns home',
    (tester) async {
      final controller = workbenchController(
        sessions: [
          _homeSession(
            id: 'session',
            name: 'Drawer session',
            project: 'Relayune',
            updatedAt: DateTime.now().toUtc().toIso8601String(),
          ),
        ],
      );
      addTearDown(controller.dispose);

      await _pumpHome(tester, controller, platform: TargetPlatform.iOS);
      final navigationButton = find.byKey(
        const ValueKey('home-navigation-button'),
      );
      expect(
        find.descendant(
          of: navigationButton,
          matching: find.byIcon(Icons.menu_rounded),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: navigationButton,
          matching: find.byIcon(Icons.grid_view_rounded),
        ),
        findsNothing,
      );
      final appBar = tester.widget<AppBar>(find.byType(AppBar));
      expect(appBar.leading, isNotNull);
      expect(
        find.descendant(
          of: find.byWidget(appBar.leading!),
          matching: navigationButton,
        ),
        findsOneWidget,
      );
      final homeScaffold = tester.state<ScaffoldState>(
        find.descendant(
          of: find.byType(RelayuneHomePage),
          matching: find.byType(Scaffold),
        ),
      );
      await tester.tap(navigationButton);
      await tester.pumpAndSettle();
      expect(homeScaffold.isDrawerOpen, isTrue);
      expect(
        find.byKey(const ValueKey('workbench-section-home')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('drawer-home-divider')), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('workbench-section-home')),
          matching: find.byIcon(Icons.check_rounded),
        ),
        findsNothing,
      );

      await tester.tap(find.byKey(const ValueKey('workbench-section-home')));
      await tester.pumpAndSettle();
      expect(homeScaffold.isDrawerOpen, isFalse);

      await tester.dragFrom(const Offset(100, 300), const Offset(30, 0));
      await tester.pumpAndSettle();
      expect(homeScaffold.isDrawerOpen, isFalse);
      await tester.dragFrom(const Offset(320, 300), const Offset(0, -100));
      await tester.pumpAndSettle();
      expect(homeScaffold.isDrawerOpen, isFalse);

      await tester.dragFrom(const Offset(320, 300), const Offset(-180, 0));
      await tester.pumpAndSettle();
      expect(homeScaffold.isDrawerOpen, isFalse);
      await tester.dragFrom(const Offset(100, 300), const Offset(180, 0));
      await tester.pumpAndSettle();
      final swipeScaffold = tester.state<ScaffoldState>(
        find.descendant(
          of: find.byType(RelayuneHomePage),
          matching: find.byType(Scaffold),
        ),
      );
      expect(swipeScaffold.isDrawerOpen, isTrue);
      swipeScaffold.closeDrawer();
      await tester.pumpAndSettle();

      await tester.dragFrom(const Offset(5, 300), const Offset(300, 0));
      await tester.pumpAndSettle();
      expect(homeScaffold.isDrawerOpen, isTrue);
      expect(
        find.byKey(const ValueKey('workbench-section-conversation')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('workbench-section-device')),
        findsNothing,
      );
      await tester.tap(find.byKey(const ValueKey('workbench-section-home')));
      await tester.pumpAndSettle();
      expect(homeScaffold.isDrawerOpen, isFalse);
      expect(
        find.descendant(
          of: find.byType(RelayuneHomePage),
          matching: find.byType(Scaffold),
        ),
        findsOneWidget,
      );

      await tester.tap(
        find.byKey(const ValueKey('home-recent-session-session')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('workbench-context-header')),
        findsOneWidget,
      );

      await tester.dragFrom(const Offset(100, 300), const Offset(180, 0));
      await tester.pumpAndSettle();
      final sessionSwipeScaffold = tester.state<ScaffoldState>(
        find.byKey(const ValueKey('workbench-scaffold')),
      );
      expect(sessionSwipeScaffold.isDrawerOpen, isTrue);
      sessionSwipeScaffold.closeDrawer();
      await tester.pumpAndSettle();

      await tester.dragFrom(const Offset(5, 300), const Offset(300, 0));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('workbench-context-header')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('workbench-section-home')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-LAY-005][flutter] recent session opens the existing workbench and returns home',
    (tester) async {
      final controller = workbenchController(
        sessions: [
          _homeSession(
            id: 'active',
            name: 'Active task',
            project: 'Relayune',
            status: 'active',
            updatedAt: DateTime.now().toUtc().toIso8601String(),
          ),
          _homeSession(
            id: 'recent',
            name: 'Recent task',
            project: 'Relayune',
            updatedAt: DateTime.now()
                .subtract(const Duration(hours: 2))
                .toUtc()
                .toIso8601String(),
          ),
        ],
      );
      addTearDown(controller.dispose);

      await _pumpHome(tester, controller);
      final homeDeviceRect = tester.getRect(
        find.byKey(const ValueKey('home-online-status')),
      );
      await tester.tap(
        find.byKey(const ValueKey('home-recent-session-recent')),
      );
      await tester.pumpAndSettle();

      expect(controller.activeSessionId, 'recent');
      expect(
        find.byKey(const ValueKey('workbench-home-button')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byType(RelayuneHomePage),
          matching: find.byType(Scaffold),
        ),
        findsNothing,
      );
      final deviceRect = tester.getRect(
        find.byKey(const ValueKey('workbench-online-status')),
      );
      final homeRect = tester.getRect(
        find.byKey(const ValueKey('workbench-home-button')),
      );
      expect(deviceRect, homeDeviceRect);
      expect(homeRect.right, lessThanOrEqualTo(deviceRect.left));
      expect(find.byTooltip('返回主页'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('workbench-online-status')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('device-identity-card')),
        findsOneWidget,
      );
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(controller.activeSessionId, 'recent');

      await tester.tap(find.byKey(const ValueKey('workbench-home-button')));
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: find.byType(RelayuneHomePage),
          matching: find.byType(Scaffold),
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-LAY-008][flutter] recent sessions distinguish running SVG from unopened completion',
    (tester) async {
      final controller = workbenchController(
        sessions: [
          _homeSession(
            id: 'running',
            name: '[已完成] Catalog still says active',
            project: 'Relayune',
            status: 'active',
            updatedAt: '2026-09-02T12:00:00.000Z',
          ),
          _homeSession(
            id: 'finished',
            name: '[进行中] Catalog says idle',
            project: 'Relayune',
            updatedAt: '2026-09-02T11:00:00.000Z',
          ),
        ],
      );
      addTearDown(controller.dispose);

      await _pumpHome(tester, controller);

      expect(
        find.byKey(const ValueKey('home-session-running-icon-running')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('home-session-unread-dot-running')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('home-session-unread-dot-finished')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('home-session-running-icon-finished')),
        findsNothing,
      );

      await tester.tap(
        find.byKey(const ValueKey('home-recent-session-finished')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('workbench-home-button')));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('home-session-unread-dot-finished')),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-LAY-007][flutter] first session tap opens before history loading completes',
    (tester) async {
      final delayed = _DelayedSessionController();
      final controller = workbenchController(
        baseController: delayed,
        sessions: [
          _homeSession(
            id: 'active',
            name: 'Active task',
            project: 'Relayune',
            updatedAt: DateTime.now().toUtc().toIso8601String(),
          ),
          _homeSession(
            id: 'slow',
            name: 'History takes a round trip',
            project: 'Relayune',
            updatedAt: DateTime.now()
                .subtract(const Duration(hours: 1))
                .toUtc()
                .toIso8601String(),
          ),
        ],
      );
      addTearDown(controller.dispose);

      await _pumpHome(tester, controller);
      await tester.tap(find.byKey(const ValueKey('home-recent-session-slow')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));

      expect(controller.activeSessionId, 'slow');
      expect(
        find.descendant(
          of: find.byType(RelayuneHomePage),
          matching: find.byType(Scaffold),
        ),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('workbench-context-header')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('history-loading-state')),
        findsOneWidget,
      );

      delayed.finishSelection();
      await tester.pump();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-LAY-005][flutter] compact home remains scrollable at large text scale',
    (tester) async {
      final controller = workbenchController(
        sessions: [
          _homeSession(
            id: 'active',
            name: 'A long running session title for compact layout testing',
            project: 'relayune-mobile',
            status: 'active',
            updatedAt: DateTime.now().toUtc().toIso8601String(),
          ),
          _homeSession(
            id: 'recent',
            name: 'Another recent session with a deliberately long name',
            project: 'release-pipeline',
            updatedAt: DateTime.now()
                .subtract(const Duration(days: 2))
                .toUtc()
                .toIso8601String(),
          ),
        ],
      );
      addTearDown(controller.dispose);

      await _pumpHome(
        tester,
        controller,
        size: const Size(320, 568),
        textScale: 1.3,
      );
      for (var index = 0; index < 5; index++) {
        if (find
            .byKey(const ValueKey('home-token-usage'))
            .evaluate()
            .isNotEmpty) {
          break;
        }
        await tester.drag(
          find.byKey(const ValueKey('home-scroll-view')),
          const Offset(0, -400),
        );
        await tester.pumpAndSettle();
      }

      expect(find.byKey(const ValueKey('home-token-usage')), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
    },
  );

  testWidgets('project completion returns before opening the new workbench', (
    tester,
  ) async {
    final controller = workbenchController();
    addTearDown(controller.dispose);
    await _pumpHome(tester, controller);
    final navigator = Navigator.of(
      tester.element(find.byType(RelayuneReadyScreen)),
    );
    final completed = navigator.push<bool>(
      MaterialPageRoute<bool>(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Finish project'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    controller.requestWorkbenchTarget('conversation');
    await tester.pumpAndSettle();
    expect(
      find.text('Finish project'),
      findsOneWidget,
      reason:
          'Session creation must not cover the route that owns its completion.',
    );
    await tester.tap(find.text('Finish project'));
    await tester.pumpAndSettle();
    expect(await completed, isTrue);
    expect(find.byType(WorkbenchScreen), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    '[MOB-NOT-007][flutter] notification navigation leaves home for the requested conversation',
    (tester) async {
      final controller = workbenchController(
        sessions: [
          _homeSession(
            id: 'notified',
            name: 'Approval requested',
            project: 'Relayune',
            updatedAt: DateTime.now().toUtc().toIso8601String(),
          ),
        ],
      );
      addTearDown(controller.dispose);

      await _pumpHome(tester, controller);
      controller.requestWorkbenchTarget('conversation');
      await tester.pumpAndSettle();

      expect(
        find.descendant(
          of: find.byType(RelayuneHomePage),
          matching: find.byType(Scaffold),
        ),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('workbench-home-button')),
        findsOneWidget,
      );
      expect(controller.activeSessionId, 'notified');
    },
  );
}

RelaySession _homeSession({
  required String id,
  required String name,
  required String project,
  required String updatedAt,
  String status = 'idle',
}) => RelaySession.fromJson({
  'id': id,
  'name': name,
  'project': project,
  'branch': 'main',
  'cwd': '/workspace/$project',
  'status': status,
  'updated_at': updatedAt,
  'provider': 'codex',
  'is_subagent': false,
  'root_session_id': id,
});

String _date(DateTime value) =>
    '${value.year.toString().padLeft(4, '0')}-'
    '${value.month.toString().padLeft(2, '0')}-'
    '${value.day.toString().padLeft(2, '0')}';

class _DelayedSessionController extends AppController {
  final Completer<void> _selection = Completer<void>();

  @override
  Future<void> selectSession(
    String sessionId, {
    bool waitForHistory = true,
  }) async {
    await super.selectSession(sessionId, waitForHistory: waitForHistory);
    historyLoading.add(sessionId);
    notifyListeners();
    await _selection.future;
    historyLoading.remove(sessionId);
    notifyListeners();
  }

  void finishSelection() {
    if (!_selection.isCompleted) _selection.complete();
  }
}

Future<void> _pumpHome(
  WidgetTester tester,
  AppController controller, {
  Size size = const Size(390, 844),
  double textScale = 1,
  TargetPlatform platform = TargetPlatform.android,
  bool disableAnimations = true,
  bool accessibleNavigation = false,
  bool tickerEnabled = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      locale: const Locale('en'),
      theme: RelayTheme.web.copyWith(platform: platform),
      darkTheme: RelayTheme.web.copyWith(platform: platform),
      themeMode: ThemeMode.dark,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
          disableAnimations: disableAnimations,
          accessibleNavigation: accessibleNavigation,
        ),
        child: TickerMode(enabled: tickerEnabled, child: child!),
      ),
      home: AnimatedBuilder(
        animation: controller,
        builder: (context, _) => RelayuneReadyScreen(controller: controller),
      ),
    ),
  );
  await tester.pump();
}

class _CreatingHomeController extends AppController {
  bool creating = true;
  @override
  bool get sessionCreationInFlight => creating;
}

class _LoadingHomeController extends AppController {
  bool loading = true;
  @override
  bool get homeSessionsLoading => loading;
}
