import 'package:relayune_mobile/src/ui/computer_picker.dart';
import 'dart:async';
import 'dart:convert';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/ui/add_computer_route.dart';
import 'package:relayune_mobile/src/ui/pairing_screen.dart';
import 'package:relayune_mobile/src/ui/pairing_scanner_screen.dart';
import 'package:flutter/material.dart';
import 'package:relayune_mobile/src/ui/relayune_ready_screen.dart';
import 'package:relayune_mobile/src/ui/workbench_home_page.dart';
import 'package:relayune_mobile/src/ui/workbench_screen.dart';
import 'package:relayune_mobile/src/ui/theme.dart';
import 'package:relayune_mobile/src/state/device_connection.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/notifications/notification_coordinator.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/computer_connections.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';

class Gateway extends RelayNotificationGateway {
  @override
  Future<String?> initialize({
    required RelayNotificationResponseCallback onResponse,
  }) async => null;
  @override
  Future<bool> requestAuthorization() async => true;
  @override
  Future<bool?> authorizationEnabled() async => true;
  @override
  Future<void> openSettings() async {}
  @override
  Future<void> show(RelayLocalNotification notification) async {}
  @override
  Future<void> cancel(int notificationId) async {}
}

class Computer extends AppController {
  Computer(
    this.store,
    RelayEventNotificationSink sink,
    RelayNotificationManager manager,
    Locale locale,
  ) : super(
        secureStore: store,
        eventNotifications: sink,
        notificationManager: manager,
        locale: locale,
      );
  final SecureStore store;
  void publish() => notifyListeners();
  @override
  Future<void> selectSession(
    String sessionId, {
    bool waitForHistory = true,
  }) async {
    activeSessionId = sessionId;
    notifyListeners();
  }

