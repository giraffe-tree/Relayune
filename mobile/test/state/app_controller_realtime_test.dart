import 'dart:convert';
import 'dart:io';

import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/network/realtime_client.dart';
import 'package:relayune_mobile/src/notifications/notification_coordinator.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/device_connection.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';

void main() {
  test(
    'late catch-up response after leave/return is discarded and the new generation reads again',
    () async {
      final gate = Completer<EventPage>();
      final api = _RetryEventApi()..pending = gate;
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap();
      addTearDown(controller.dispose);
      final old = controller.catchUpEventsForTesting();
      await Future<void>.delayed(Duration.zero);
      controller.setPresentationForeground(false);
      controller.setPresentationForeground(true);
      api.pending = null;
      api.fail = false;
      final current = controller.catchUpEventsForTesting();
      gate.complete(
        const EventPage(events: [], nextCursor: 999, hasMore: false),
      );
      await Future.wait([old, current]);
      expect(api.cursors, [0, 0]);
      expect(controller.opaqueCursor, 0);
    },
  );

  testWidgets(
    'ordinary background cancels catch-up retry and ignores new invalidations',
    (tester) async {
      final api = _RetryEventApi();
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap();
      addTearDown(controller.dispose);
      const signal = RealtimeSignal(
        type: 'invalidate',
        deviceId: 'dev_test',
        scopes: ['events'],
      );
      await controller.applyRealtimeSignalForTesting(signal);
      expect(api.cursors, [0]);
      controller.setPresentationForeground(false);
      await tester.pump(const Duration(hours: 1));
      await controller.applyRealtimeSignalForTesting(signal);
      await controller.catchUpEventsForTesting();
      expect(api.cursors, [0]);
      expect(
        controller.connectionSnapshot.transport,
        RealtimeTransportState.idle,
      );
    },
  );

  testWidgets(
    'a long-running stream coalesces UI updates and ends immediately',
    (tester) async {
      final controller = AppController()
        ..phase = AppPhase.ready
        ..activeSessionId = 'session_root';
      addTearDown(controller.dispose);
      var publications = 0;
      controller.addListener(() => publications++);
      RelayEvent event(String id, String kind, {String? text}) => RelayEvent(
        cursor: 0,
        eventId: id,
        sessionId: 'session_root',
        agentId: null,
        createdAt: DateTime.now().toUtc().toIso8601String(),
        event: {
          'kind': kind,
          'turn_id': 'long-turn',
          'item_id': 'reply',
          if (text != null) 'text': text,
        },
      );
      controller.receiveLiveEventForTesting(event('start', 'turn.started'));
      final before = publications;
      for (var i = 0; i < 2000; i++) {
        controller.receiveLiveEventForTesting(
          event('delta-$i', 'message.delta', text: '字'),
        );
        await tester.pump(const Duration(milliseconds: 1));
      }
      expect(publications - before, lessThanOrEqualTo(50));
      expect(controller.messages['session_root']!.single.content, '字' * 2000);
      final beforeCompletion = publications;
      controller.receiveLiveEventForTesting(
        event('complete', 'message.completed', text: '字' * 2000),
      );
      controller.receiveLiveEventForTesting(event('end', 'turn.completed'));
      expect(publications, beforeCompletion + 2);
      expect(controller.runningSessions, isEmpty);
      await tester.pump(const Duration(seconds: 1));
      expect(
        publications,
        beforeCompletion + 2,
        reason: 'no stale scheduled rebuild after completion',
      );
      controller.setPresentationForeground(false);
      final beforeBackground = publications;
      controller.receiveLiveEventForTesting(
        event('background', 'message.delta', text: '后台'),
      );
      await tester.pump(const Duration(minutes: 45));
      expect(
        publications,
        beforeBackground,
        reason: 'no invisible text rebuilds while backgrounded',
      );
      controller.receiveLiveEventForTesting(
        event('background-end', 'turn.completed'),
      );
      expect(
        publications,
        beforeBackground + 1,
        reason: 'terminal state still publishes in background',
      );
    },
  );

  testWidgets('failed event invalidation retries with bounded backoff', (
    tester,
  ) async {
    final key = RelayKey.import(_testKey());
    final aad = _eventAad();
    final envelope = await tester.runAsync(
      () => RelayCipher().sealJson(key, {
        'type': 'session.event',
        'session_id': 'session_root',
        'created_at': '2026-08-10T08:00:00.000Z',
        'event': {
          'kind': 'user.message',
          'text': 'recovered',
          'turn_id': 'retry',
        },
      }, aad),
    );
    final api = _RetryEventApi()
      ..page = EventPage(
        events: [
          OpaqueFrame(
            cursor: 8,
            eventId: 'retry',
            deviceId: 'dev_test',
            sessionId: 'session_root',
            requestId: null,
            aad: aad,
            envelope: envelope!,
          ),
        ],
        nextCursor: 8,
        hasMore: false,
      );
    final controller = AppController(api: api)
      ..phase = AppPhase.ready
      ..bootstrap = _bootstrap()
      ..relayKey = key
      ..opaqueCursor = 7;
    addTearDown(controller.dispose);
    await controller.applyRealtimeSignalForTesting(
      const RealtimeSignal(
        type: 'invalidate',
        deviceId: 'dev_test',
        scopes: ['events'],
      ),
    );
    expect(api.cursors, [7]);
    await tester.pump(const Duration(milliseconds: 999));
    expect(api.cursors, [7]);
    await tester.pump(const Duration(milliseconds: 1));
    expect(api.cursors, [7, 7]);
    await tester.pump(const Duration(milliseconds: 1999));
    expect(api.cursors, [7, 7]);
    api.fail = false;
    await tester.pump(const Duration(milliseconds: 1));
    expect(api.cursors, [7, 7, 7]);
    await tester.runAsync(() async {
      for (var i = 0; i < 100 && controller.opaqueCursor != 8; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
    });
    expect(controller.opaqueCursor, 8);
    expect(controller.messages['session_root']!.single.content, 'recovered');
    await tester.pump(const Duration(seconds: 30));
    expect(api.cursors, [7, 7, 7]);
  });

  testWidgets('continuous event failures cap retry cadence at thirty seconds', (
    tester,
  ) async {
    final api = _RetryEventApi();
    final controller = AppController(api: api)
      ..phase = AppPhase.ready
      ..bootstrap = _bootstrap();
    addTearDown(controller.dispose);
    await controller.applyRealtimeSignalForTesting(
      const RealtimeSignal(
        type: 'invalidate',
        deviceId: 'dev_test',
        scopes: ['events'],
      ),
    );
    var expected = 1;
    for (final seconds in [1, 2, 4, 8, 16, 30, 30]) {
      await tester.pump(Duration(milliseconds: seconds * 1000 - 1));
      expect(api.cursors.length, expected);
      await tester.pump(const Duration(milliseconds: 1));
      expect(api.cursors.length, ++expected);
    }
    controller.pauseRealtime();
    await tester.pump(const Duration(seconds: 30));
    expect(api.cursors.length, expected);
  });

  testWidgets('disposing cancels pending event retry', (tester) async {
    final api = _RetryEventApi();
    final controller = AppController(api: api)
      ..phase = AppPhase.ready
      ..bootstrap = _bootstrap();
    await controller.applyRealtimeSignalForTesting(
      const RealtimeSignal(
        type: 'invalidate',
        deviceId: 'dev_test',
        scopes: ['events'],
      ),
    );
    controller.dispose();
    await tester.pump(const Duration(minutes: 2));
    expect(api.cursors, [0]);
  });

  testWidgets('new realtime generation replaces an old retry timer', (
    tester,
  ) async {
    final api = _RetryEventApi();
    final controller = AppController(api: api)
      ..phase = AppPhase.ready
      ..bootstrap = _bootstrap();
    await controller.applyRealtimeSignalForTesting(
      const RealtimeSignal(type: 'ready', deviceId: 'dev_test'),
    );
    await tester.pump(const Duration(seconds: 1));
    expect(api.cursors.length, 2);
    controller.advanceRealtimeGenerationForTesting();
    await controller.applyRealtimeSignalForTesting(
      const RealtimeSignal(type: 'ready', deviceId: 'dev_test'),
    );
    expect(api.cursors.length, 3);
    await tester.pump(const Duration(seconds: 1));
    expect(api.cursors.length, 4);
    controller.dispose();
  });

  testWidgets('new ready sharing old in-flight failure owns retry', (
    tester,
  ) async {
    final api = _RetryEventApi()..pending = Completer<EventPage>();
    final controller = AppController(api: api)
      ..phase = AppPhase.ready
      ..bootstrap = _bootstrap();
    final oldReady = controller.applyRealtimeSignalForTesting(
      const RealtimeSignal(type: 'ready', deviceId: 'dev_test'),
    );
    controller.advanceRealtimeGenerationForTesting();
    final newReady = controller.applyRealtimeSignalForTesting(
      const RealtimeSignal(type: 'ready', deviceId: 'dev_test'),
    );
    expect(
      api.cursors.length,
      1,
      reason: 'one cursor reader across generations',
    );
    final pending = api.pending!;
    api.pending = null;
    pending.completeError(
      const RelayApiException('temporary', 503, 'unavailable'),
    );
    await Future.wait([oldReady, newReady]);
    await tester.pump(const Duration(seconds: 1));
    expect(api.cursors.length, 2);
    controller.dispose();
  });

  test('applied event page publishes before a delayed next page', () async {
    final key = RelayKey.import(_testKey());
    final aad = _eventAad();
    final frame = OpaqueFrame(
      cursor: 1,
      eventId: 'evt_page',
      deviceId: 'dev_test',
      sessionId: 'session_root',
      requestId: null,
      aad: aad,
      envelope: await RelayCipher().sealJson(key, {
        'type': 'session.event',
        'session_id': 'session_root',
        'created_at': DateTime.now().toIso8601String(),
        'event': {
          'kind': 'message.delta',
          'text': 'first page reply',
          'turn_id': 'turn_page',
          'item_id': 'reply_page',
        },
      }, aad),
    );
    final api = _DelayedEventPageApi(
      EventPage(events: [frame], nextCursor: 1, hasMore: true),
    );
    final controller = AppController(api: api)
      ..phase = AppPhase.ready
      ..bootstrap = _bootstrap()
      ..relayKey = key
      ..activeSessionId = 'session_root';
    addTearDown(controller.dispose);
    var notifications = 0;
    controller.addListener(() {
      notifications++;
    });
    final catchup = controller.catchUpEventsForTesting();
    await api.secondStarted.future;
    expect(
      controller.messages['session_root']?.single.content,
      'first page reply',
    );
    expect(
      notifications,
      1,
      reason: 'first reply is renderable while next page is pending',
    );
    api.release.complete(
      const EventPage(events: [], nextCursor: 1, hasMore: false),
    );
    await catchup;
    expect(notifications, 1, reason: 'empty page does not rebuild the UI');
  });

  test(
    'new-session text arrives while catalog refresh is still pending',
    () async {
      final key = RelayKey.import(_testKey());
      final aad = _eventAad();
      final frame = OpaqueFrame(
        cursor: 1,
        eventId: 'evt_1',
        deviceId: 'dev_test',
        sessionId: 'session_root',
        requestId: null,
        aad: aad,
        envelope: await RelayCipher().sealJson(key, {
          'type': 'session.event',
          'session_id': 'session_root',
          'created_at': DateTime.now().toIso8601String(),
          'event': {
            'kind': 'message.delta',
            'text': '第一段文字',
            'turn_id': 'turn_1',
            'item_id': 'reply_1',
          },
        }, aad),
      );
      final api = _DelayedCatalogApi(
        EventPage(events: [frame], nextCursor: 1, hasMore: false),
      );
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..activeSessionId = 'session_root';
      addTearDown(controller.dispose);
      final refresh = controller.applyRealtimeSignalForTesting(
        const RealtimeSignal(
          type: 'invalidate',
          deviceId: 'dev_test',
          scopes: ['catalog'],
        ),
      );
      controller.startDirectorySyncForTesting();
      await controller.syncDirectoryForTesting();
      await api.started.future;
      try {
        await controller.applyRealtimeSignalForTesting(
          const RealtimeSignal(
            type: 'invalidate',
            deviceId: 'dev_test',
            scopes: ['events'],
          ),
        );
        expect(controller.messages['session_root']?.single.content, '第一段文字');
        expect(controller.opaqueCursor, 1);
        expect(api.release.isCompleted, isFalse);
      } finally {
        api.release.complete(_bootstrap(events: [frame]));
        await refresh;
      }
    },
  );

  test(
    '[MOB-DEV-005][flutter] encrypted desktop metadata refreshes and clears with pairing',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _BootstrapRelayApi(_bootstrap());
      final controller =
          AppController(api: api, secureStore: _FakeSecureStore())
            ..bootstrap = _bootstrap()
            ..relayKey = key;
      addTearDown(controller.dispose);
      const aad = RelayAad(
        direction: 'relay_to_web',
        type: 'relay.sync_sessions',
        deviceId: 'dev_test',
        sessionId: null,
        requestId: null,
        eventSeq: null,
        createdAt: '2026-09-07T10:00:00.000Z',
        expiresAt: null,
      );
      for (final desktop in [
        {'version': '0.3.18', 'platform': 'darwin'},
        {'version': '0.3.19', 'platform': 'win32'},
        {'version': '  ', 'platform': 'darwin'},
        {'version': 123, 'platform': false},
        null,
      ]) {
        api.value = _bootstrap(
          catalog: OpaqueFrame(
            deviceId: 'dev_test',
            sessionId: null,
            requestId: null,
            aad: aad,
            envelope: await RelayCipher().sealJson(key, {
              'type': 'relay.sync_sessions',
              'sessions': [],
              'projects': [],
              if (desktop != null) 'desktop': desktop,
            }, aad),
          ),
        );
        await controller.refresh();
        final version = desktop?['version'];
        expect(
          controller.desktopInfo?.version,
          version is String && version.trim().isNotEmpty ? version : null,
        );
        expect(controller.error, isEmpty);
      }
      controller.desktopInfo = const RelayDesktopInfo(version: '0.3.18');
      api.value = _bootstrap();
      await controller.refresh();
      expect(controller.desktopInfo, isNull);
      controller.desktopInfo = const RelayDesktopInfo(version: '0.3.18');
      await controller.clearPairing();
      expect(controller.desktopInfo, isNull);
    },
  );

  test(
    '[MOB-STA-001][flutter] all screens consume one immutable connection snapshot',
    () {
      final controller = AppController();
      controller.connectionSnapshot = const DeviceConnectionSnapshot(
        online: true,
        lastSeenAt: '2026-08-10T08:00:00.000Z',
        revision: 8,
        transport: RealtimeTransportState.connected,
        realtimeConfirmed: true,
      );

      expect(controller.deviceOnline, isTrue);
      expect(controller.connectionSnapshot.revision, 8);
      controller.dispose();
    },
  );

  test(
    '[MOB-STA-002][flutter] online offline online transitions reject an older revision',
    () {
      const initial = DeviceConnectionSnapshot.initial();
      final online = initial.applyPresence(
        online: true,
        lastSeenAt: '2026-08-10T08:00:00.000Z',
        revision: 10,
      );
      final offline = online.applyPresence(
        online: false,
        lastSeenAt: '2026-08-10T08:00:00.000Z',
        revision: 20,
      );
      final stale = offline.applyPresence(
        online: true,
        lastSeenAt: '2026-08-10T07:59:59.000Z',
        revision: 19,
      );

      expect(identical(stale, offline), isTrue);
      expect(stale.online, isFalse);
      expect(stale.revision, 20);
    },
  );

  test(
    '[MOB-STA-003][flutter] reconnecting socket keeps last confirmed computer presence distinct',
    () {
      final online = const DeviceConnectionSnapshot.initial().applyPresence(
        online: true,
        lastSeenAt: '2026-08-10T08:00:00.000Z',
        revision: 10,
      );
      final reconnecting = online.withTransport(
        RealtimeTransportState.reconnecting,
      );

      expect(reconnecting.online, isTrue);
      expect(reconnecting.transport, RealtimeTransportState.reconnecting);
    },
  );

  test(
    '[MOB-STA-005][flutter] revoked browser authorization clears realtime pairing and returns to pairing',
    () async {
      final store = _FakeSecureStore();
      final api = _RevokedRelayApi()..browserToken = 'browser_secret';
      final key = RelayKey.import(_testKey());
      final controller = AppController(api: api, secureStore: store)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({
            'id': 'root',
            'name': 'Root',
            'root_session_id': 'root',
          }),
        ];

      await controller.handleRevocationForTesting();

      expect(store.pairingCleared, isTrue);
      expect(api.browserToken, isNull);
      expect(controller.relayKey, isNull);
      expect(controller.sessions, isEmpty);
      expect(controller.connectionSnapshot.realtimeConfirmed, isFalse);
      expect(controller.phase, AppPhase.needsPairing);
      expect(controller.notice, contains('授权已被取消'));
      controller.dispose();
    },
  );

  test(
    '[MOB-DEV-002][flutter] device status updates automatically from realtime presence',
    () async {
      final controller = AppController()..bootstrap = _bootstrap();

      await controller.applyRealtimeSignalForTesting(
        const RealtimeSignal(
          type: 'presence',
          deviceId: 'dev_test',
          online: false,
          lastSeenAt: '2026-08-10T08:00:00.000Z',
          revision: 24,
        ),
      );

      expect(controller.deviceOnline, isFalse);
      expect(controller.connectionSnapshot.realtimeConfirmed, isTrue);
      controller.dispose();
    },
  );

  test(
    '[MOB-DEV-003][flutter] last seen and computer state share one snapshot revision',
    () async {
      final controller = AppController()..bootstrap = _bootstrap();

      await controller.applyRealtimeSignalForTesting(
        const RealtimeSignal(
          type: 'presence',
          deviceId: 'dev_test',
          online: true,
          lastSeenAt: '2026-08-10T08:01:00.000Z',
          revision: 25,
        ),
      );

      expect(controller.connectionSnapshot.online, isTrue);
      expect(
        controller.connectionSnapshot.lastSeenAt,
        '2026-08-10T08:01:00.000Z',
      );
      expect(controller.connectionSnapshot.revision, 25);
      controller.dispose();
    },
  );

  test(
    '[MOB-RT-011][flutter] WebSocket heartbeat records server time and round-trip latency',
    () async {
      final controller = AppController()..bootstrap = _bootstrap();
      var broadNotifications = 0;
      var connectionNotifications = 0;
      controller.addListener(() => broadNotifications += 1);
      controller.connectionSnapshotListenable.addListener(
        () => connectionNotifications += 1,
      );

      await controller.applyRealtimeSignalForTesting(
        RealtimeSignal.fromJson(const {
          'type': 'heartbeat',
          'device_id': 'dev_test',
          'server_time': '2026-09-03T08:01:00.000Z',
          'round_trip_ms': 18,
        }),
      );

      expect(
        controller.connectionSnapshot.websocketHeartbeatAt,
        '2026-09-03T08:01:00.000Z',
      );
      expect(controller.connectionSnapshot.websocketRoundTripMs, 18);
      expect(connectionNotifications, 1);
      expect(
        broadNotifications,
        0,
        reason: 'heartbeat metrics must not rebuild the whole application',
      );
      controller.dispose();
    },
  );

  test(
    '[MOB-LAY-005][flutter] encrypted catalog restores provider token usage',
    () async {
      final key = RelayKey.import(_testKey());
      const aad = RelayAad(
        direction: 'relay_to_web',
        type: 'relay.sync_sessions',
        deviceId: 'dev_test',
        sessionId: null,
        requestId: null,
        eventSeq: null,
        createdAt: '2026-09-02T10:00:00.000Z',
        expiresAt: null,
      );
      final frame = OpaqueFrame(
        deviceId: 'dev_test',
        sessionId: null,
        requestId: null,
        aad: aad,
        envelope: await RelayCipher().sealJson(key, {
          'type': 'relay.sync_sessions',
          'sessions': const [],
          'projects': const [],
          'usage': {
            'codex': {
              'as_of': '2026-09-02T10:00:00.000Z',
              'daily': [
                {'date': '2026-09-02', 'total_tokens': 416900000},
              ],
            },
            'kimi': {
              'as_of': '2026-09-02T10:01:00.000Z',
              'source': 'local_wire',
              'complete': false,
              'daily': [
                {'date': '2026-09-02', 'total_tokens': 81234000},
              ],
            },
            'claude': {
              'as_of': '2026-09-02T10:02:00.000Z',
              'source': 'local_transcripts',
              'complete': false,
              'daily': [
                {'date': '2026-09-01', 'total_tokens': 25000000},
              ],
            },
          },
        }, aad),
      );
      final controller = AppController(
        api: _BootstrapRelayApi(_bootstrap(catalog: frame)),
      )..bootstrap = _bootstrap();
      controller.relayKey = key;

      await controller.refresh();

      expect(controller.codexUsage?.asOf, '2026-09-02T10:00:00.000Z');
      expect(controller.codexUsage?.daily.single.totalTokens, 416900000);
      expect(controller.usageByProvider.keys, ['codex', 'kimi', 'claude']);
      expect(controller.usageByProvider['kimi']?.source, 'local_wire');
      expect(controller.usageByProvider['kimi']?.complete, isFalse);
      expect(
        controller.usageByProvider['claude']?.daily.single.totalTokens,
        25000000,
      );
      controller.dispose();
    },
  );

  test(
    '[MOB-RT-004][flutter] reconnect resumes from cursor and deduplicates replay',
    () async {
      final key = RelayKey.import(_testKey());
      final cipher = RelayCipher();
      final aad = _eventAad();
      final envelope = await cipher.sealJson(key, {
        'type': 'session.event',
        'session_id': 'session_root',
        'agent_id': null,
        'created_at': '2026-08-10T08:00:00.000Z',
        'event': {'kind': 'user.message', 'text': 'hello', 'turn_id': 'turn_1'},
      }, aad);
      final frame = OpaqueFrame(
        cursor: 1,
        eventId: 'evt_1',
        deviceId: 'dev_test',
        sessionId: 'session_root',
        requestId: null,
        aad: aad,
        envelope: envelope,
      );
      final api = _FakeRelayApi(
        EventPage(events: [frame], nextCursor: 1, hasMore: false),
      );
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key;

      await controller.catchUpEventsForTesting();
      await controller.catchUpEventsForTesting();

      expect(controller.opaqueCursor, 1);
      expect(controller.messages['session_root'], hasLength(1));
      controller.dispose();
    },
  );

  test(
    '[MOB-RT-005][flutter] invalid encrypted event does not advance cursor',
    () async {
      final key = RelayKey.import(_testKey());
      final aad = _eventAad();
      final frame = OpaqueFrame(
        cursor: 1,
        eventId: 'evt_invalid',
        deviceId: 'dev_test',
        sessionId: 'session_root',
        requestId: null,
        aad: aad,
        envelope: SealedEnvelope(
          version: 1,
          algorithm: 'A256GCM',
          keyId: key.keyId,
          iv: 'AAAAAAAAAAAAAAAA',
          aad: 'e30',
          ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA',
        ),
      );
      final controller =
          AppController(
              api: _FakeRelayApi(
                EventPage(events: [frame], nextCursor: 1, hasMore: false),
              ),
            )
            ..phase = AppPhase.ready
            ..bootstrap = _bootstrap()
            ..relayKey = key;

      await expectLater(
        controller.catchUpEventsForTesting(),
        throwsFormatException,
      );
      expect(controller.opaqueCursor, 0);
      controller.dispose();
    },
  );

  test(
    '[MOB-RT-006][flutter] reconnect uses bounded jitter and performs cursor catch-up on ready',
    () async {
      expect(
        realtimeReconnectDelay(attempt: 0, randomValue: 0),
        const Duration(milliseconds: 375),
      );
      expect(
        realtimeReconnectDelay(attempt: 20, randomValue: 1),
        const Duration(milliseconds: 37500),
      );
      final controllerSource = await File(
        'lib/src/state/app_controller.dart',
      ).readAsString();
      expect(controllerSource, contains("if (signal.type == 'ready')"));
      expect(controllerSource, contains('await _catchUpEvents();'));
    },
  );

  test(
    '[MOB-RT-009][flutter] mobile has no steady event bootstrap or history polling',
    () async {
      final controllerSource = await File(
        'lib/src/state/app_controller.dart',
      ).readAsString();
      final configSource = await File('lib/src/config.dart').readAsString();
      final directoryStart = controllerSource.indexOf(
        '  void _startDirectorySync()',
      );
      final directoryEnd = controllerSource.indexOf(
        '  @visibleForTesting',
        directoryStart,
      );
      final directoryScheduler = controllerSource.substring(
        directoryStart,
        directoryEnd,
      );
      expect(directoryScheduler, contains('Timer.periodic'));
      expect(directoryScheduler, contains('_syncSessionDirectory()'));
      final requestGuard = RegExp(
        r'authorization = Timer\.periodic\([\s\S]*?\n      \}\);',
      ).firstMatch(controllerSource)!;
      final guardSource = requestGuard.group(0)!;
      expect(guardSource, contains('request_cancelled'));
      expect(guardSource, isNot(contains('api.')));
      expect(controllerSource, contains('authorization.cancel();'));
      expect(
        controllerSource
            .replaceRange(directoryStart, directoryEnd, '')
            .replaceFirst(guardSource, ''),
        isNot(contains('Timer.periodic')),
        reason:
            'Only directory sync and the active-request cancellation guard may run periodically',
      );
      expect(configSource, isNot(contains('eventPollInterval')));
      expect(controllerSource, contains('IoRealtimeConnector'));
    },
  );

  test(
    'stable API codes localize errors without exposing server messages',
    () async {
      final api = _ErrorRelayApi();
      final controller = AppController(api: api, locale: const Locale('ar'));
      final copy = relayuneLocalizationsFor(const Locale('ar'));
      addTearDown(controller.dispose);
      final cases = <(String, int, String)>[
        ('network_timeout', 0, copy.apiErrorTimeout),
        ('network_unavailable', 0, copy.apiErrorNetworkUnavailable),
        ('invalid_response', 502, copy.apiErrorInvalidResponse),
        ('invalid_credentials', 401, copy.apiErrorInvalidCredentials),
        ('unauthorized', 401, copy.apiErrorAuthentication),
        ('internal_error', 500, copy.apiErrorService),
        ('unknown_secret_code', 418, copy.apiErrorGeneric),
      ];

      for (final entry in cases) {
        api.error = RelayApiException(
          'secret server detail for ${entry.$1}',
          entry.$2,
          entry.$1,
        );
        await controller.continueWithEmail('owner@example.com');
        expect(controller.error, entry.$3, reason: entry.$1);
        expect(controller.error, isNot(contains('secret')));
      }
    },
  );

  test(
    '[MOB-OFF-003][flutter] offline message submission is rejected before transport',
    () async {
      final api = _QueuedRelayApi();
      final controller = AppController(api: api, locale: const Locale('fr'))
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..sessions = [
          RelaySession.fromJson({
            'id': 'root',
            'name': 'Root',
            'root_session_id': 'root',
          }),
        ]
        ..activeSessionId = 'root'
        ..relayKey = RelayKey.import(_testKey())
        ..connectionSnapshot = const DeviceConnectionSnapshot(
          online: false,
          lastSeenAt: '2026-08-10T08:00:00.000Z',
          revision: 1,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        );
      addTearDown(controller.dispose);

      expect(
        await controller.sendMessage('must not queue'),
        MessageSendOutcome.rejected,
      );
      expect(api.commandCount, 0);
      expect(controller.messages['root'], isNull);
      expect(
        controller.error,
        relayuneLocalizationsFor(const Locale('fr')).workbenchOfflineQueued,
      );
    },
  );

  test(
    'locale changes clear transient copy and preserve semantic send activity',
    () async {
      final api = _QueuedRelayApi();
      final notifications = _RecordingNotificationManager();
      final controller =
          AppController(
              api: api,
              locale: const Locale('fr'),
              notificationManager: notifications,
            )
            ..phase = AppPhase.ready
            ..bootstrap = const ServerBootstrap(
              email: 'owner@example.com',
              device: RelayDevice(
                id: 'dev_test',
                name: 'Test Mac',
                online: true,
                agentConnected: true,
                lastSeenAt: '2026-08-10T08:00:00.000Z',
              ),
              catalog: null,
              events: [],
              cursor: 0,
              ackSequence: 0,
              queuedCommands: 0,
            )
            ..sessions = [
              RelaySession.fromJson({
                'id': 'root',
                'name': 'Root',
                'root_session_id': 'root',
                'status': 'active',
              }),
            ]
            ..activeSessionId = 'root'
            ..relayKey = RelayKey.import(_testKey())
            ..connectionSnapshot = const DeviceConnectionSnapshot(
              online: true,
              lastSeenAt: '2026-08-10T08:00:00.000Z',
              revision: 1,
              transport: RealtimeTransportState.connected,
              realtimeConfirmed: true,
            );
      addTearDown(controller.dispose);

      expect(await controller.sendMessage('queued'), MessageSendOutcome.queued);
      expect(
        controller.sessionActivity('root'),
        relayuneLocalizationsFor(const Locale('fr')).controllerWaitingForAgent,
      );
      controller
        ..error = 'ancienne erreur'
        ..notice = 'ancien avis'
        ..setLocale(const Locale('ar'));

      expect(controller.error, isEmpty);
      expect(controller.notice, isEmpty);
      expect(notifications.locales, [const Locale('ar')]);
      expect(
        controller.sessionActivity('root'),
        relayuneLocalizationsFor(const Locale('ar')).controllerWaitingForAgent,
      );
    },
  );
}

