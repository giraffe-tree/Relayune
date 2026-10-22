import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';
import 'package:relayune_mobile/src/ui/pairing_screen.dart';
import 'package:relayune_mobile/src/ui/theme.dart';
import 'package:relayune_mobile/src/network/realtime_client.dart';
import 'package:relayune_mobile/src/ui/workbench_screen.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets('connect another computer leaves nested routes even offline', (
    tester,
  ) async {
    final store = _DisconnectStore();
    final api = _OfflineApi()..sessionToken = 'test-account-session';
    final controller = workbenchController(
      baseController: AppController(api: api, secureStore: store),
    )..pendingPairingId = 'stale-pairing';
    api.browserToken = 'test-browser-token';
    addTearDown(controller.dispose);
    final navigator = await _pumpDisconnectJourney(tester, controller);
    await _openDisconnectConfirmation(tester);
    await tester.tap(find.text('取消'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(store.clears, 0);
    expect(controller.phase, AppPhase.ready);
    expect(api.browserToken, 'test-browser-token');

    await _openDisconnectConfirmation(tester);
    await tester.tap(find.text('继续'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(store.clears, 1);
    expect(api.bootstrapCalls, 0);
    expect(api.sessionToken, 'test-account-session');
    expect(api.browserToken, isNull);
    expect(controller.phase, AppPhase.needsPairing);
    expect(controller.bootstrap, isNull);
    expect(controller.pendingPairingId, isNull);
    expect(controller.sessions, isEmpty);
    expect(
      find.byKey(const ValueKey('scan-pairing-qr')).hitTestable(),
      findsOneWidget,
    );
    expect(find.byType(DevicePage), findsNothing);
    expect(navigator.currentState!.canPop(), isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('disconnect storage failure stays visible and allows retry', (
    tester,
  ) async {
    final store = _DisconnectStore()..gate = Completer<void>();
    final api = _OfflineApi()..browserToken = 'test-browser-token';
    final controller = workbenchController(
      baseController: AppController(api: api, secureStore: store),
    );
    addTearDown(controller.dispose);
    await _pumpDisconnectJourney(tester, controller);
    await _openDisconnectConfirmation(tester);
    await tester.tap(find.text('继续'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(
      tester
          .widget<ListTile>(
            find.byKey(const ValueKey('connect-another-computer')),
          )
          .onTap,
      isNull,
    );
    expect(store.clears, 1);
    store.gate!.completeError(StateError('local storage unavailable'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('操作失败，请重试。'), findsOneWidget);
    expect(controller.phase, AppPhase.ready);
    expect(api.browserToken, 'test-browser-token');
    expect(controller.sessions, isNotEmpty);
    expect(tester.takeException(), isNull);

    store.gate = null;
    await _openDisconnectConfirmation(tester);
    await tester.tap(find.text('继续'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(store.clears, 2);
    expect(find.byType(PairingScreen), findsOneWidget);
  });

  testWidgets('device page shows all agent versions and updates states', (
    tester,
  ) async {
    final controller = workbenchController();
    addTearDown(controller.dispose);
    controller.desktopInfo = RelayDesktopInfo.fromJson({
      'agents': [
        {'provider': 'opencode', 'version': '1.18.29', 'status': 'running'},
        {'provider': 'zcode', 'version': '0.16.5', 'status': 'ready'},
        {'provider': 'kimi', 'status': 'not_installed'},
        {'provider': 'future-agent', 'version': '2.0.0', 'status': 'future'},
      ],
    });
    await pumpWorkbench(tester, controller, disableAnimations: true);
    await openDeviceSettings(tester);
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('device-agent-zcode')),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('1.18.29'), findsOneWidget);
    expect(find.text('0.16.5'), findsOneWidget);
    expect(find.text('未安装'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('device-agent-claude-cowork')),
      findsOneWidget,
    );
    expect(find.text('future-agent'), findsOneWidget);
    controller.desktopInfo = const RelayDesktopInfo(
      agents: [
        RelayAgentRuntimeInfo(
          provider: 'zcode',
          version: '0.16.6',
          status: 'unavailable',
        ),
      ],
    );
    controller.replaceSessionsForTesting(controller.sessions);
    await tester.pump();
    expect(find.text('0.16.6'), findsOneWidget);
    expect(find.text('不可用'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('offline agent information is marked as last reported', (
    tester,
  ) async {
    final controller = workbenchController(online: false);
    addTearDown(controller.dispose);
    await pumpWorkbench(tester, controller, disableAnimations: true);
    await openDeviceSettings(tester);
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('device-agents-card')),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('电脑离线 · 显示上次检测结果'), findsOneWidget);
    expect(find.text('已接入'), findsNothing);
  });

  testWidgets(
    '[MOB-DEV-005][flutter] desktop version updates on the open device page',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller, disableAnimations: true);
      await openDeviceSettings(tester);
      expect(find.text('Relayune Desktop · 版本未知'), findsOneWidget);

      controller.desktopInfo = const RelayDesktopInfo(
        version: '0.3.18',
        platform: 'darwin',
      );
      // Catalog refreshes notify the controller even when connection metrics
      // remain unchanged; the already-open route must show the new version.
      controller.replaceSessionsForTesting(controller.sessions);
      await tester.pump();
      expect(find.text('Relayune Desktop (macOS) · 0.3.18'), findsOneWidget);
      expect(find.text('Relayune Desktop · 版本未知'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-DEV-001][flutter] device settings expose no refresh button tooltip or gesture',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller, disableAnimations: true);

      await openDeviceSettings(tester);

      expect(find.byIcon(Icons.refresh), findsNothing);
      expect(find.byTooltip('刷新'), findsNothing);
    },
  );

  testWidgets(
    '[MOB-DEV-004][flutter] device page reports the realtime channel without claiming HTTPS polling',
    (tester) async {
      final controller = workbenchController(revision: 7);
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller, disableAnimations: true);

      await openDeviceSettings(tester);

      expect(find.textContaining('HTTPS polling'), findsNothing);
      expect(find.text('WebSocket 已连接'), findsNothing);
      expect(
        find.byKey(const ValueKey('device-connection-topology')),
        findsOneWidget,
      );
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('device-technical-details-card')),
        200,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('状态版本'), findsOneWidget);
      expect(find.text('7'), findsOneWidget);
    },
  );

  testWidgets(
    '[MOB-DEV-008][flutter] device page separates WebSocket and computer heartbeats',
    (tester) async {
      final controller = workbenchController(
        websocketHeartbeatAt: DateTime.now()
            .subtract(const Duration(seconds: 5))
            .toUtc()
            .toIso8601String(),
        websocketRoundTripMs: 24,
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller, disableAnimations: true);

      await openDeviceSettings(tester);

      expect(find.byKey(const ValueKey('device-route-card')), findsOneWidget);
      expect(find.text('实时连接'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('device-realtime-health-card')),
        findsNothing,
      );
      expect(find.byKey(const ValueKey('device-route-settings')), findsNothing);
      expect(find.textContaining('无需等 2 秒'), findsNothing);
      expect(find.textContaining('延迟来自加密探测'), findsNothing);
      expect(find.text('iPhone ↔ Server · WebSocket'), findsNothing);
      expect(find.text('心跳正常'), findsNothing);
      expect(find.text('上次心跳'), findsNothing);
      expect(find.text('心跳 · 刚刚'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('device-connection-topology')),
        findsOneWidget,
      );
      expect(find.text('24 ms'), findsOneWidget);
      expect(find.text('Desktop Relay'), findsNothing);
      expect(find.text('电脑心跳'), findsNothing);
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('device-technical-details-card')),
        200,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('技术详情'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('device diagnostics update without a whole-app notification', (
    tester,
  ) async {
    final controller = workbenchController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(home: DevicePage(controller: controller)),
    );
    await tester.pump();
    expect(find.text('18 ms'), findsNothing);

    await controller.applyRealtimeSignalForTesting(
      RealtimeSignal.fromJson(const {
        'type': 'heartbeat',
        'device_id': 'device',
        'server_time': '2026-09-03T08:01:00.000Z',
        'round_trip_ms': 18,
      }),
    );
    await tester.pump();

    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('device-route-card')),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('18 ms'), findsOneWidget);
  });

  testWidgets('[MOB-DEV-005][flutter] device page shows package version', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = workbenchController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: child!,
        ),
        home: DevicePage(
          controller: controller,
          loadVersion: () async => '0.2.8+8',
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 100));

    await tester.scrollUntilVisible(
      find.text('Relayune Mobile 0.2.8+8'),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('Relayune Mobile 0.2.8+8'), findsOneWidget);
    expect(
      find.text('电脑端最低兼容版本：0.3.9 · https://relayune.giraffetree.cn'),
      findsOneWidget,
    );
    expect(find.textContaining('Mobile 1.0.0'), findsNothing);
  });
}

class _DisconnectStore extends SecureStore {
  int clears = 0;
  Completer<void>? gate;

  @override
  Future<void> clearPairing() async {
    clears++;
    await gate?.future;
  }
}

class _OfflineApi extends RelayApi {
  int bootstrapCalls = 0;

  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) async {
    bootstrapCalls++;
    throw StateError('network unavailable');
  }
}

Future<GlobalKey<NavigatorState>> _pumpDisconnectJourney(
  WidgetTester tester,
  AppController controller,
) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final navigator = GlobalKey<NavigatorState>();
  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: navigator,
      theme: RelayTheme.web,
      home: AnimatedBuilder(
        animation: controller,
        builder: (context, _) => controller.phase == AppPhase.needsPairing
            ? PairingScreen(
                controller: controller,
                loadVersion: () async => '0.3.21+31',
              )
            : WorkbenchScreen(controller: controller),
      ),
    ),
  );
  await tester.pump();
  await openDeviceSettings(tester);
  return navigator;
}

Future<void> _openDisconnectConfirmation(WidgetTester tester) async {
  final entry = find.byKey(const ValueKey('connect-another-computer'));
  await tester.scrollUntilVisible(
    entry,
    400,
    scrollable: find.byType(Scrollable).last,
  );
  await tester.tap(entry);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 350));
  expect(find.text('连接另一台电脑？'), findsOneWidget);
}
