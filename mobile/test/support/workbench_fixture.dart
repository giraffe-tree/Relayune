import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'package:relayune_mobile/src/storage/history_store.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/notifications/notification_coordinator.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/device_connection.dart';
import 'package:relayune_mobile/src/ui/workbench_screen.dart';
import 'package:relayune_mobile/src/ui/relayune_ready_screen.dart';
import 'package:relayune_mobile/src/ui/theme.dart';
import 'package:relayune_mobile/src/widgets/relay_text_selection.dart';

RelaySession relaySession({
  String id = 'root',
  String name = 'Active session',
  String project = 'Relayune',
  String cwd = '/workspace/relayune',
  String provider = 'codex',
  bool isSubagent = false,
  String? rootSessionId,
}) => RelaySession.fromJson({
  'id': id,
  'name': name,
  'project': project,
  'branch': 'main',
  'cwd': cwd,
  'status': 'active',
  'updated_at': '2026-08-10T10:00:00Z',
  'provider': provider,
  'is_subagent': isSubagent,
  'root_session_id': rootSessionId ?? id,
});

AppController workbenchController({
  bool online = true,
  RealtimeTransportState transport = RealtimeTransportState.connected,
  int revision = 7,
  String? websocketHeartbeatAt,
  int? websocketRoundTripMs,
  List<RelaySession>? sessions,
  List<RelayAgent> agents = const [],
  List<RelayApproval> approvals = const [],
  RelayApi? api,
  AppController? baseController,
  RelayNotificationManager? notificationManager,
}) {
  final catalog = sessions ?? [relaySession()];
  final controller =
      (baseController ??
            AppController(
              api: api,
              notificationManager: notificationManager,
              historyStore: _FixtureHistoryStore(),
              secureStore: _FixtureHistoryKeys(),
            ))
        ..phase = AppPhase.ready
        ..email = 'owner@example.com'
        ..bootstrap = ServerBootstrap(
          email: 'owner@example.com',
          device: RelayDevice(
            id: 'device',
            name: 'Test Mac',
            online: online,
            agentConnected: true,
            lastSeenAt: '2026-08-10T10:00:00Z',
          ),
          catalog: null,
          events: const [],
          cursor: 0,
          ackSequence: 12,
          queuedCommands: online ? 0 : 2,
        )
        ..sessions = catalog
        ..activeSessionId = catalog
            .where((item) => !item.isSubagent)
            .firstOrNull
            ?.id
        ..agents = agents
        ..approvals = approvals
        ..connectionSnapshot = DeviceConnectionSnapshot(
          online: online,
          lastSeenAt: '2026-08-10T10:00:00Z',
          revision: revision,
          transport: transport,
          realtimeConfirmed: true,
          websocketHeartbeatAt: websocketHeartbeatAt,
          websocketRoundTripMs: websocketRoundTripMs,
        );
  for (final session in catalog) {
    controller.messages[session.id] = [];
    controller.markHistoryLoadedForTesting(session.id);
  }
  if (agents.any((agent) => agent.isActive) &&
      controller.activeSessionId != null) {
    controller.runningSessions.add(controller.activeSessionId!);
  }
  return controller;
}

Future<void> pumpWorkbench(
  WidgetTester tester,
  AppController controller, {
  Size size = const Size(390, 844),
  double textScale = 1,
  bool disableAnimations = false,
  bool usesIosSimulatorEmojiFallback = false,
  bool supportsShowingSystemContextMenu = false,
  GlobalKey? captureKey,
  String? testFontFamily,
  bool startAtHome = false,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final baseTheme = RelayTheme.webFor(
    usesIosSimulatorEmojiFallback: usesIosSimulatorEmojiFallback,
  );
  final theme = testFontFamily == null
      ? baseTheme
      : baseTheme.copyWith(
          textTheme: baseTheme.textTheme.apply(fontFamily: testFontFamily),
        );
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      locale: controller.locale,
      supportedLocales: relayuneSupportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      theme: theme,
      darkTheme: theme,
      themeMode: ThemeMode.dark,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
          disableAnimations: disableAnimations,
          supportsShowingSystemContextMenu: supportsShowingSystemContextMenu,
        ),
        child: RepaintBoundary(
          key: captureKey,
          child: RelayTextSelection(child: child!),
        ),
      ),
      home: AnimatedBuilder(
        animation: controller,
        builder: (context, _) => startAtHome
            ? RelayuneReadyScreen(controller: controller)
            : WorkbenchScreen(controller: controller),
      ),
    ),
  );
}

Future<void> openDeviceSettings(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('workbench-navigation-button')));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 320));
  await tester.tap(find.byKey(const ValueKey('drawer-settings-entry')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const ValueKey('settings-device-entry')));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 350));
}

// Widget journeys exercise send-before/after UI using a deterministic storage
// boundary. SQLite durability and failure behavior use the real storage suites.
class _FixtureHistoryKeys extends SecureStore {
  @override
  Future<String?> readHistoryKey(String scope) async =>
      base64Encode(List<int>.filled(32, 7));
  @override
  Future<void> saveHistoryKey(String scope, String key) async {}
  @override
  Future<void> clearHistoryKey(String scope) async {}
  @override
  Future<List<String>> allHistoryKeys() async => [
    base64Encode(List<int>.filled(32, 7)),
  ];
}

class _FixtureHistoryStore extends HistoryStore {
  final _pending = <String, Map<String, dynamic>>{};
  @override
  Future<Database> get database async => _FixtureDatabase();
  @override
  Future<void> appendMessages(
    List<int> key,
    String session,
    List<RelayMessage> messages,
  ) async {}
  @override
  Future<void> appendPage(
    List<int> key,
    String session,
    String? before,
    HistoryPage page,
  ) async {}
  @override
  Future<void> savePending(
    List<int> key,
    String session,
    RelayMessage message,
    Map<String, dynamic> frame,
  ) async {
    _pending[message.clientMessageId!] = {
      'message': HistoryStore.encodeMessage(message, includeBytes: true),
      'frame': frame,
    };
  }

  @override
  Future<void> confirmPending(
    List<int> key,
    String session,
    String clientId,
  ) async {
    _pending.remove(clientId);
  }

  @override
  Future<HistoryPage?> readPage(
    List<int> key,
    String session, {
    String? before,
  }) async => null;
  @override
  Future<HistoryPage?> readRecent(List<int> key, String session) async => null;
  @override
  Future<({HistoryPage? page, HistoryPage? recent})> readLatest(
    List<int> key,
    String session, {
    void Function(HistoryPage preview)? onPreview,
  }) async => (page: null, recent: null);
  @override
  Future<void> touchSession(List<int> key, String session) async {}
  @override
  Future<void> removeNamespace(List<int> key) async {
    _pending.clear();
  }

  @override
  Future<Set<String>> cachedNamespaces() async => {};
  @override
  Future<void> close() async {
    unpinSession();
  }
}

class _FixtureDatabase implements Database {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