class _FakeRelayApi extends RelayApi {
  _FakeRelayApi(this.page);

  final EventPage page;

  @override
  Future<EventPage> pollEvents({
    required String deviceId,
    required int cursor,
  }) async => page;
}

class _BootstrapRelayApi extends RelayApi {
  _BootstrapRelayApi(this.value);

  ServerBootstrap value;

  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) async => value;
}

class _RevokedRelayApi extends RelayApi {
  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) async => _bootstrap();
}

class _ErrorRelayApi extends RelayApi {
  RelayApiException error = const RelayApiException('', 0, 'request_failed');

  @override
  Future<String> emailStatus(String email) => Future.error(error);
}

class _QueuedRelayApi extends RelayApi {
  final Completer<ServerBootstrap> _refresh = Completer<ServerBootstrap>();
  int commandCount = 0;

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
    commandCount += 1;
    return CommandResult(requestId: requestId, delivery: 'queued');
  }

  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) => _refresh.future;
}

class _RecordingNotificationManager implements RelayNotificationManager {
  final List<Locale> locales = [];

  @override
  RelayNotificationAuthorization authorization =
      RelayNotificationAuthorization.enabled;

  @override
  void setLocale(Locale locale) => locales.add(locale);

  @override
  Future<RelayNotificationAuthorization> refreshAuthorization() async =>
      authorization;