  @override
  Future<void> initialize({
    Uri? initialLink,
    StoredCredentials? credentials,
  }) async {
    final saved = credentials ?? await store.read();
    api.sessionToken = saved.sessionToken;
    api.browserToken = saved.browserToken;
    email = 'owner@example.com';
    if (saved.hasPairing) {
      browserAuthorizationId = saved.browserId;
      relayKey = RelayKey.import(saved.contentKey!);
      bootstrap = ServerBootstrap(
        email: email,
        device: RelayDevice(
          id: saved.deviceId!,
          name: 'Computer ${saved.deviceId}',
          online: true,
          agentConnected: true,
          lastSeenAt: null,
        ),
        catalog: null,
        events: const [],
        cursor: 0,
        ackSequence: 0,
        queuedCommands: 0,
      );
      sessions = [
        RelaySession.fromJson({
          'id': 'same-id',
          'name': 'Task',
          'project': 'Same repo',
          'provider': 'codex',
          'cwd': '/repo',
          'updated_at': '2026-09-27T00:00:00Z',
        }),
      ];
      messages['same-id'] = [];
      markHistoryLoadedForTesting('same-id');
      connectionSnapshot = const DeviceConnectionSnapshot(
        online: true,
        lastSeenAt: null,
        revision: 1,
        transport: RealtimeTransportState.connected,
        realtimeConfirmed: true,
      );
      phase = AppPhase.ready;
    } else {
      phase = AppPhase.needsPairing;
    }
    notifyListeners();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late SecureStore store;
  PreparationApi? preparationApi;
  late ComputerConnections connections;
  late RelayNotificationCoordinator notifications;
  Future<void> pair(SecureStore s, String device, String auth) => s.savePairing(
    contentKey: base64Url.encode(List.filled(32, 7)).replaceAll('=', ''),
    deviceId: device,
    browserId: auth,
    browserToken: 'token-$auth',
  );
  setUp(() async {
    preparationApi = null;
    FlutterSecureStorage.setMockInitialValues({});
    store = SecureStore();
    await store.saveSession('account-token');
    await pair(store, 'a', 'auth-a');
    await pair(store.forComputer('second'), 'b', 'auth-b');
    await store.rememberComputer('owner@example.com', 'second');
    notifications = RelayNotificationCoordinator(gateway: Gateway());
    connections = ComputerConnections(
      store: store,
      notifications: notifications,
      controllerFactory: (store, sink, manager, locale) =>
          preparationApi == null
          ? Computer(store, sink, manager, locale)
          : AppController(
              api: preparationApi,
              secureStore: store,
              eventNotifications: sink,
              notificationManager: manager,
              locale: locale,
            ),
    );
    await connections.initialize();
    await connections.restored;
  });
  tearDown(() {
    connections.dispose();
    notifications.dispose();
  });
  test(
    'deletion from another computer delegates to the account controller',
    () async {
      String? received;
      connections.account.deleteAccountForAccount = (password) async {
        received = password;
      };
      await connections.computers.last.deleteAccount('password');
      expect(received, 'password');
      final adding = await connections.beginAdding(initialize: false);
      await adding.deleteAccount('second-password');
      expect(received, 'second-password');
    },
  );
  Future<
    ({GlobalKey<NavigatorState> navigator, Future<void> Function() closed})
  >
  openAddition(WidgetTester tester) async {
    await tester.runAsync(() => connections.remove(connections.computers.last));
    final navigator = GlobalKey<NavigatorState>();
    Future<void>? pending;
    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: navigator,
        theme: RelayTheme.web,
        home: Scaffold(
          body: TextButton(
            onPressed: () {
              pending = showAddComputer(
                navigator: navigator.currentState!,
                connections: connections,
              );
            },
            child: const Text('Add computer'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Add computer'));
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    return (navigator: navigator, closed: () => pending!);
  }

  testWidgets(
    'adding from one computer opens scanner before slow network and preserves its connection',
    (tester) async {
      final api = preparationApi = PreparationApi();
      final route = await openAddition(tester);
      expect(api.identityCalls, 1);
      expect(api.gate.isCompleted, isFalse);
      expect(find.byType(PairingScannerScreen), findsOneWidget);
      expect(connections.computers.single.phase, AppPhase.ready);
      expect(connections.computers.single.api.browserToken, 'token-auth-a');
      api.gate.complete();
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.byType(PairingScannerScreen), findsOneWidget);
      route.navigator.currentState!.popUntil((r) => r.isFirst);
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.runAsync(route.closed);
      expect((await store.read()).deviceId, 'a');
      expect(await store.computerScopes('owner@example.com'), isEmpty);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'cancelling preparation ignores late network and allows another addition',
    (tester) async {
      final api = preparationApi = PreparationApi();
      final route = await openAddition(tester);
      route.navigator.currentState!.popUntil((r) => r.isFirst);
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.runAsync(route.closed);
      api.gate.complete();
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump();
      expect(api.pendingPairingCalls, 0);
      expect(connections.computers.single.phase, AppPhase.ready);
      expect(await store.computerScopes('owner@example.com'), isEmpty);
      preparationApi = PreparationApi()..gate.complete();
      final second = showAddComputer(
        navigator: route.navigator.currentState!,
        connections: connections,
      );
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.byType(PairingScannerScreen), findsOneWidget);
      route.navigator.currentState!.popUntil((r) => r.isFirst);
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.runAsync(() => second);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'failed preparation can retry without disconnecting the first computer',
    (tester) async {
      final api = preparationApi = PreparationApi()..failFirst = true;
      final route = await openAddition(tester);
      expect(find.byType(PairingScannerScreen), findsOneWidget);
      route.navigator.currentState!.pop();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.byType(PairingScreen), findsOneWidget);
      api.gate.complete();
      final pairingPage = tester.widget<PairingScreen>(
        find.byType(PairingScreen),
      );
      unawaited(pairingPage.controller.initialize());
      await tester.pump();
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump();
      expect(api.identityCalls, 2);
      expect(connections.computers.single.api.browserToken, 'token-auth-a');
      route.navigator.currentState!.popUntil((r) => r.isFirst);
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.runAsync(route.closed);
      await tester.pumpWidget(const SizedBox());
    },
  );

  test(
    'restores independent controllers and disambiguates identical session IDs',
    () {
      expect(connections.computers, hasLength(2));
      final a = connections.computers.first, b = connections.computers.last;
      expect(identical(a.api, b.api), isFalse);
      expect(connections.resolve('same-id'), isNull);
      expect(
        connections.resolve(connections.route(a, 'same-id'))!.controller,
        same(a),
      );
      expect(
        connections.resolve(connections.route(b, 'same-id'))!.controller,
        same(b),
      );
      expect(
        connections.notificationSessions.map((s) => s.id).toSet(),
        hasLength(2),
      );
      expect(
        connections.resolve(computerRoute('b', 'previous-auth', 'same-id')),
        isNull,
      );
    },
  );
  test(
    'removing one computer preserves the other credentials, catalog and account',
    () async {
      final a = connections.computers.first, b = connections.computers.last;
      await connections.remove(b);
      expect(connections.computers, [a]);
      expect((await store.read()).deviceId, 'a');
      expect((await store.forComputer('second').read()).hasPairing, isFalse);
      expect(a.sessions.single.id, 'same-id');
      expect(a.api.sessionToken, 'account-token');
    },
  );
  test('cancelling addition does not overwrite any existing pairing', () async {
    final pending = await connections.beginAdding();
    expect(pending.phase, AppPhase.needsPairing);
    await connections.finishAdding(pending);
    expect(connections.computers, hasLength(2));
    expect((await store.read()).deviceId, 'a');
    expect((await store.forComputer('second').read()).deviceId, 'b');
  });
  test(
    're-pair replaces only that computer and invalidates old notification identity',
    () async {
      final old = connections.computers.last,
          oldRoute = connections.route(connections.computers.last, 'same-id');
      final next = await connections.beginAdding() as Computer;
      await pair(next.store, 'b', 'new-auth');
      await next.initialize();
      await connections.finishAdding(next);
      expect(connections.computers, hasLength(2));
      expect(connections.computers, isNot(contains(old)));
      expect(connections.resolve(oldRoute), isNull);
      expect(
        connections.resolve(connections.route(next, 'same-id'))!.controller,
        same(next),
      );
    },
  );
  test(
    'computer colors persist locally across restoration and isolate accounts',
    () async {
      final a = connections.computers.first, b = connections.computers.last;
      await connections.setColor(a, ComputerConnections.colors[1]);
      await connections.setColor(b, ComputerConnections.colors[2]);
      final restored = ComputerConnections(
        store: store,
        notifications: notifications,
        controllerFactory: Computer.new,
      );
      await restored.initialize();
      await restored.restored;
      expect(
        restored.colorOf(restored.computers.first),
        ComputerConnections.colors[1],
      );
      expect(
        restored.colorOf(restored.computers.last),
        ComputerConnections.colors[2],
      );
      expect(await store.computerColors('other@example.com'), isEmpty);
      await restored.setColor(restored.computers.first, 1);
      expect(
        restored.colorOf(restored.computers.first),
        ComputerConnections.colors[1],
      );
      restored.dispose();
    },
  );

  testWidgets('device list opens existing detail without changing selection', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: RelayTheme.web,
        home: Scaffold(
          body: DevicePage(
            controller: connections.account,
            connections: connections,
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.byKey(const ValueKey('device-list-a')), findsOneWidget);
    expect(find.byKey(const ValueKey('device-identity-card')), findsNothing);
    expect(
      find.byKey(const ValueKey('connect-another-computer')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('device-list-b')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.byKey(const ValueKey('device-identity-card')), findsOneWidget);
    expect(
      tester.widget<DevicePage>(find.byType(DevicePage)).controller,
      same(connections.computers.last),
    );
    await tester.pumpWidget(const SizedBox());
  });

  test('route codec rejects malformed input and preserves unicode/slashes', () {
    final route = computerRoute('device', 'auth', '会话/path');
    expect(parseComputerRoute(route)?.id, '会话/path');
    expect(parseComputerRoute('computer:???'), isNull);
    expect(parseComputerRoute('computer:W10'), isNull);
  });
  testWidgets(
    'home computer strip shows three slots and scrolls to additional computers',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      for (final id in ['c', 'd', 'e']) {
        final next = await connections.beginAdding() as Computer;
        await pair(next.store, id, 'auth-$id');
        await next.initialize();
        await connections.finishAdding(next);
      }
      AppController selected = connections.account;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, setState) => Row(
                children: [
                  const Text('最近会话', key: ValueKey('recent-heading')),
                  ComputerPicker(
                    connections: connections,
                    selected: selected,
                    compact: true,
                    onChanged: (c) => setState(() => selected = c),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      final strip = find.byKey(const ValueKey('home-computer-strip'));
      expect(tester.getSize(strip).width, 140);
      expect(
        tester.getTopLeft(strip).dx -
            tester.getTopRight(find.byKey(const ValueKey('recent-heading'))).dx,
        12,
      );
      expect(
        find.byKey(const ValueKey('home-computer-e')).hitTestable(),
        findsNothing,
      );
      await tester.drag(strip, const Offset(-220, 0));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('home-computer-e')));
      await tester.pump();
      expect(connections.deviceId(selected), 'e');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'a late computer restoration does not replace the visible home directory',
    (tester) async {
      final a = connections.computers.first as Computer;
      final b = connections.computers.last as Computer;
      a.phase = AppPhase.loading;
      await tester.pumpWidget(
        MaterialApp(
          theme: RelayTheme.web,
          home: AnimatedBuilder(
            animation: connections,
            builder: (_, _) =>
                RelayuneReadyScreen(controller: a, connections: connections),
          ),
        ),
      );
      expect(
        tester
            .widget<RelayuneHomePage>(find.byType(RelayuneHomePage))
            .controller,
        same(b),
      );
      a.phase = AppPhase.ready;
      a.publish();
      await tester.pump();
      await tester.pump();
      expect(
        tester
            .widget<RelayuneHomePage>(find.byType(RelayuneHomePage))
            .controller,
        same(b),
      );
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('home shows standalone refresh only with one computer', (
    tester,
  ) async {
    final a = connections.computers.first;
    a.refreshing = true;
    Future<void> pump() => tester.pumpWidget(
      MaterialApp(
        theme: RelayTheme.web,
        home: RelayuneReadyScreen(controller: a, connections: connections),
      ),
    );
    await pump();
    expect(find.byKey(const ValueKey('home-computer-strip')), findsOneWidget);
    expect(find.byKey(const ValueKey('home-refresh-progress')), findsNothing);
    await tester.runAsync(() => connections.remove(connections.computers.last));
    await pump();
    expect(find.byKey(const ValueKey('home-computer-strip')), findsNothing);
    expect(find.byKey(const ValueKey('home-refresh-progress')), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'home and drawer computer icons react to connection changes independently of unread',
    (tester) async {
      final b = connections.computers.last;
      for (final compact in [true, false]) {
        final prefix = compact ? 'home' : 'drawer';
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: ComputerPicker(
                connections: connections,
                selected: connections.account,
                compact: compact,
                onChanged: (_) {},
              ),
            ),
          ),
        );
        b.connectionSnapshot = const DeviceConnectionSnapshot(
          online: false,
          lastSeenAt: null,
          revision: 2,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        );
        await tester.pump();
        await tester.pump();
        expect(
          find.byKey(ValueKey('$prefix-computer-offline-b')),
          findsOneWidget,
        );
        expect(
          find.byKey(ValueKey('$prefix-computer-unread-b')),
          findsOneWidget,
        );
        expect(
          find.byKey(ValueKey('$prefix-computer-connecting-b')),
          findsNothing,
        );
        b.connectionSnapshot = b.connectionSnapshot.withTransport(
          RealtimeTransportState.reconnecting,
        );
        await tester.pump();
        await tester.pump();
        expect(
          find.byKey(ValueKey('$prefix-computer-connecting-b')),
          findsOneWidget,
        );
        expect(
          find.byKey(ValueKey('$prefix-computer-offline-b')),
          findsNothing,
        );
        expect(
          find.byKey(ValueKey('$prefix-computer-unread-b')),
          findsOneWidget,
        );
        b.connectionSnapshot = const DeviceConnectionSnapshot(
          online: true,
          lastSeenAt: null,
          revision: 3,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        );
        await tester.pump();
        await tester.pump();
        expect(
          find.byKey(ValueKey('$prefix-computer-offline-b')),
          findsNothing,
        );
        expect(
          find.byKey(ValueKey('$prefix-computer-connecting-b')),
          findsNothing,
        );
        expect(
          find.byKey(ValueKey('$prefix-computer-unread-b')),
          findsOneWidget,
        );
      }
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'computer badges update live and switching does not read another computer',
    (tester) async {
      final a = connections.computers.first;
      final b = connections.computers.last as Computer;
      AppController selected = a;
      await tester.pumpWidget(
        MaterialApp(
          theme: RelayTheme.web,
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, setState) => ComputerPicker(
                connections: connections,
                selected: selected,
                compact: true,
                onChanged: (c) => setState(() => selected = c),
              ),
            ),
          ),
        ),
      );
      expect(
        find.byKey(const ValueKey('home-computer-unread-a')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('home-computer-unread-b')),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('home-computer-b')));
      await tester.pump();
      expect(selected, same(b));
      expect(
        find.byKey(const ValueKey('home-computer-unread-b')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('home-computer-selected-b')),
        findsOneWidget,
      );
      b.approvals = [
        RelayApproval(
          id: 'pending',
          sessionId: 'same-id',
          action: const {},
          riskLevel: 'low',
          state: 'pending',
          requestedAt: DateTime.now().toIso8601String(),
          expiresAt: DateTime.now()
              .add(const Duration(hours: 1))
              .toIso8601String(),
        ),
      ];
      b.publish();
      await tester.pump();
      expect(
        find.byKey(const ValueKey('home-computer-approval-b')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('home-computer-unread-b')),
        findsNothing,
      );
      b.markAllSessionsOpened();
      await tester.pump();
      expect(
        find.byKey(const ValueKey('home-computer-approval-b')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('home-computer-unread-a')),
        findsOneWidget,
      );
      b.approvals = [b.approvals.single.copyWith(state: 'approved')];
      b.publish();
      await tester.pump();
      expect(
        find.byKey(const ValueKey('home-computer-approval-b')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('home-computer-unread-b')),
        findsNothing,
      );
      b.approvals = [
        RelayApproval(
          id: 'expired',
          sessionId: 'same-id',
          action: const {},
          riskLevel: 'low',
          state: 'pending',
          requestedAt: '2020-01-01',
          expiresAt: '2020-01-02',
        ),
      ];
      b.publish();
      await tester.pump();
      expect(
        find.byKey(const ValueKey('home-computer-approval-b')),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'home filters computers and same-ID conversations retain their owner and draft',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final a = connections.computers.first, b = connections.computers.last;
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('en'),
          theme: RelayTheme.web,
          home: AnimatedBuilder(
            animation: connections,
            builder: (_, _) => RelayuneReadyScreen(
              controller: connections.account,
              connections: connections,
            ),
          ),
        ),
      );
      await tester.pump();
      final row = find.byKey(const ValueKey('home-recent-session-same-id'));
      Future<void> select(String id) async {
        await tester.tap(find.byKey(ValueKey('home-computer-$id')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 350));
        expect(find.byType(PopupMenuButton<AppController>), findsNothing);
      }

      Future<void> home() async {
        await tester.tap(find.byKey(const ValueKey('workbench-home-button')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 350));
      }

      await tester.tap(row);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(
        tester.widget<WorkbenchScreen>(find.byType(WorkbenchScreen)).controller,
        same(a),
      );
      expect(find.textContaining('Computer a'), findsNothing);
      await tester.enterText(
        find.byType(TextField).last,
        'Draft on computer A',
      );
      // Switch from the conversation drawer; it must return to the target's
      // navigation without moving this draft or changing the session's owner.
      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(find.byKey(const ValueKey('drawer-computer-b')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(
        find.byKey(const ValueKey('drawer-computer-strip')),
        findsOneWidget,
      );
      expect(find.byType(WorkbenchScreen), findsNothing);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(find.byIcon(Icons.close_rounded).hitTestable().last);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(row);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(
        tester.widget<WorkbenchScreen>(find.byType(WorkbenchScreen)).controller,
        same(b),
      );
      expect(find.text('Draft on computer A'), findsNothing);
      await tester.enterText(
        find.byType(TextField).last,
        'Draft on computer B',
      );
      await home();
      await select('a');
      await tester.tap(row);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.text('Draft on computer A'), findsOneWidget);
      expect(find.text('Draft on computer B'), findsNothing);
      await home();
      await select('b');
      expect(row, findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}

class PreparationApi extends RelayApi {
  final gate = Completer<void>();
  int identityCalls = 0, bootstrapCalls = 0, pendingPairingCalls = 0;
  bool failFirst = false;
  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) async {
    identityCalls++;
    if (failFirst && identityCalls == 1) {
      throw const RelayApiException(
        'Temporarily unavailable',
        503,
        'temporary_unavailable',
      );
    }
    await gate.future;
    bootstrapCalls++;
    return const ServerBootstrap(
      email: 'owner@example.com',
      device: RelayDevice(
        id: '',
        name: 'Relay',
        online: false,
        agentConnected: false,
        lastSeenAt: null,
      ),
      catalog: null,
      events: [],
      cursor: 0,
      ackSequence: 0,
      queuedCommands: 0,
    );
  }

  @override
  Future<PendingBrowserPairingDiscovery> pendingBrowserPairings() async {
    pendingPairingCalls++;
    return const PendingBrowserPairingDiscovery(
      hasBoundComputer: true,
      pairings: [],
    );
  }
}