  @override
  Future<RelayNotificationAuthorization> requestAuthorization() async =>
      authorization;

  @override
  Future<void> openSettings() async {}
}

class _FakeSecureStore extends SecureStore {
  bool pairingCleared = false;

  @override
  Future<void> clearPairing() async {
    pairingCleared = true;
  }
}

ServerBootstrap _bootstrap({
  OpaqueFrame? catalog,
  List<OpaqueFrame> events = const [],
}) => ServerBootstrap(
  email: 'owner@example.com',
  device: RelayDevice(
    id: 'dev_test',
    name: 'Test Mac',
    online: true,
    agentConnected: true,
    lastSeenAt: '2026-08-10T08:00:00.000Z',
  ),
  catalog: catalog,
  events: events,
  cursor: 0,
  ackSequence: 0,
  queuedCommands: 0,
);

RelayAad _eventAad() => const RelayAad(
  direction: 'relay_to_web',
  type: 'session.event',
  deviceId: 'dev_test',
  sessionId: 'session_root',
  requestId: null,
  eventSeq: 1,
  createdAt: '2026-08-10T08:00:00.000Z',
  expiresAt: null,
);

String _testKey() => base64Url
    .encode(List<int>.generate(32, (index) => index))
    .replaceAll('=', '');

class _DelayedCatalogApi extends _FakeRelayApi {
  _DelayedCatalogApi(super.page);
  final started = Completer<void>();
  final release = Completer<ServerBootstrap>();

  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) {
    if (!started.isCompleted) started.complete();
    return release.future;
  }
}

class _DelayedEventPageApi extends RelayApi {
  _DelayedEventPageApi(this.first);
  final EventPage first;
  final secondStarted = Completer<void>();
  final release = Completer<EventPage>();
  @override
  Future<EventPage> pollEvents({
    required String deviceId,
    required int cursor,
  }) async {
    if (cursor == 0) return first;
    secondStarted.complete();
    return release.future;
  }
}

class _RetryEventApi extends RelayApi {
  EventPage? page;
  Completer<EventPage>? pending;
  bool fail = true;
  final List<int> cursors = [];
  @override
  Future<EventPage> pollEvents({
    required String deviceId,
    required int cursor,
  }) async {
    cursors.add(cursor);
    if (pending != null) return pending!.future;
    if (fail) throw const RelayApiException('temporary', 503, 'unavailable');
    return page ??
        EventPage(events: const [], nextCursor: cursor, hasMore: false);
  }
}
