import 'dart:io';
import 'package:crypto/crypto.dart' as hashes;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:relayune_mobile/src/storage/history_store.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';
import 'dart:convert';
import 'dart:async';

import 'package:flutter/widgets.dart';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/network/realtime_client.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/device_connection.dart';
import 'package:relayune_mobile/src/state/conversation_turn_status.dart';
import 'package:relayune_mobile/src/state/history_load_progress.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets(
    'encrypted history progress must bind every request route before updating the loader',
    (tester) async {
      final key = RelayKey.import(_testKey());
      final held = Completer<void>();
      final api = _HistoryRelayApi(key)..pendingResponse = held.future;
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      await controller.selectSession('session_root', waitForHistory: false);
      await tester.pump();
      final requestId = api.historyRequests.single;
      for (var route = 0; route < 5; route++) {
        final aad = RelayAad(
          direction: 'relay_to_web',
          type: 'session.event',
          deviceId: 'dev_test',
          sessionId: 'session_root',
          requestId: route == 3 ? 'other' : requestId,
          eventSeq: 5,
          createdAt: '2026-10-04T00:00:00Z',
          expiresAt: null,
        );
        final envelope = await RelayCipher().sealJson(key, {
          'type': 'session.event',
          'session_id': 'session_root',
          'request_id': route == 1 ? 'other' : requestId,
          'created_at': '2026-10-04T00:00:00Z',
          'event': {
            'kind': 'history.read_progress',
            'stage': 'reading',
            'request_id': route == 0 ? 'other' : requestId,
          },
        }, aad);
        api.eventPage = EventPage(
          events: [
            OpaqueFrame(
              cursor: 1,
              eventId: 'progress',
              deviceId: 'dev_test',
              sessionId: 'session_root',
              requestId: route == 2 ? 'other' : requestId,
              aad: aad,
              envelope: envelope,
            ),
          ],
          nextCursor: 1,
          hasMore: false,
        );
        if (route < 4) {
          await expectLater(
            controller.catchUpEventsForTesting(),
            throwsFormatException,
          );
          expect(controller.opaqueCursor, 0);
          expect(
            controller.historyProgressFor('session_root')!.phase,
            HistoryLoadPhase.waiting,
          );
        } else {
          await controller.catchUpEventsForTesting();
          expect(controller.opaqueCursor, 1);
          expect(
            controller.historyProgressFor('session_root')!.phase,
            HistoryLoadPhase.reading,
          );
          expect(controller.messages['session_root'], isNull);
        }
      }
      held.complete();
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      expect(controller.historyProgressFor('session_root'), isNull);
    },
  );

  testWidgets(
    'history progress follows its active request without becoming history or surviving completion',
    (tester) async {
      final key = RelayKey.import(_testKey());
      final held = Completer<void>();
      final api = _HistoryRelayApi(key)..pendingResponse = held.future;
      final controller = AppController(api: api)
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      await controller.selectSession('session_root', waitForHistory: false);
      await tester.pump();
      final requestId = api.historyRequests.single;
      expect(api.historyPayloads.single['include_progress'], isTrue);
      expect(
        controller.historyProgressFor('session_root')!.phase,
        HistoryLoadPhase.waiting,
      );
      for (final event in [
        _event('other', {
          'kind': 'history.read_progress',
          'request_id': 'another-request',
          'stage': 'reading',
        }, sourceSequence: 90),
        _event('unknown', {
          'kind': 'history.read_progress',
          'request_id': requestId,
          'stage': 'invented',
        }, sourceSequence: 91),
      ]) {
        controller.applyEventForTesting(event);
      }
      expect(
        controller.historyProgressFor('session_root')!.phase,
        HistoryLoadPhase.waiting,
      );
      controller.applyEventForTesting(
        _event('read', {
          'kind': 'history.read_progress',
          'request_id': requestId,
          'stage': 'reading',
        }, sourceSequence: 2),
      );
      expect(
        controller.historyProgressFor('session_root')!.phase,
        HistoryLoadPhase.reading,
      );
      controller.applyEventForTesting(
        _event('prepare', {
          'kind': 'history.read_progress',
          'request_id': requestId,
          'stage': 'preparing',
        }, sourceSequence: 3),
      );
      controller.applyEventForTesting(
        _event('late-queued', {
          'kind': 'history.read_progress',
          'request_id': requestId,
          'stage': 'queued',
        }, sourceSequence: 1),
      );
      expect(
        controller.historyProgressFor('session_root')!.phase,
        HistoryLoadPhase.preparing,
      );
      expect(controller.messages['session_root'], isNull);
      expect(controller.historyHasMore.containsKey('session_root'), isFalse);
      held.complete();
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      expect(controller.historyProgressFor('session_root'), isNull);
      controller.applyEventForTesting(
        _event('after-finish', {
          'kind': 'history.read_progress',
          'request_id': requestId,
          'stage': 'reading',
        }, sourceSequence: 4),
      );
      expect(controller.historyProgressFor('session_root'), isNull);
      expect(controller.messages['session_root']!.map((m) => m.id), [
        'hist_1',
        'hist_2',
      ]);
    },
  );

  testWidgets(
    'history byte progress uses authenticated source sizes and local transfer counts without stale totals',
    (tester) async {
      final key = RelayKey.import(_testKey());
      final held = Completer<void>();
      final api = _HistoryRelayApi(key)..pendingResponse = held.future;
      final controller = AppController(api: api)
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      await controller.selectSession('session_root', waitForHistory: false);
      await tester.pump();
      final requestId = api.historyRequests.single;
      controller.applyEventForTesting(
        _event('source', {
          'kind': 'history.read_progress',
          'request_id': requestId,
          'stage': 'reading',
          'source_read_bytes': 32000000,
          'source_total_bytes': 212000000,
        }, sourceSequence: 1),
      );
      expect(
        controller.historyProgressFor('session_root')!.sourceReadBytes,
        32000000,
      );
      controller.applyEventForTesting(
        _event('sending', {
          'kind': 'history.read_progress',
          'request_id': requestId,
          'stage': 'sending',
          'transfer_bytes': 300000,
        }, sourceSequence: 2),
      );
      expect(
        controller.historyProgressFor('session_root')!.phase,
        HistoryLoadPhase.transferring,
      );
      expect(
        controller.historyProgressFor('session_root')!.transferBytes,
        300000,
      );
      expect(
        controller.historyProgressFor('session_root')!.pendingReceiveBytes,
        isNull,
      );
      api.historyDownloadProgress!(const DownloadProgress(120000, 310000));
      expect(
        controller.historyProgressFor('session_root')!.pendingReceiveBytes,
        190000,
      );
      controller.applyEventForTesting(
        _event('late-reading', {
          'kind': 'history.read_progress',
          'request_id': requestId,
          'stage': 'reading',
          'source_read_bytes': 300,
          'source_total_bytes': 200,
        }, sourceSequence: 3),
      );
      expect(
        controller.historyProgressFor('session_root')!.phase,
        HistoryLoadPhase.transferring,
      );
      expect(
        controller.historyProgressFor('session_root')!.sourceReadBytes,
        32000000,
      );
      api.historyDownloadProgress!(const DownloadProgress(-1, 310000));
      expect(
        controller.historyProgressFor('session_root')!.receivedBytes,
        120000,
      );
      api.historyDownloadProgress!(const DownloadProgress(200000, null));
      expect(
        controller.historyProgressFor('session_root')!.receiveTotalBytes,
        isNull,
      );
      expect(
        controller.historyProgressFor('session_root')!.pendingReceiveBytes,
        isNull,
      );
      final late = api.historyDownloadProgress!;
      held.complete();
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      late(const DownloadProgress(310000, 310000));
      expect(controller.historyProgressFor('session_root'), isNull);
    },
  );

  testWidgets(
    'background history omits progress after repeated successful reads',
    (tester) async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key);
      final controller = AppController(api: api)
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      for (var i = 0; i < 3; i++) {
        await controller.loadHistory('session_root');
        expect(
          api.historyPayloads.last['include_progress'],
          isFalse,
          reason: 'background reads do not request progress events',
        );
      }
      final held = Completer<void>();
      api.pendingResponse = held.future;
      await controller.selectSession('session_root', waitForHistory: false);
      await tester.pump();
      expect(api.historyPayloads.last['include_progress'], isTrue);
      held.complete();
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      expect(controller.historyProgressFor('session_root'), isNull);
    },
  );

  test(
    'deep background releases only durable bodies and restores them locally before networking',
    () async {
      sqfliteFfiInit();
      final directory = await Directory.systemTemp.createTemp(
        'relayune-background-cache-',
      );
      final store = HistoryStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/history.sqlite',
      );
      final secure = _HistorySecureStore();
      final api = _HistoryRelayApi(RelayKey.import(_testKey()));
      final controller =
          AppController(api: api, secureStore: secure, historyStore: store)
            ..phase = AppPhase.ready
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = RelayKey.import(_testKey())
            ..activeSessionId = 'session_root';
      controller.applyEventForTesting(
        _event('saved', {
          'kind': 'message.completed',
          'item_id': 'answer',
          'turn_id': 'turn',
          'text': 'Cached answer',
        }),
      );
      await controller.flushHistoryCache();
      controller.messages['unsaved'] = [
        RelayMessage(
          id: 'unsaved',
          role: 'user',
          content: 'Keep input',
          kind: 'local.user.message',
          createdAt: '2026-10-01T00:00:00Z',
        ),
      ];
      final cacheKey = base64Decode(secure.keys.values.single);
      controller.setPresentationForeground(false);
      expect(
        controller.messages['session_root'],
        isNotEmpty,
        reason: 'warm background retains view data',
      );
      controller.releaseBackgroundMemory();
      expect(controller.backgroundMemoryReleased, isTrue);
      expect(controller.messages.containsKey('session_root'), isFalse);
      expect(controller.messages['unsaved']!.single.content, 'Keep input');
      expect(
        (await store.readRecent(
          cacheKey,
          'session_root',
        ))!.messages.single.content,
        'Cached answer',
      );
      controller.setPresentationForeground(true);
      await controller.loadHistory('session_root', localOnly: true);
      expect(
        controller.messages['session_root']!.single.content,
        'Cached answer',
      );
      expect(api.historyRequests, isEmpty);
      controller.dispose();
      await controller.flushHistoryCache();
      await store.close();
      await directory.delete(recursive: true);
    },
  );

  for (final failStorage in [false, true]) {
    test(
      'send persists exact sealed frame before transport and fails closed on disk failure: $failStorage',
      () async {
        sqfliteFfiInit();
        final directory = await Directory.systemTemp.createTemp(
          'relayune-pending-send-',
        );
        final store = HistoryStore(
          factory: databaseFactoryFfi,
          path: '${directory.path}/history.sqlite',
        );
        final secure = _HistorySecureStore();
        final api = _PendingHistoryApi(
          RelayKey.import(_testKey()),
          store,
          secure,
        );
        final controller =
            AppController(api: api, secureStore: secure, historyStore: store)
              ..phase = AppPhase.ready
              ..email = 'owner@example.com'
              ..bootstrap = _bootstrap()
              ..relayKey = RelayKey.import(_testKey())
              ..activeSessionId = 'session_root'
              ..sessions = [
                RelaySession.fromJson({
                  'id': 'session_root',
                  'name': 'Root',
                  'provider': 'codex',
                }),
              ];
        if (failStorage) {
          await (await store.database).execute(
            "CREATE TRIGGER fail_pending BEFORE INSERT ON history_pending BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
          );
        }
        final outcome = await controller.sendMessage('Protected input');
        expect(
          outcome,
          failStorage
              ? MessageSendOutcome.failed
              : MessageSendOutcome.delivered,
        );
        expect(api.submissions, failStorage ? 0 : 1);
        if (failStorage) {
          expect(controller.error, contains('消息未能保存到这台手机'));
          expect(controller.error, isNot(contains('fixture failure')));
          expect(
            controller.messages['session_root']!.single.deliveryState,
            MessageDeliveryState.failed,
          );
        }
        if (!failStorage) {
          final key = base64Decode(secure.keys.values.single);
          expect(await store.readPending(key, 'session_root'), hasLength(1));
          final clientId =
              controller.messages['session_root']!.single.clientMessageId;
          controller.applyEventForTesting(
            _event('confirmed', {
              'kind': 'user.message',
              'text': 'Protected input',
              'client_message_id': clientId,
            }),
          );
          await controller.flushHistoryCache();
          expect(await store.readPending(key, 'session_root'), isEmpty);
        }
        controller.dispose();
        await controller.flushHistoryCache();
        await store.close();
        await directory.delete(recursive: true);
      },
    );
  }

  test(
    'protected input bypasses an unrelated blocked checkpoint before transport',
    () async {
      sqfliteFfiInit();
      final store = _BlockedCheckpointStore();
      final secure = _HistorySecureStore();
      final key = RelayKey.import(_testKey());
      final api = _PendingHistoryApi(key, store, secure);
      final controller =
          AppController(api: api, secureStore: secure, historyStore: store)
            ..phase = AppPhase.ready
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = key
            ..activeSessionId = 'session_root'
            ..sessions = [
              RelaySession.fromJson({
                'id': 'session_root',
                'provider': 'codex',
              }),
            ];
      controller.applyEventForTesting(
        _event('checkpoint', {
          'kind': 'message.completed',
          'turn_id': 'old',
          'item_id': 'old',
          'text': 'Cache body',
        }),
      );
      final checkpoint = controller.flushHistoryCache();
      await store.entered.future.timeout(const Duration(seconds: 5));
      try {
        final outcome = await controller
            .sendMessage('Protected input')
            .timeout(const Duration(seconds: 2));
        expect(outcome, MessageSendOutcome.delivered);
        expect(store.pendingSaves, 2);
        expect(store.release.isCompleted, isFalse);
        expect(api.submissions, 1);
      } finally {
        store.release.complete();
        await checkpoint;
        controller.dispose();
        await controller.flushHistoryCache();
        await store.close();
      }
    },
  );

  for (final failCache in [false, true]) {
    test(
      'late cache cannot replace network bodies/frontier or live reply; failed=$failCache',
      () async {
        sqfliteFfiInit();
        final store = _BlockedHistoryStore()
          ..failRead = failCache
          ..recentPage = HistoryPage.fromJson({
            ..._historyPage(),
            'messages': [
              {
                ...(_historyPage()['messages'] as List).last as Map,
                'content': 'Stale cached answer',
                'source_sequence': 100,
              },
            ],
          });
        final key = RelayKey.import(_testKey());
        final controller =
            AppController(
                api: _HistoryRelayApi(key),
                secureStore: _HistorySecureStore(),
                historyStore: store,
              )
              ..phase = AppPhase.ready
              ..email = 'owner@example.com'
              ..bootstrap = _bootstrap()
              ..relayKey = key
              ..activeSessionId = 'session_root';
        final loading = controller.selectSession('session_root');
        await store.entered.future.timeout(const Duration(seconds: 5));
        await loading.timeout(const Duration(seconds: 2));
        expect(controller.messages['session_root']!.last.content, '早期回答');
        controller.applyEventForTesting(
          _event('start', {'kind': 'turn.started', 'turn_id': 'live'}),
        );
        controller.applyEventForTesting(
          _event('delta', {
            'kind': 'message.delta',
            'turn_id': 'live',
            'item_id': 'reply',
            'text': 'Current live text',
          }),
        );
        final live = controller.liveReplyText(
          'session_root',
          'agent_live_reply',
        );
        expect(live!.value, 'Current live text');
        store.release.complete();
        await store.finished.future.timeout(const Duration(seconds: 2));
        await Future<void>.delayed(const Duration(milliseconds: 40));
        expect(
          controller.messages['session_root']!
              .singleWhere((m) => m.id == 'hist_2')
              .content,
          '早期回答',
        );
        expect(controller.historyHasMore['session_root'], isFalse);
        expect(controller.historyCursors['session_root'], isNull);
        expect(live.value, 'Current live text');
        expect(controller.error, isEmpty);
        controller.dispose();
        await controller.flushHistoryCache();
        await store.close();
      },
    );
  }

  test(
    'memory entry records tap-to-frame separately from network refresh',
    () async {
      final key = RelayKey.import(_testKey());
      final held = Completer<void>();
      final api = _HistoryRelayApi(key)..pendingResponse = held.future;
      final controller = AppController(api: api)
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..messages['session_root'] = HistoryPage.fromJson(
          _historyPage(),
        ).messages;
      final selecting = controller.selectSession(
        'session_root',
        waitForHistory: false,
      );
      await selecting;
      controller.historyFrameDisplayed('session_root');
      final metric = controller.historyPerformance.last;
      expect(metric['source'], 'memory');
      expect(metric['selection_to_first_frame_ms'], isA<double>());
      expect(metric.containsKey('request_started_at_ms'), isFalse);
      held.complete();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      controller.dispose();
    },
  );

  for (final switchAuthorization in [false, true]) {
    test(
      'flush waits for protected sealed storage; changed authorization cannot submit=$switchAuthorization',
      () async {
        sqfliteFfiInit();
        final store = _HeldPendingStore(holdSave: switchAuthorization ? 1 : 2);
        final secure = _HistorySecureStore();
        final key = RelayKey.import(_testKey());
        final api = _PendingHistoryApi(key, store, secure);
        final controller =
            AppController(api: api, secureStore: secure, historyStore: store)
              ..phase = AppPhase.ready
              ..email = 'owner@example.com'
              ..bootstrap = _bootstrap()
              ..relayKey = key
              ..activeSessionId = 'session_root'
              ..sessions = [
                RelaySession.fromJson({
                  'id': 'session_root',
                  'provider': 'codex',
                }),
              ];
        final sending = controller.sendMessage('Protected input');
        await store.entered.future.timeout(const Duration(seconds: 5));
        var flushed = false;
        final flush = controller.flushHistoryCache().then((_) {
          flushed = true;
        });
        await Future<void>.delayed(const Duration(milliseconds: 30));
        expect(flushed, isFalse);
        expect(api.submissions, 0);
        if (switchAuthorization) {
          controller.bootstrap = const ServerBootstrap(
            email: 'owner@example.com',
            device: RelayDevice(
              id: 'another-device',
              name: 'Other',
              online: true,
              agentConnected: true,
              lastSeenAt: null,
            ),
            catalog: null,
            events: [],
            cursor: 0,
            ackSequence: 0,
            queuedCommands: 0,
          );
        }
        store.release.complete();
        expect(
          await sending,
          switchAuthorization
              ? MessageSendOutcome.failed
              : MessageSendOutcome.delivered,
        );
        await flush;
        expect(api.submissions, switchAuthorization ? 0 : 1);
        controller.dispose();
        await controller.flushHistoryCache();
        await store.close();
      },
    );
  }

  for (final deletionDuringFilter in [false, true]) {
    test(
      'snapshot preview never revives a committed/in-flight deletion; duringFilter=$deletionDuringFilter',
      () async {
        sqfliteFfiInit();
        final store = _DelayedSnapshotStore()
          ..holdSnapshot = !deletionDuringFilter
          ..holdFilter = deletionDuringFilter;
        final key = RelayKey.import(_testKey());
        final cacheKey = List<int>.generate(32, (i) => 31 - i);
        final secure = _HistorySecureStore();
        secure.keys[hashes.sha256
            .convert(utf8.encode('owner@example.com:dev_test:${key.keyId}'))
            .toString()] = base64Encode(
          cacheKey,
        );
        await store.appendPage(
          cacheKey,
          'session_root',
          null,
          HistoryPage.fromJson(_historyPage()),
        );
        final controller =
            AppController(
                api: _HistoryRelayApi(key),
                secureStore: secure,
                historyStore: store,
              )
              ..phase = AppPhase.ready
              ..email = 'owner@example.com'
              ..bootstrap = _bootstrap()
              ..relayKey = key
              ..activeSessionId = 'session_root'
              ..connectionSnapshot = const DeviceConnectionSnapshot(
                online: false,
                lastSeenAt: null,
                revision: 1,
                transport: RealtimeTransportState.connected,
                realtimeConfirmed: true,
              );
        var resurrected = false;
        controller.addListener(() {
          if (controller.messages['session_root']?.any(
                (m) => m.id == 'hist_1',
              ) ==
              true) {
            resurrected = true;
          }
        });
        final loading = controller.selectSession('session_root');
        await (deletionDuringFilter
                ? store.filterEntered.future
                : store.snapshotEntered.future)
            .timeout(const Duration(seconds: 5));
        controller.applyEventForTesting(
          _event('deleted', {
            'kind': 'message.deleted',
            'message_id': 'hist_1',
          }, sourceSequence: 2),
        );
        await controller.flushHistoryCache();
        if (deletionDuringFilter) {
          store.releaseFilter.complete();
        } else {
          store.releaseSnapshot.complete();
        }
        await loading;
        expect(resurrected, isFalse);
        expect(controller.messages['session_root']!.map((m) => m.id), [
          'hist_2',
        ]);
        controller.dispose();
        await controller.flushHistoryCache();
        await store.close();
      },
    );
  }

  test(
    'authorization invalidation discards a late decoded cache snapshot',
    () async {
      sqfliteFfiInit();
      final store = _BlockedHistoryStore();
      final key = RelayKey.import(_testKey());
      final controller =
          AppController(
              api: _HistoryRelayApi(key),
              secureStore: _HistorySecureStore(),
              historyStore: store,
            )
            ..phase = AppPhase.ready
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = key;
      final loading = controller.loadHistory('session_root');
      await store.entered.future.timeout(const Duration(seconds: 5));
      await loading;
      await controller.clearPairing();
      store.release.complete();
      await store.finished.future.timeout(const Duration(seconds: 2));
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(controller.messages, isEmpty);
      expect(controller.historyCursors, isEmpty);
      expect(controller.relayKey, isNull);
      controller.dispose();
      await store.close();
    },
  );

  for (final selfHosted in [false, true]) {
    test(
      'offline cold start shows encrypted local text before online identity responds and stays read-only selfHosted=$selfHosted',
      () async {
        sqfliteFfiInit();
        final directory = await Directory.systemTemp.createTemp(
          'relayune-offline-',
        );
        final store = HistoryStore(
          factory: databaseFactoryFfi,
          path: '${directory.path}/history.sqlite',
        );
        final secure = _OfflineHistorySecureStore();
        final cacheKey = List<int>.generate(32, (i) => 31 - i);
        final scope = hashes.sha256
            .convert(
              utf8.encode(
                'owner@example.com:dev_test:${RelayKey.import(_testKey()).keyId}',
              ),
            )
            .toString();
        secure.keys[scope] = base64Encode(cacheKey);
        await store.appendPage(
          cacheKey,
          'session_root',
          null,
          HistoryPage.fromJson(_historyPage()),
        );
        // The initial bootstrap has a visible catalog, but its first directory
        // request has not finished when the user backgrounds/exits the app.
        final warm = AppController(secureStore: secure, historyStore: store)
          ..phase = AppPhase.ready
          ..email = 'owner@example.com'
          ..bootstrap = _bootstrap()
          ..relayKey = RelayKey.import(_testKey())
          ..sessions = [relaySession(id: 'session_root', name: 'Saved task')];
        await warm.loadHistory('session_root', localOnly: true);
        await warm.flushHistoryCache();
        final savedDirectory = (await store.readSessionDirectory(cacheKey))!;
        expect(
          (savedDirectory['sessions'] as List).single['id'],
          'session_root',
        );
        expect(savedDirectory['revision'], isNull);
        expect(savedDirectory['cursor'], isNull);
        warm.dispose();
        await warm.flushHistoryCache();
        await store.close();
        final api = _OfflineHistoryApi(
          RelayKey.import(_testKey()),
          selfHosted: selfHosted,
        );
        final controller = AppController(
          api: api,
          secureStore: secure,
          historyStore: store,
        );
        final initializing = controller.initialize();
        await api.identityEntered.future.timeout(const Duration(seconds: 5));
        expect(controller.phase, AppPhase.ready);
        expect(controller.localReadOnly, isTrue);
        expect(controller.messages['session_root'], isNull);
        await controller.selectSession('session_root');
        expect(controller.messages['session_root']!.last.content, '早期回答');
        expect(controller.runningSessions, isEmpty);
        expect(controller.deviceOnline, isFalse);
        await expectLater(
          controller.sendEncryptedCommand(
            'session.interrupt_turn',
            'session_root',
            {},
          ),
          throwsStateError,
        );
        expect(api.historyRequests, isEmpty);
        api.identityRelease.complete();
        await initializing;
        expect(controller.phase, AppPhase.ready);
        expect(controller.localReadOnly, isTrue);
        controller.dispose();
        await controller.flushHistoryCache();
        await store.close();
        await directory.delete(recursive: true);
      },
    );
  }

  test(
    'streaming checkpoints occur before an uninterrupted reply becomes idle',
    () async {
      sqfliteFfiInit();
      final directory = await Directory.systemTemp.createTemp(
        'relayune-checkpoint-',
      );
      final store = HistoryStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/history.sqlite',
      );
      final secure = _HistorySecureStore();
      final controller = AppController(historyStore: store, secureStore: secure)
        ..phase = AppPhase.ready
        ..email = 'owner@example.com'
        ..bootstrap = _bootstrap()
        ..relayKey = RelayKey.import(_testKey())
        ..activeSessionId = 'session_root';
      for (var i = 0; i < 28; i++) {
        controller.applyEventForTesting(
          _event('stream-$i', {
            'kind': 'message.delta',
            'turn_id': 'long',
            'item_id': 'reply',
            'text': '字',
          }, sourceSequence: i + 1),
        );
        await Future<void>.delayed(const Duration(milliseconds: 80));
      }
      expect(
        (await store.statistics())['messages'],
        1,
        reason: '300ms quiet debounce has never fired',
      );
      final key = base64Decode(secure.keys.values.single);
      final checkpoint = (await store.readRecent(
        key,
        'session_root',
      ))!.messages.single;
      expect(checkpoint.content.length, greaterThanOrEqualTo(20));
      expect(checkpoint.sourceSequence, greaterThanOrEqualTo(20));
      await controller.flushHistoryCache();
      expect(
        (await store.readRecent(
          key,
          'session_root',
        ))!.messages.single.content.length,
        28,
      );
      expect((await store.statistics())['messages'], 1);
      controller.dispose();
      await controller.flushHistoryCache();
      await store.close();
      await directory.delete(recursive: true);
    },
  );

  test(
    'authenticated older delta cannot regress either message or live presentation',
    () async {
      final controller = AppController()
        ..phase = AppPhase.ready
        ..activeSessionId = 'session_root';
      addTearDown(controller.dispose);
      controller.setPresentationForeground(false);
      controller.applyEventForTesting(
        _event('new', {
          'kind': 'message.delta',
          'turn_id': 't',
          'item_id': 'i',
          'text': 'new',
        }, sourceSequence: 20),
      );
      controller.applyEventForTesting(
        _event('old', {
          'kind': 'message.delta',
          'turn_id': 't',
          'item_id': 'i',
          'text': 'old',
        }, sourceSequence: 19),
      );
      expect(controller.messages['session_root']!.single.content, 'new');
      expect(
        controller.liveReplyText('session_root', 'agent_t_i')!.value,
        'new',
      );
    },
  );

  test(
    'native history can correct a cached body without requiring prefix extension',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)
        ..responsePayload = {
          ..._historyPage(),
          'messages': [
            {
              'id': 'agent_t_i',
              'role': 'codex',
              'content': 'Correct final',
              'turn_id': 't',
              'kind': 'message.completed',
              'created_at': '2026-08-12T10:00:00Z',
            },
          ],
        };
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      controller.applyEventForTesting(
        _event('old', {
          'kind': 'message.delta',
          'turn_id': 't',
          'item_id': 'i',
          'text': 'Old and longer incorrect prefix',
        }, sourceSequence: 20),
      );
      await controller.loadHistory('session_root');
      expect(
        controller.messages['session_root']!.single.content,
        'Correct final',
      );
      expect(controller.messages['session_root']!.single.sourceSequence, 20);
    },
  );

  testWidgets(
    'foreground recovery displays the final answer and clears running in the conversation',
    (tester) async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key);
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..activeSessionId = 'session_root'
        ..sessions = [
          RelaySession.fromJson({
            'id': 'session_root',
            'name': 'Task',
            'provider': 'codex',
          }),
        ];
      addTearDown(controller.dispose);
      controller.markHistoryLoadedForTesting('session_root');
      controller.applyEventForTesting(
        _event('start-away', {'kind': 'turn.started', 'turn_id': 'away'}),
      );
      controller.applyEventForTesting(
        _event('partial-away', {
          'kind': 'message.delta',
          'turn_id': 'away',
          'item_id': 'reply',
          'text': 'Partial reply',
        }),
      );
      await pumpWorkbench(tester, controller);
      await tester.pump();
      expect(find.text('Partial reply'), findsOneWidget);
      controller.setPresentationForeground(false);
      api.responsePayload = {
        ..._historyPage(),
        'messages': [
          {
            'id': 'agent_away_reply',
            'role': 'codex',
            'content': 'Partial reply completed while away',
            'turn_id': 'away',
            'kind': 'message.completed',
            'created_at': '2026-08-12T10:01:00Z',
          },
        ],
      };
      controller.setPresentationForeground(true);
      await tester.runAsync(controller.resumeRealtime);
      await tester.pump();
      expect(find.text('Partial reply completed while away'), findsOneWidget);
      expect(find.text('Partial reply'), findsNothing);
      expect(controller.runningSessions, isEmpty);
      expect(
        find.byKey(const ValueKey('assistant-live-activity')),
        findsNothing,
      );
      await tester.pumpWidget(const SizedBox());
    },
  );

  for (final sameId in [true, false]) {
    test(
      'recovered history replaces a stale live presentation; sameId=$sameId',
      () async {
        final key = RelayKey.import(_testKey());
        final api = _HistoryRelayApi(key);
        final controller = AppController(api: api)
          ..phase = AppPhase.ready
          ..bootstrap = _bootstrap()
          ..relayKey = key
          ..activeSessionId = 'session_root';
        addTearDown(controller.dispose);
        controller.applyEventForTesting(
          _event('partial', {
            'kind': 'message.delta',
            'turn_id': 'away',
            'item_id': 'reply',
            'text': 'Partial',
          }),
        );
        controller.setPresentationForeground(false);
        final old = controller.liveReplyText(
          'session_root',
          'agent_away_reply',
        )!;
        expect(old.value, 'Partial');
        controller.setPresentationForeground(true);
        api.responsePayload = {
          ..._historyPage(),
          'messages': [
            {
              'id': sameId ? 'agent_away_reply' : 'persisted-reply',
              'role': 'codex',
              'content': 'Partial completed while away',
              'turn_id': 'away',
              'kind': 'message.completed',
              'created_at': '2026-08-12T10:01:00Z',
            },
          ],
        };
        await controller.loadHistory('session_root');
        expect(
          controller.liveReplyText('session_root', 'agent_away_reply'),
          isNull,
          reason: 'old reveal text must not override the recovered snapshot',
        );
        expect(
          controller.messages['session_root']!.last.content,
          'Partial completed while away',
        );
      },
    );
  }

  test(
    'a live reply after history recovery keeps its restored prefix',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)
        ..responsePayload = {
          ..._historyPage(),
          'messages': [
            {
              'id': 'agent_away_reply',
              'role': 'codex',
              'content': 'Restored prefix',
              'turn_id': 'away',
              'kind': 'message.delta',
              'created_at': '2026-08-12T10:01:00Z',
            },
          ],
        };
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..activeSessionId = 'session_root';
      addTearDown(controller.dispose);
      await controller.loadHistory('session_root');
      controller.setPresentationForeground(false);
      controller.applyEventForTesting(
        _event('continued', {
          'kind': 'message.delta',
          'turn_id': 'away',
          'item_id': 'reply',
          'text': ' and new output',
        }),
      );
      expect(
        controller.liveReplyText('session_root', 'agent_away_reply')!.value,
        'Restored prefix and new output',
      );
    },
  );

  test('concurrent history callers await one shared read', () async {
    final key = RelayKey.import(_testKey());
    final held = Completer<void>();
    final api = _HistoryRelayApi(key)
      ..pendingResponse = held.future
      ..pendingCode = 'response_wait_timeout';
    final controller = AppController(api: api)
      ..bootstrap = _bootstrap()
      ..relayKey = key;
    addTearDown(controller.dispose);
    final first = controller.selectSession('session_root');
    for (var i = 0; i < 100 && api.responseReads == 0; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    var joinedFinished = false;
    final joined = controller
        .loadHistory('session_root')
        .then((_) => joinedFinished = true);
    try {
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(joinedFinished, isFalse);
      expect(api.historyRequests, hasLength(1));
      held.complete();
      await Future.wait([first, joined]);
      expect(controller.messages['session_root'], hasLength(2));
    } finally {
      if (!held.isCompleted) held.complete();
      await Future.wait([first, joined]);
    }
  });
  test(
    'history completion expires even when authenticated deletion lookup stalls',
    () async {
      sqfliteFfiInit();
      final store = _BlockedDeletionStore()..block = true;
      await store.database;
      final key = RelayKey.import(_testKey());
      final controller =
          AppController(
              api: _HistoryRelayApi(key),
              secureStore: _HistorySecureStore(),
              historyStore: store,
              historyReadTimeout: const Duration(milliseconds: 500),
            )
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = key;
      final loading = controller.selectSession('session_root');
      await store.entered.future.timeout(const Duration(seconds: 5));
      expect(
        controller.historyProgressFor('session_root')?.phase,
        HistoryLoadPhase.preparing,
      );
      try {
        await loading.timeout(const Duration(seconds: 2));
        expect(controller.historyLoading, isEmpty);
        expect(controller.historyProgressFor('session_root'), isNull);
        expect(controller.messages['session_root'], isNull);
      } finally {
        store.release.complete();
        await loading;
        await Future<void>.delayed(const Duration(milliseconds: 30));
        expect(
          controller.messages['session_root'],
          isNull,
          reason: 'Late result cannot reopen a finished read',
        );
        controller.dispose();
        await controller.flushHistoryCache();
        await store.close();
      }
    },
  );

  test(
    'failed network read finishes without waiting for an unfinished cache restore',
    () async {
      sqfliteFfiInit();
      final store = _BlockedHistoryStore();
      final key = RelayKey.import(_testKey());
      final api = _UnreachableHistoryRelayApi(key)
        ..beforeFailure = store.entered.future;
      final controller =
          AppController(
              api: api,
              secureStore: _HistorySecureStore(),
              historyStore: store,
            )
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = key;
      final loading = controller.loadHistory('session_root');
      await store.entered.future;
      try {
        await loading.timeout(const Duration(milliseconds: 500));
        expect(controller.historyLoading, isEmpty);
      } finally {
        store.release.complete();
        await loading;
        controller.dispose();
        await controller.flushHistoryCache();
        await store.close();
      }
    },
  );

  test(
    'network completion preserves protected input without waiting for cached bodies',
    () async {
      sqfliteFfiInit();
      final store = _BlockedHistoryStore();
      final secure = _HistorySecureStore();
      final key = RelayKey.import(_testKey());
      final held = Completer<void>();
      final api = _HistoryRelayApi(key)
        ..pendingResponse = held.future
        ..pendingCode = 'response_wait_timeout';
      final controller =
          AppController(api: api, secureStore: secure, historyStore: store)
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = key;
      final loading = controller.selectSession('session_root');
      await store.entered.future;
      final cacheKey = base64Decode(secure.keys.values.single);
      await store.savePending(
        cacheKey,
        'session_root',
        RelayMessage(
          id: 'local_input',
          role: 'user',
          content: 'Protected draft',
          createdAt: '2026-10-05T00:00:00Z',
          kind: 'local.user.message',
          clientMessageId: 'input',
        ),
        {'request_id': 'input'},
      );
      try {
        held.complete();
        await loading.timeout(const Duration(seconds: 2));
        expect(store.release.isCompleted, isFalse);
        final pending = controller.messages['session_root']!.singleWhere(
          (m) => m.id == 'local_input',
        );
        expect(pending.content, 'Protected draft');
        expect(pending.deliveryState, MessageDeliveryState.unconfirmed);
      } finally {
        if (!held.isCompleted) held.complete();
        store.release.complete();
        await loading;
        await store.finished.future;
        controller.dispose();
        await controller.flushHistoryCache();
        await store.close();
      }
    },
  );

  test(
    'background cancels the old history owner before a new read starts',
    () async {
      sqfliteFfiInit();
      final store = HistoryStore(
        factory: databaseFactoryFfi,
        path: inMemoryDatabasePath,
      );
      final key = RelayKey.import(_testKey());
      final oldResponse = Completer<void>(), newResponse = Completer<void>();
      final api = _HistoryRelayApi(key)..pendingResponse = oldResponse.future;
      final controller =
          AppController(
              api: api,
              secureStore: _HistorySecureStore(),
              historyStore: store,
            )
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = key;
      final oldRead = controller.selectSession('session_root');
      Future<void> waitForReads(int count) async {
        for (var i = 0; i < 100 && api.responseReads < count; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
        expect(api.responseReads, count);
      }

      await waitForReads(1);
      controller.setPresentationForeground(false);
      expect(controller.historyLoading, isEmpty);
      expect(controller.historyProgressFor('session_root'), isNull);
      controller.setPresentationForeground(true, resumeTransport: false);
      api.pendingResponse = newResponse.future;
      final newRead = controller.loadHistory('session_root');
      await waitForReads(2);
      final newRequest = controller
          .historyProgressFor('session_root')!
          .requestId;
      try {
        oldResponse.complete();
        await oldRead.timeout(const Duration(seconds: 2));
        expect(controller.messages['session_root'], isNull);
        expect(controller.historyLoading, contains('session_root'));
        expect(
          controller.historyProgressFor('session_root')!.requestId,
          newRequest,
        );
        newResponse.complete();
        await newRead.timeout(const Duration(seconds: 2));
        expect(controller.historyLoading, isEmpty);
        expect(controller.messages['session_root'], hasLength(2));
      } finally {
        if (!oldResponse.isCompleted) oldResponse.complete();
        if (!newResponse.isCompleted) newResponse.complete();
        await Future.wait([oldRead, newRead]);
        controller.dispose();
        await controller.flushHistoryCache();
        await store.close();
      }
    },
  );

  test(
    'terminal events update hidden state without reading hidden history',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key);
      final controller = AppController(api: api)
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      await controller.selectSession('session_root');
      controller.historyViewportHidden('session_root');
      final requests = api.historyRequests.length;
      controller.applyEventForTesting(
        _event('finished-hidden', {
          'kind': 'codex.persisted',
          'operation': 'thread',
          'persisted': true,
        }),
      );
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(api.historyRequests, hasLength(requests));
      expect(controller.historyLoading, isEmpty);
    },
  );
  test(
    'network first frame bypasses blocked cache and keeps its frontier',
    () async {
      sqfliteFfiInit();
      final store = _BlockedHistoryStore();
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key);
      final controller =
          AppController(
              api: api,
              secureStore: _HistorySecureStore(),
              historyStore: store,
            )
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = key;
      addTearDown(() async {
        controller.dispose();
        await store.close();
      });
      final loading = controller.loadHistory('session_root');
      await store.entered.future.timeout(const Duration(seconds: 5));
      try {
        for (var i = 0; i < 100 && api.responseReads == 0; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
        expect(api.historyRequests, hasLength(1));
        expect(api.responseReads, greaterThan(0));
        await loading.timeout(const Duration(seconds: 2));
        expect(controller.messages['session_root'], hasLength(2));
        expect(controller.historyHasMore['session_root'], isFalse);
      } finally {
        store.release.complete();
        for (var i = 0; i < 100 && store.recentReads == 0; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
      }
      expect(store.recentReads, 1);
      expect(controller.messages['session_root'], hasLength(2));
      expect(controller.historyHasMore['session_root'], isFalse);
    },
  );

  for (final status in ['completed', 'interrupted', 'failed']) {
    test(
      'terminal $status persists once and cannot clear a newer active turn',
      () async {
        final controller = AppController()..phase = AppPhase.ready;
        addTearDown(controller.dispose);
        controller.applyEventForTesting(
          _event('started', {'kind': 'turn.started', 'turn_id': 'old'}),
        );
        final outcome = {
          'kind': status == 'failed' ? 'turn.failed' : 'turn.completed',
          'turn_id': 'old',
          'status': status,
        };
        controller.applyEventForTesting(_event('ended-1', outcome));
        controller.applyEventForTesting(_event('ended-2', outcome));
        final terminal = controller.messages['session_root']!.single;
        expect(terminal.turnStatus, status);
        final restored = RelayMessage.fromHistory(
          HistoryStore.encodeMessage(terminal),
        );
        expect(
          conversationTurnStatus([restored], active: false, online: false),
          {
            'completed': ConversationTurnStatus.completed,
            'interrupted': ConversationTurnStatus.stopped,
            'failed': ConversationTurnStatus.interrupted,
          }[status],
        );
        controller.applyEventForTesting(
          _event('new-start', {'kind': 'turn.started', 'turn_id': 'new'}),
        );
        controller.applyEventForTesting(_event('late-old-end', outcome));
        expect(controller.runningSessions, contains('session_root'));
        expect(controller.messages['session_root'], hasLength(1));
      },
    );
  }

  test(
    'notification selection completes while history response is pending',
    () async {
      final key = RelayKey.import(_testKey());
      final held = Completer<void>();
      final api = _HistoryRelayApi(key)..pendingResponse = held.future;
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ];
      addTearDown(controller.dispose);
      await controller.selectSession('session_root', waitForHistory: false);
      controller.requestWorkbenchTarget('conversation');
      expect(controller.activeSessionId, 'session_root');
      expect(controller.workbenchNavigationRevision, greaterThan(0));
      expect(controller.historyLoading, contains('session_root'));
      expect(held.isCompleted, isFalse);
      while (api.responseReads == 0) {
        await Future<void>.delayed(const Duration(milliseconds: 1));
      }
      held.complete();
      while (controller.historyLoading.contains('session_root')) {
        await Future<void>.delayed(const Duration(milliseconds: 1));
      }
      expect(controller.messages['session_root'], hasLength(2));
      expect(api.historyRequests, hasLength(1));
    },
  );

  test(
    'Home resume reconnects without reading the retained selection',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key);
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ];
      addTearDown(controller.dispose);
      await controller.selectSession('session_root');
      controller.historyViewportHidden('session_root');
      controller.setPresentationForeground(false);
      controller.setPresentationForeground(true, resumeTransport: false);
      await controller.resumeRealtime(restoreConversation: false);
      expect(api.historyRequests, hasLength(1));
      expect(controller.activeSessionId, 'session_root');
      await controller.selectSession('session_root');
      expect(api.historyRequests, hasLength(2));
    },
  );

  test(
    'a hidden cache restore offers its preview before the full snapshot',
    () async {
      sqfliteFfiInit();
      final store = _PreviewBeforeSnapshotStore();
      final controller =
          AppController(
              api: _HistoryRelayApi(RelayKey.import(_testKey())),
              secureStore: _HistorySecureStore(),
              historyStore: store,
            )
            ..phase = AppPhase.ready
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = RelayKey.import(_testKey())
            ..sessions = [
              RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
            ];
      addTearDown(() async {
        if (!store.release.isCompleted) store.release.complete();
        controller.dispose();
        await controller.flushHistoryCache();
        await store.close();
      });
      final restoring = controller.loadHistory('session_root', localOnly: true);
      await store.entered.future;
      expect(
        controller.historyProgressFor('session_root')!.phase,
        HistoryLoadPhase.restoring,
      );
      for (
        var attempt = 0;
        attempt < 100 && controller.messages['session_root'] == null;
        attempt++
      ) {
        await Future<void>.delayed(const Duration(milliseconds: 1));
      }
      expect(store.release.isCompleted, isFalse);
      expect(controller.messages['session_root'], hasLength(1));
      expect(controller.historyHasMore['session_root'], isNot(false));
      await controller.selectSession('session_root', waitForHistory: false);
      controller.historyFrameDisplayed('session_root');
      expect(controller.historyPerformance.last['source'], 'memory');
      store.release.complete();
      await restoring;
      expect(controller.messages['session_root'], hasLength(2));
      expect(controller.historyCursors['session_root'], 'older');
      expect(controller.historyHasMore['session_root'], isTrue);
    },
  );

  test(
    'foreground resume refreshes an already loaded conversation without terminal events',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key);
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ];
      addTearDown(controller.dispose);
      await controller.selectSession('session_root');
      controller.applyEventForTesting(
        _event('start', {'kind': 'turn.started', 'turn_id': 'offline-turn'}),
      );
      controller.applyEventForTesting(
        _event('command', {
          'kind': 'command.started',
          'turn_id': 'offline-turn',
          'item_id': 'tool',
          'command': 'fixture command',
        }),
      );
      controller.pauseRealtime();
      api.responsePayload = {
        ..._historyPage(),
        'messages': [
          ..._historyPage()['messages'] as List,
          {
            'id': 'command_offline-turn_tool',
            'role': 'system',
            'content': 'tool result',
            'turn_id': 'offline-turn',
            'kind': 'command.completed',
            'tool_activity_status': 'completed',
            'tool_activity_detail': 'finished',
            'created_at': '2026-08-12T10:01:00Z',
          },
          {
            'id': 'offline-final',
            'role': 'codex',
            'content': 'Completed while away',
            'turn_id': 'offline-turn',
            'kind': 'message.completed',
            'created_at': '2026-08-12T10:05:00Z',
          },
        ],
      };
      await controller.resumeRealtime();
      expect(api.historyRequests, hasLength(2));
      final tool = controller.messages['session_root']!.singleWhere(
        (message) => message.id == 'command_offline-turn_tool',
      );
      expect(tool.toolActivityStatus, 'completed');
      expect(tool.toolActivityDetail, 'finished');
      expect(
        controller.messages['session_root']!.last.content,
        'Completed while away',
      );
      expect(controller.runningSessions, isEmpty);
    },
  );

  test(
    'Claude history fills configuration choices missing from bootstrap catalog',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)
        ..responsePayload = {
          ..._historyPage(),
          'sessions': [
            {
              'id': 'session_root',
              'name': 'Root',
              'provider': 'claude',
              'session_config_options': [
                {
                  'id': 'model',
                  'currentValue': 'haiku',
                  'options': [
                    {'value': 'default'},
                    {'value': 'haiku'},
                  ],
                },
                {
                  'id': 'permissions',
                  'currentValue': 'manual',
                  'options': [
                    {'value': 'inherit'},
                    {'value': 'manual'},
                  ],
                },
              ],
            },
          ],
        };
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({
            'id': 'session_root',
            'name': 'Root',
            'provider': 'claude',
            'session_config_options': [
              {
                'id': 'permissions',
                'currentValue': 'inherit',
                'options': [
                  {'value': 'inherit'},
                ],
              },
            ],
          }),
        ];
      addTearDown(controller.dispose);
      final initialCatalog = controller.sessions;
      await controller.loadHistory('session_root');
      controller.replaceSessionsForTesting(initialCatalog);
      final options =
          controller.sessions.single.raw['session_config_options'] as List;
      expect(options.map((item) => item['id']), contains('model'));
      expect(
        options.firstWhere((item) => item['id'] == 'model')['currentValue'],
        'default',
      );
      expect(
        options.firstWhere(
          (item) => item['id'] == 'permissions',
        )['currentValue'],
        'inherit',
      );
      expect(
        (options.firstWhere((item) => item['id'] == 'permissions')['options']
                as List)
            .length,
        2,
      );
    },
  );

  test(
    'cached optimistic user message cannot replace a confirmed echo',
    () async {
      sqfliteFfiInit();
      final directory = await Directory.systemTemp.createTemp(
        'relayune-cache-echo-',
      );
      final store = HistoryStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/history.sqlite',
      );
      final secure = _HistorySecureStore();
      final key = RelayKey.import(_testKey());
      final local = {
        'id': 'local_client_a',
        'role': 'user',
        'content': 'same text',
        'created_at': '2026-08-12T10:00:00.000Z',
        'kind': 'local.user.message',
        'client_message_id': 'client_a',
      };
      final cachedApi = _HistoryRelayApi(key)
        ..responsePayload = {
          ..._historyPage(),
          'messages': [local],
        };
      final first =
          AppController(
              api: cachedApi,
              secureStore: secure,
              historyStore: store,
            )
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = key;
      await first.loadHistory('session_root');
      await first.flushHistoryCache();
      first.dispose();
      await store.close();
      final nextStore = HistoryStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/history.sqlite',
      );
      final held = Completer<void>();
      final api = _HistoryRelayApi(key)
        ..pendingResponse = held.future
        ..responsePayload = {
          ..._historyPage(),
          'messages': [
            {...local, 'id': 'confirmed_a', 'kind': 'user.message'},
          ],
        };
      final next =
          AppController(api: api, secureStore: secure, historyStore: nextStore)
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = key;
      next.messages['session_root'] = [
        HistoryPage.fromJson({
          'messages': [
            {...local, 'id': 'confirmed_a', 'kind': 'user.message'},
          ],
        }).messages.single,
        HistoryPage.fromJson({
          'messages': [
            {
              ...local,
              'id': 'confirmed_b',
              'kind': 'user.message',
              'client_message_id': 'client_b',
            },
          ],
        }).messages.single,
      ];
      final loading = next.loadHistory('session_root');
      while (api.responseReads == 0) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      final restoredIds = next.messages['session_root']!
          .map((message) => message.id)
          .toList();
      held.complete();
      await loading;
      await next.flushHistoryCache();
      final finalIds = next.messages['session_root']!
          .map((message) => message.id)
          .toList();
      next.dispose();
      await nextStore.close();
      await directory.delete(recursive: true);
      expect(restoredIds, unorderedEquals(['confirmed_a', 'confirmed_b']));
      expect(finalIds, unorderedEquals(['confirmed_a', 'confirmed_b']));
    },
  );

  test(
    '[MOB-MSG-004][flutter] SQLite restores before network response and serves only contiguous cached older pages',
    () async {
      sqfliteFfiInit();
      final directory = await Directory.systemTemp.createTemp(
        'relayune-controller-cache-',
      );
      final store = HistoryStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/history.sqlite',
      );
      final secure = _HistorySecureStore();
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)
        ..responsePayload = {
          ..._historyPage(),
          'next_cursor': 'older',
          'has_more': true,
        };
      final controller =
          AppController(api: api, secureStore: secure, historyStore: store)
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = key;
      await controller.loadHistory('session_root');
      api.responsePayload = {
        ..._historyPage(),
        'next_cursor': 'gap',
        'has_more': true,
      };
      await controller.loadHistory('session_root', earlier: true);
      await controller.flushHistoryCache();
      controller.dispose();
      await store.close();
      final nextStore = HistoryStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/history.sqlite',
      );
      final nextKey = RelayKey.import(_testKey());
      final nextApi = _HistoryRelayApi(nextKey);
      final held = Completer<void>();
      nextApi.pendingResponse = held.future;
      final next =
          AppController(
              api: nextApi,
              secureStore: secure,
              historyStore: nextStore,
            )
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = nextKey;
      final loading = next.loadHistory('session_root');
      for (var i = 0; i < 1000 && next.messages['session_root'] == null; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      expect(held.isCompleted, isFalse);
      expect(
        next.messages['session_root'],
        hasLength(2),
        reason: 'cache must appear while response is blocked',
      );
      next.historyFrameDisplayed('session_root');
      expect(
        next.historyPerformance.last['source'],
        anyOf('sqlite', 'sqlite-preview'),
      );
      nextApi.responsePayload = {
        ..._historyPage(),
        'next_cursor': 'older',
        'has_more': true,
      };
      held.complete();
      await loading;
      final requests = nextApi.historyRequests.length;
      await next.loadHistory('session_root', earlier: true);
      expect(
        nextApi.historyRequests.length,
        requests,
        reason: 'known older page uses no command',
      );
      expect(next.historyCursors['session_root'], 'gap');
      await next.loadHistory('session_root', earlier: true);
      expect(
        nextApi.historyRequests.length,
        requests + 1,
        reason: 'gap must request the Desktop',
      );
      await next.flushHistoryCache();
      next.dispose();
      await nextStore.close();
      await directory.delete(recursive: true);
    },
  );

  test(
    '[MOB-MSG-004][flutter] unpair invalidates cache key and ignores a late history response',
    () async {
      sqfliteFfiInit();
      final directory = await Directory.systemTemp.createTemp(
        'relayune-controller-revoke-',
      );
      final store = HistoryStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/history.sqlite',
      );
      final secure = _HistorySecureStore();
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key);
      final controller =
          AppController(api: api, secureStore: secure, historyStore: store)
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = key;
      await controller.loadHistory('session_root');
      await controller.flushHistoryCache();
      expect(secure.keys, isNotEmpty);
      final held = Completer<void>();
      api.pendingResponse = held.future;
      final loading = controller.loadHistory('session_root');
      while (api.pendingResponse != null) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      await controller.clearPairing();
      held.complete();
      // The pending encrypted operation may fail once its transport key is gone.
      await loading.catchError((_) {});
      expect(secure.keys, isEmpty);
      expect(controller.messages, isEmpty);
      expect(
        (await (await store.database).query('history_log')).length,
        0,
        reason: 'revocation physically removes the encrypted namespace',
      );
      controller.dispose();
      await store.close();
      await directory.delete(recursive: true);
    },
  );

  test(
    '[MOB-MSG-004][flutter] background prefetch navigation wait is not reported as foreground loading',
    () async {
      final key = RelayKey.import(_testKey());
      final controller = AppController(api: _HistoryRelayApi(key))
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      await controller.loadHistory('session_root');
      controller.historyFrameDisplayed('session_root');
      expect(
        controller.historyPerformance.last.containsKey('display_ms'),
        isFalse,
      );
      expect(
        controller.historyPerformance.last.containsKey(
          'deferred_display_since_request_ms',
        ),
        isTrue,
      );
      await controller.selectSession('session_root');
      await controller.loadHistory('session_root', silent: true);
      controller.historyFrameDisplayed('session_root');
      expect(controller.historyPerformance.last['request_visible'], isTrue);
      expect(
        controller.historyPerformance.last.containsKey('display_ms'),
        isTrue,
      );
      expect(
        controller.historyPerformance.last.containsKey(
          'deferred_display_since_request_ms',
        ),
        isFalse,
      );
    },
  );

  for (final exhausted in [false, true]) {
    test(
      '[MOB-MSG-004][flutter] latest refresh preserves the older-page frontier (exhausted=$exhausted)',
      () async {
        final key = RelayKey.import(_testKey());
        final api = _HistoryRelayApi(key)
          ..responsePayload = {
            ..._historyPage(),
            'next_cursor': 'page-1',
            'has_more': true,
          };
        final controller = AppController(api: api)
          ..bootstrap = _bootstrap()
          ..relayKey = key;
        addTearDown(controller.dispose);
        await controller.loadHistory('session_root');
        api.responsePayload = {
          ..._historyPage(),
          'next_cursor': exhausted ? null : 'page-2',
          'has_more': !exhausted,
        };
        await controller.loadHistory('session_root', earlier: true);
        api.responsePayload = {
          ..._historyPage(),
          'next_cursor': 'page-1',
          'has_more': true,
        };
        await controller.loadHistory('session_root', silent: true);
        expect(
          controller.historyCursors['session_root'],
          exhausted ? null : 'page-2',
        );
        expect(controller.historyHasMore['session_root'], !exhausted);
        final count = api.historyRequests.length;
        await controller.loadHistory('session_root', earlier: true);
        expect(api.historyRequests.length, exhausted ? count : count + 1);
        if (!exhausted) expect(api.historyPayloads.last['before'], 'page-2');
      },
    );
  }

  test(
    'a disjoint latest page reopens an exhausted continuation without losing old messages',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)
        ..responsePayload = {
          ..._historyPage(),
          'messages': [(_historyPage()['messages'] as List).first],
        };
      final controller = AppController(api: api)
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      await controller.loadHistory('session_root');
      expect(controller.historyHasMore['session_root'], isFalse);
      api.responsePayload = {
        ..._historyPage(),
        'messages': List.generate(
          500,
          (i) => {
            'id': 'new-$i',
            'role': 'codex',
            'content': 'New message $i',
            'kind': 'message.completed',
            'created_at': DateTime.utc(
              2026,
              10,
              1,
            ).add(Duration(seconds: i)).toIso8601String(),
          },
        ),
        'has_more': true,
        'next_cursor': 'gap',
      };
      await controller.loadHistory('session_root');
      expect(api.historyPayloads.last['limit'], 500);
      expect(controller.historyHasMore['session_root'], isTrue);
      expect(controller.historyCursors['session_root'], 'gap');
      api.responsePayload = {
        ..._historyPage(),
        'messages': [
          (_historyPage()['messages'] as List).first,
          {
            'id': 'middle',
            'role': 'codex',
            'content': 'Previously missing',
            'kind': 'message.completed',
            'created_at': '2026-09-01T00:00:00Z',
          },
        ],
      };
      await controller.loadHistory('session_root', earlier: true);
      expect(api.historyPayloads.last['limit'], 500);
      expect(api.historyPayloads.last['before'], 'gap');
      expect(
        controller.messages['session_root']!.map((m) => m.id),
        containsAll(['hist_1', 'middle', 'new-0', 'new-499']),
      );
      expect(controller.messages['session_root'], hasLength(502));
      expect(controller.historyHasMore['session_root'], isFalse);
    },
  );

  testWidgets(
    '[MOB-MSG-004][flutter] response invalidation wakes a pending history without downloading bootstrap',
    (tester) async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key);
      final controller = AppController(api: api)
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      final pending = Completer<void>();
      api.pendingResponse = pending.future;
      var completed = false;
      final load = controller
          .loadHistory('session_root')
          .then((_) => completed = true);
      await tester.pump();
      expect(api.responseReads, 1);
      // Notify while the pending HTTP request is still in flight.
      await controller.applyRealtimeSignalForTesting(
        const RealtimeSignal(
          type: 'invalidate',
          deviceId: 'dev_test',
          scopes: ['responses'],
        ),
      );
      pending.complete();
      await tester.pump();
      expect(
        completed,
        isTrue,
        reason: 'response readiness must not wait for the polling timer',
      );
      await load;
      expect(api.responseReads, 2);
      expect(api.bootstrapReads, 0);
      expect(api.historyPayloads.single['limit'], 500);
      expect(api.historyPayloads.single['include_agent_details'], isFalse);
      expect(api.historyPayloads.single['max_bytes'], 1024 * 1024);
      // Drain the losing Future.any fallback timer in the test clock.
      await tester.pump(const Duration(seconds: 1));
    },
  );

  testWidgets(
    'server response-wait timeout renews without another one-second timer',
    (tester) async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)
        ..pendingResponse = Future.value()
        ..pendingCode = 'response_wait_timeout';
      final controller = AppController(api: api)
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      var completed = false;
      final load = controller
          .loadHistory('session_root')
          .then((_) => completed = true);
      await tester.pump();
      expect(completed, isTrue);
      expect(api.responseReads, 2);
      await load;
    },
  );

  testWidgets(
    '[MOB-MSG-004][flutter] disconnected response notifications retain a polling fallback',
    (tester) async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)..pendingResponse = Future.value();
      final controller = AppController(api: api)
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      var completed = false;
      final load = controller
          .loadHistory('session_root')
          .then((_) => completed = true);
      await tester.pump();
      expect(completed, isFalse);
      await tester.pump(const Duration(seconds: 1));
      expect(completed, isTrue);
      await load;
      expect(api.bootstrapReads, 0);
    },
  );

  test(
    '[MOB-MSG-004][flutter] queue notifications preserve catalog and messages without full bootstrap',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key);
      final controller = AppController(api: api)
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      await controller.loadHistory('session_root');
      final messages = controller.messages['session_root'];
      await controller.applyRealtimeSignalForTesting(
        const RealtimeSignal(
          type: 'invalidate',
          deviceId: 'dev_test',
          scopes: ['queue', 'responses'],
        ),
      );
      expect(api.bootstrapReads, 0);
      expect(api.queueReads, 1);
      expect(identical(controller.messages['session_root'], messages), isTrue);
      await controller.applyRealtimeSignalForTesting(
        const RealtimeSignal(
          type: 'invalidate',
          deviceId: 'dev_test',
          scopes: ['catalog', 'queue'],
        ),
      );
      expect(api.bootstrapReads, 0);
      controller.phase = AppPhase.ready;
      controller.startDirectorySyncForTesting();
      await controller.syncDirectoryForTesting();
      await Future<void>.delayed(Duration.zero);
      expect(api.bootstrapReads, 1);
      expect(api.queueReads, 1);
    },
  );

  test(
    '[MOB-MSG-004][flutter] encrypted catalog recovery retries blocked history automatically',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)..fileAccessLimited = true;
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      await controller.refresh();
      expect(controller.catalogFileAccessLimited, isTrue);
      api.responsePayload = {
        'type': 'session.history_error',
        'error_code': 'file_access_denied',
      };
      await controller.loadHistory('session_root', silent: true);
      expect(controller.historyErrorFor('session_root'), isNotNull);
      api.fileAccessLimited = false;
      api.responsePayload = _historyPage();
      await controller.refresh();
      for (
        var i = 0;
        i < 50 && controller.historyErrorFor('session_root') != null;
        i++
      ) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
      expect(controller.catalogFileAccessLimited, isFalse);
      expect(controller.historyErrorFor('session_root'), isNull);
      expect(controller.messages['session_root'], hasLength(2));
    },
  );

  test(
    '[MOB-MSG-004][flutter] silent permission failure persists with cached messages until a successful retry',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key);
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ];
      addTearDown(controller.dispose);
      await controller.selectSession('session_root');
      final cachedIds = controller.messages['session_root']!
          .map((m) => m.id)
          .toList();
      api.responsePayload = {
        'type': 'session.history_error',
        'error_code': 'file_access_denied',
        'error': "EPERM: /private/secret-session.jsonl",
      };
      await controller.loadHistory('session_root', silent: true);
      expect(controller.historyErrorFor('session_root'), contains('文件与文件夹'));
      expect(
        controller.historyErrorFor('session_root'),
        isNot(contains('/private/')),
      );
      expect(controller.messages['session_root']!.map((m) => m.id), cachedIds);
      controller.clearBanners();
      expect(controller.historyErrorFor('session_root'), isNotNull);
      api.responsePayload = {
        'type': 'session.history_error',
        'error': 'timeout',
      };
      await controller.loadHistory('session_root', silent: true);
      expect(controller.historyErrorFor('session_root'), contains('文件与文件夹'));
      api.responsePayload = _historyPage();
      await controller.loadHistory('session_root', silent: true);
      expect(controller.historyErrorFor('session_root'), isNull);
      expect(controller.messages['session_root']!.map((m) => m.id), cachedIds);
    },
  );

  test(
    '[MOB-OFF-001][flutter] offline sessions keep cached messages and defer all history reads',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key);
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ]
        ..messages['session_root'] = [
          const RelayMessage(
            id: 'cached_message',
            role: 'codex',
            content: '手机已缓存的回复',
            createdAt: '2026-08-12T07:00:00.000Z',
            kind: 'message.completed',
          ),
        ]
        ..historyHasMore['session_root'] = true
        ..connectionSnapshot = const DeviceConnectionSnapshot(
          online: false,
          lastSeenAt: '2026-08-12T08:00:00.000Z',
          revision: 1,
          transport: RealtimeTransportState.connected,
          realtimeConfirmed: true,
        );
      addTearDown(controller.dispose);

      await controller.selectSession('session_root');
      await controller.loadHistory('session_root', earlier: true);

      expect(api.historyRequests, isEmpty);
      expect(controller.messages['session_root']!.single.id, 'cached_message');
      expect(controller.historyLoading, isEmpty);

      await controller.applyRealtimeSignalForTesting(
        const RealtimeSignal(
          type: 'presence',
          deviceId: 'dev_test',
          online: true,
          lastSeenAt: '2026-08-12T08:01:00.000Z',
          revision: 2,
        ),
      );
      for (
        var attempt = 0;
        attempt < 50 && api.historyRequests.isEmpty;
        attempt++
      ) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
      for (
        var attempt = 0;
        attempt < 50 && controller.messages['session_root']!.length == 1;
        attempt++
      ) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }

      expect(api.historyRequests, hasLength(1));
      expect(
        controller.messages['session_root']!.map((message) => message.id),
        containsAll(['cached_message', 'hist_1', 'hist_2']),
      );
    },
  );

  test(
    '[MOB-MSG-004][flutter] entering a session after event replay still merges authoritative history',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key);
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ];
      addTearDown(controller.dispose);

      controller.applyEventForTesting(
        _event('evt_live', {
          'kind': 'user.message',
          'text': '重启后重放的碎片',
        }, createdAt: '2026-08-12T09:00:00.000Z'),
      );
      expect(controller.messages['session_root'], hasLength(1));

      await controller.selectSession('session_root');

      expect(api.historyRequests, hasLength(1));
      final messages = controller.messages['session_root']!;
      expect(messages.map((message) => message.id), [
        'hist_1',
        'hist_2',
        'evt_live',
      ]);

      api.responsePayload = {
        ..._historyPage(),
        'messages': [
          ...(_historyPage()['messages'] as List),
          {
            'id': 'external_final',
            'role': 'codex',
            'content': 'Native CLI finished while phone viewed cached history',
            'created_at': '2026-08-12T10:00:00.000Z',
          },
        ],
      };
      await controller.selectSession('session_root');
      expect(api.historyRequests, hasLength(2));
      expect(
        controller.messages['session_root']!.map((m) => m.id),
        containsAll(['hist_1', 'hist_2', 'evt_live', 'external_final']),
      );
    },
  );

  test(
    '[MOB-MSG-004][flutter] a failed history load is retried on the next entry',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)
        ..responsePayload = {
          'type': 'session.history_error',
          'error': '历史读取失败。',
        };
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ];
      addTearDown(controller.dispose);

      await controller.selectSession('session_root');

      expect(controller.error, isEmpty);
      expect(controller.historyErrorFor('session_root'), '无法读取历史记录。');
      expect(controller.error, isNot(contains('历史读取失败')));
      expect(controller.messages.containsKey('session_root'), isFalse);
      expect(api.historyRequests, hasLength(1));

      api.responsePayload = _historyPage();
      await controller.selectSession('session_root');

      expect(api.historyRequests, hasLength(2));
      expect(controller.messages['session_root'], hasLength(2));
    },
  );

  test(
    '[MOB-MSG-005][flutter] interrupt failures surface as a system message',
    () async {
      final key = RelayKey.import(_testKey());
      final controller = AppController(api: _HistoryRelayApi(key))
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ];
      addTearDown(controller.dispose);

      controller.applyEventForTesting(
        _event('evt_interrupt', {
          'kind': 'turn.interrupt_failed',
          'turn_id': 'turn_1',
          'error': '电脑端未能停止任务。',
        }),
      );

      final message = controller.messages['session_root']!.single;
      expect(message.role, 'system');
      expect(message.kind, 'turn.interrupt_failed');
      expect(message.content, '电脑端未能停止任务。');
      expect(message.turnId, 'turn_1');

      controller.applyEventForTesting(
        _event('evt_interrupt_fallback', {
          'kind': 'turn.interrupt_failed',
          'turn_id': 'turn_2',
        }),
      );
      expect(controller.messages['session_root']!.last.content, '无法停止当前任务。');
    },
  );

  test(
    '[MOB-MSG-005][flutter] queue receipts settle only their own messages and ignore late acknowledgements',
    () async {
      final key = RelayKey.import(_testKey());
      final controller = AppController(api: _HistoryRelayApi(key))
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ];
      addTearDown(controller.dispose);
      for (final id in ['a', 'b']) {
        controller.applyEventForTesting(
          _event('queue_$id', {
            'kind': 'codex.persisted',
            'operation': 'turn',
            'mode': 'queued',
            'persisted': true,
            'client_message_id': id,
          }),
        );
      }
      controller.applyEventForTesting(
        _event('unrelated_start', {
          'kind': 'turn.started',
          'turn_id': 'unrelated',
        }),
      );
      expect(
        controller.messages['session_root']!
            .where((m) => m.kind == 'codex.queue.waiting')
            .length,
        2,
      );
      controller.applyEventForTesting(
        _event('running_a', {
          'kind': 'codex.queue.updated',
          'client_message_id': 'a',
          'status': 'running',
          'turn_id': 'turn_a',
        }),
      );
      expect(
        controller.messages['session_root']!
            .where((m) => m.kind == 'codex.queue.waiting')
            .map((m) => m.clientMessageId),
        ['b'],
      );
      controller.applyEventForTesting(
        _event('late_ack_a', {
          'kind': 'codex.persisted',
          'operation': 'turn',
          'mode': 'queued',
          'persisted': true,
          'client_message_id': 'a',
        }),
      );
      expect(
        controller.messages['session_root']!.any(
          (m) => m.id == 'codex_queue_a',
        ),
        false,
      );
      controller.applyEventForTesting(
        _event('unknown_b', {
          'kind': 'codex.queue.updated',
          'client_message_id': 'b',
          'status': 'unconfirmed',
        }),
      );
      expect(
        controller.messages['session_root']!
            .firstWhere((m) => m.id == 'codex_queue_b')
            .content,
        '尚未确认消息的处理状态，请刷新会话查看。',
      );
    },
  );

  test(
    '[MOB-MSG-005][flutter] turn persistence stays inline while thread creation remains visible',
    () async {
      final key = RelayKey.import(_testKey());
      final controller = AppController(api: _HistoryRelayApi(key))
        ..phase = AppPhase.ready
        ..activeSessionId = 'session_root'
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({
            'id': 'session_root',
            'name': 'Root',
            'provider': 'codex',
          }),
        ];
      addTearDown(controller.dispose);

      controller.applyEventForTesting(
        _event('evt_persisted_turn', {
          'kind': 'codex.persisted',
          'operation': 'turn',
          'persisted': true,
        }),
      );
      expect(controller.notice, isEmpty);

      controller.applyEventForTesting(
        _event('evt_queued_turn', {
          'kind': 'codex.persisted',
          'operation': 'turn',
          'mode': 'queued',
          'persisted': true,
        }),
      );
      expect(
        controller.messages['session_root']!.single.content,
        '消息已排队，稍后会自动发送。',
      );

      controller.applyEventForTesting(
        _event('evt_queued_started', {
          'kind': 'turn.started',
          'turn_id': 'turn_queued',
        }),
      );
      expect(controller.messages['session_root'], isEmpty);

      controller.applyEventForTesting(
        _event('evt_persisted_thread', {
          'kind': 'codex.persisted',
          'operation': 'thread',
          'persisted': true,
        }),
      );
      expect(controller.notice, '会话已写入 Codex。');

      controller.clearBanners();

      controller.applyEventForTesting(
        _event('evt_persisted_pending', {
          'kind': 'codex.persisted',
          'operation': 'turn',
          'persisted': false,
        }),
      );
      expect(controller.notice, isEmpty);
    },
  );

  test(
    '[MOB-MSG-004][flutter] persisted Codex turns refresh the missing final answer',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)
        ..responsePayload = {
          'type': 'session.history',
          'messages': [
            {
              'id': 'final_answer',
              'role': 'codex',
              'content': '红框内的最终总结已恢复',
              'created_at': '2026-08-12T10:02:00.000Z',
              'kind': 'message.completed',
              'turn_id': 'turn_1',
              'message_phase': 'final_answer',
            },
          ],
          'next_cursor': null,
          'has_more': false,
          'agents': <Map<String, dynamic>>[],
          'sessions': <Map<String, dynamic>>[],
        };
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ];
      addTearDown(controller.dispose);

      controller.historyViewportShown('session_root');
      controller.applyEventForTesting(
        _event('evt_started', {'kind': 'turn.started', 'turn_id': 'turn_1'}),
      );
      controller.applyEventForTesting(
        _event('evt_intermediate', {
          'kind': 'message.completed',
          'turn_id': 'turn_1',
          'text': '较早的中间回复',
          'message_phase': 'commentary',
        }),
      );
      controller.applyEventForTesting(
        _event('evt_completed', {
          'kind': 'turn.completed',
          'turn_id': 'turn_1',
        }),
      );
      controller.applyEventForTesting(
        _event('evt_persisted', {
          'kind': 'codex.persisted',
          'operation': 'thread',
          'persisted': true,
        }),
      );

      for (
        var attempt = 0;
        attempt < 50 && api.historyRequests.isEmpty;
        attempt++
      ) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
      expect(api.historyRequests, hasLength(1));
      for (
        var attempt = 0;
        attempt < 50 &&
            controller.messages['session_root']
                    ?.where((m) => m.role == 'codex')
                    .single
                    .id !=
                'final_answer';
        attempt++
      ) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }

      final message = controller.messages['session_root']!
          .where((m) => m.role == 'codex')
          .single;
      expect(
        controller.messages['session_root']!
            .where((m) => m.kind == 'turn.completed')
            .single
            .turnStatus,
        'completed',
      );
      expect(message.id, 'final_answer');
      expect(message.content, '红框内的最终总结已恢复');
      expect(message.messagePhase, 'final_answer');
    },
  );

  test(
    '[MOB-MSG-005][flutter] a steered turn binds the pending user message and keeps the session running',
    () async {
      final key = RelayKey.import(_testKey());
      final controller = AppController(api: _HistoryRelayApi(key))
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ];
      addTearDown(controller.dispose);

      controller.applyEventForTesting(
        _event('evt_user', {'kind': 'user.message', 'text': '追加指令'}),
      );
      expect(controller.runningSessions.contains('session_root'), isFalse);
      expect(controller.messages['session_root']!.single.turnId, isNull);

      controller.applyEventForTesting(
        _event('evt_steer', {'kind': 'turn.steered', 'turn_id': 'turn_9'}),
      );

      expect(controller.runningSessions.contains('session_root'), isTrue);
      expect(controller.messages['session_root']!.single.turnId, 'turn_9');
    },
  );

  test(
    '[MOB-MSG-006][flutter] an external Codex user item keeps its turn and deduplicates against history',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)
        ..responsePayload = {
          'type': 'session.history',
          'messages': [
            {
              'id': 'user_item_external',
              'role': 'user',
              'content': 'Codex 桌面端发送的正文',
              'created_at': '2026-08-12T10:00:00.000Z',
              'kind': 'user.message',
              'turn_id': 'turn_external',
              'client_message_id': 'desktop_client_message',
            },
          ],
          'next_cursor': null,
          'has_more': false,
          'agents': <Map<String, dynamic>>[],
          'sessions': <Map<String, dynamic>>[],
        };
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ];
      addTearDown(controller.dispose);

      controller.applyEventForTesting(
        _event('evt_external', {
          'kind': 'user.message',
          'item_id': 'user_item_external',
          'turn_id': 'turn_external',
          'client_message_id': 'desktop_client_message',
          'text': 'Codex 桌面端发送的正文',
        }),
      );

      final liveMessage = controller.messages['session_root']!.single;
      expect(liveMessage.id, 'user_item_external');
      expect(liveMessage.turnId, 'turn_external');
      expect(liveMessage.content, 'Codex 桌面端发送的正文');

      await controller.selectSession('session_root');

      expect(controller.messages['session_root'], hasLength(1));
      expect(
        controller.messages['session_root']!.single.id,
        'user_item_external',
      );
    },
  );

  test(
    '[MOB-ATT-009][flutter] recovered Codex client ID repairs duplicate history while preserving a repeated send',
    () async {
      final key = RelayKey.import(_testKey());
      final historyMessage = <String, dynamic>{
        'id': 'native_image_a',
        'role': 'user',
        'content': '检查图片',
        'created_at': '2026-10-28T01:27:22.000Z',
        'turn_id': 'turn_image',
        'client_message_id': 'client_a',
        'attachments': [
          {
            'id': 'native_image',
            'type': 'image',
            'name': 'screenshot.png',
            'mime_type': 'image/png',
            'url': '/api/sessions/session_root/attachments/native_image',
          },
        ],
      };
      final api = _HistoryRelayApi(key)
        ..responsePayload = {
          'type': 'session.history',
          'messages': [historyMessage],
          'next_cursor': null,
          'has_more': false,
          'agents': <Map<String, dynamic>>[],
          'sessions': <Map<String, dynamic>>[],
        };
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ];
      addTearDown(controller.dispose);
      controller.applyEventForTesting(
        _event('acceptance_a', {
          'kind': 'user.message',
          'client_message_id': 'client_a',
          'text': '检查图片',
        }, createdAt: '2026-10-28T01:27:14.000Z'),
      );
      // A cache created by the old Relay lost the companion client ID.
      controller.messages['session_root']!.add(
        RelayMessage.fromHistory({
          ...historyMessage,
          'client_message_id': null,
        }),
      );
      expect(controller.messages['session_root'], hasLength(2));
      await controller.selectSession('session_root');
      expect(controller.messages['session_root'], hasLength(1));
      expect(controller.messages['session_root']!.single.id, 'native_image_a');
      expect(
        controller.messages['session_root']!.single.clientMessageId,
        'client_a',
      );
      expect(
        controller.messages['session_root']!.single.attachments.single.id,
        'native_image',
      );

      controller.applyEventForTesting(
        _event('native_replay_a', {
          'kind': 'user.message',
          'item_id': 'native_image_a',
          'turn_id': 'turn_image',
          'text': '检查图片',
        }, createdAt: '2026-10-28T01:27:22.000Z'),
      );
      expect(
        controller.messages['session_root']!.single.clientMessageId,
        'client_a',
      );

      controller.applyEventForTesting(
        _event('acceptance_b', {
          'kind': 'user.message',
          'client_message_id': 'client_b',
          'text': '检查图片',
        }, createdAt: '2026-10-28T01:27:23.000Z'),
      );
      api.responsePayload['messages'] = [
        historyMessage,
        {
          ...historyMessage,
          'id': 'native_image_b',
          'client_message_id': 'client_b',
          'created_at': '2026-10-28T01:27:24.000Z',
        },
      ];
      await controller.loadHistory('session_root');
      expect(controller.messages['session_root']!.map((m) => m.id), [
        'native_image_a',
        'native_image_b',
      ]);
    },
  );

  test(
    '[MOB-ATT-009][flutter] authoritative history replaces the live attachment event by client id',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)
        ..responsePayload = {
          'type': 'session.history',
          'messages': [
            {
              'id': 'history_user_image',
              'role': 'user',
              'content': '检查图片',
              'created_at': '2026-08-12T10:00:00.000Z',
              'kind': 'user.message',
              'turn_id': 'turn_image',
              'client_message_id': 'client_image',
              'attachments': [
                {
                  'id': 'history_image',
                  'type': 'image',
                  'name': 'screenshot.png',
                  'mime_type': 'image/png',
                  'url': '/api/sessions/session_root/attachments/history_image',
                },
              ],
            },
          ],
          'next_cursor': null,
          'has_more': false,
          'agents': <Map<String, dynamic>>[],
          'sessions': <Map<String, dynamic>>[],
        };
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ];
      addTearDown(controller.dispose);

      controller.applyEventForTesting(
        _event('live_user_image', {
          'kind': 'user.message',
          'item_id': 'live_user_image',
          'turn_id': 'turn_image',
          'client_message_id': 'client_image',
          'text': '检查图片',
          'attachments': [
            {
              'id': 'live_image',
              'type': 'image',
              'name': 'screenshot.png',
              'mime_type': 'image/png',
              'url': '/api/sessions/session_root/attachments/live_image',
            },
          ],
        }),
      );

      await controller.selectSession('session_root');

      expect(controller.messages['session_root'], hasLength(1));
      final message = controller.messages['session_root']!.single;
      expect(message.id, 'history_user_image');
      expect(message.attachments.single.id, 'history_image');
    },
  );

  test(
    '[MOB-ATT-009][flutter] refreshed history upgrades stale SVG preview metadata while another turn runs',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)
        ..responsePayload = {
          'type': 'session.history',
          'messages': [
            {
              'id': 'svg_answer',
              'role': 'codex',
              'content': 'SVG 文件位置：diagram.svg',
              'created_at': '2026-08-12T10:00:00.000Z',
              'kind': 'message.completed',
              'turn_id': 'turn_svg',
              'message_phase': 'final_answer',
              'attachments': [
                {
                  'id': 'reply_file_svg',
                  'type': 'file',
                  'name': 'diagram.svg',
                  'mime_type': 'image/svg+xml',
                  'preview_supported': true,
                  'url':
                      '/api/sessions/session_root/attachments/reply_file_svg',
                },
              ],
            },
            {
              'id': 'active_snapshot',
              'role': 'codex',
              'content': '较早的运行中快照',
              'created_at': '2026-08-12T10:01:00.000Z',
              'kind': 'message.completed',
              'turn_id': 'turn_current',
              'message_phase': 'commentary',
            },
          ],
          'next_cursor': null,
          'has_more': false,
          'agents': <Map<String, dynamic>>[],
          'sessions': <Map<String, dynamic>>[],
        };
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({
            'id': 'session_root',
            'name': 'Root',
            'status': 'active',
          }),
        ];
      addTearDown(controller.dispose);

      controller.applyEventForTesting(
        _event('evt_stale_svg', {
          'kind': 'message.completed',
          'item_id': 'svg_answer',
          'turn_id': 'turn_svg',
          'message_phase': 'final_answer',
          'text': 'SVG 文件位置：diagram.svg',
          'attachments': [
            {
              'id': 'reply_file_svg',
              'type': 'file',
              'name': 'diagram.svg',
              'mime_type': 'application/octet-stream',
              'preview_supported': false,
            },
          ],
        }),
      );
      controller.applyEventForTesting(
        _event('evt_current_turn', {
          'kind': 'turn.started',
          'turn_id': 'turn_current',
        }),
      );
      controller.applyEventForTesting(
        _event('evt_current_message', {
          'kind': 'message.completed',
          'item_id': 'active_answer',
          'turn_id': 'turn_current',
          'message_phase': 'commentary',
          'text': '仍在生成的最新内容',
        }),
      );

      await controller.selectSession('session_root');

      expect(controller.runningSessions, contains('session_root'));
      final svgMessages = controller.messages['session_root']!
          .where((message) => message.content.contains('SVG 文件位置'))
          .toList();
      expect(svgMessages, hasLength(1));
      final attachment = svgMessages.single.attachments.single;
      expect(attachment.mimeType, 'image/svg+xml');
      expect(attachment.previewSupported, isTrue);
      expect(attachment.url, isNotEmpty);
      expect(
        controller.messages['session_root']!.map((message) => message.content),
        contains('仍在生成的最新内容'),
      );
    },
  );

  test(
    '[MOB-STA-009][flutter] history details cannot overwrite catalog runtime state',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)
        ..responsePayload = {
          ..._historyPage(),
          'sessions': [
            {
              'id': 'session_root',
              'name': 'History detail name',
              'status': 'idle',
              'running_started_at': null,
              'can_interrupt': true,
            },
          ],
        };
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({
            'id': 'session_root',
            'name': 'Catalog name',
            'status': 'active',
            'running_started_at': '2026-08-12T09:59:00.000Z',
            'can_interrupt': false,
          }),
        ];
      addTearDown(controller.dispose);

      await controller.selectSession('session_root');

      final session = controller.sessions.single;
      expect(session.name, 'History detail name');
      expect(session.status, 'active');
      expect(session.raw['running_started_at'], '2026-08-12T09:59:00.000Z');
      expect(session.canInterrupt, isFalse);
      expect(controller.runningSessions, contains('session_root'));
      expect(controller.sessionHasRunningAgent('session_root'), isTrue);
    },
  );

  test(
    '[MOB-STA-010][flutter] history details preserve catalog runtime settings',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryRelayApi(key)
        ..responsePayload = {
          ..._historyPage(),
          'sessions': [
            {
              'id': 'session_root',
              'name': 'History detail name',
              'session_config_options': [
                {
                  'type': 'select',
                  'id': 'model',
                  'currentValue': 'gpt-5.6-sol',
                  'options': [
                    {'value': 'gpt-5.6-sol', 'name': 'GPT-5.6-Sol'},
                  ],
                },
              ],
            },
          ],
        };
      final runtimeSettings = <Map<String, dynamic>>[
        {
          'type': 'select',
          'id': 'model',
          'currentValue': 'gpt-5.6-sol',
          'options': [
            {'value': 'gpt-5.6-sol', 'name': 'GPT-5.6-Sol'},
          ],
        },
        {
          'type': 'select',
          'id': 'reasoning',
          'currentValue': 'high',
          'options': [
            {'value': 'medium', 'name': '中'},
            {'value': 'high', 'name': '高'},
          ],
        },
        {
          'type': 'select',
          'id': 'service_tier',
          'currentValue': 'default',
          'options': [
            {'value': 'default', 'name': '标准'},
            {'value': 'priority', 'name': 'Fast'},
          ],
        },
      ];
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({
            'id': 'session_root',
            'name': 'Catalog name',
            'session_config_options': runtimeSettings,
          }),
        ];
      addTearDown(controller.dispose);

      await controller.selectSession('session_root');

      final session = controller.sessions.single;
      expect(session.name, 'History detail name');
      expect(session.raw['session_config_options'], runtimeSettings);
    },
  );
}

class _HistoryRelayApi extends RelayApi {
  _HistoryRelayApi(this._key);

  final RelayKey _key;
  final List<String> historyRequests = [];
  final List<Map<String, dynamic>> historyPayloads = [];
  int bootstrapReads = 0;
  int queueReads = 0;
  int responseReads = 0;
  DownloadProgressCallback? historyDownloadProgress;
  Future<void>? pendingResponse;
  String pendingCode = 'response_pending';
  Map<String, dynamic> responsePayload = _historyPage();
  bool fileAccessLimited = false;
  EventPage? eventPage;

  @override
  Future<EventPage> pollEvents({
    required String deviceId,
    required int cursor,
  }) => eventPage == null
      ? super.pollEvents(deviceId: deviceId, cursor: cursor)
      : Future.value(eventPage);

  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) async {
    bootstrapReads += 1;
    final base = _bootstrap();
    final aad = RelayAad(
      direction: 'relay_to_web',
      type: 'relay.sync_sessions',
      deviceId: base.device.id,
      sessionId: null,
      requestId: null,
      eventSeq: null,
      createdAt: '2026-09-07T00:00:00Z',
      expiresAt: null,
    );
    final envelope = await RelayCipher().sealJson(_key, {
      'type': 'relay.sync_sessions',
      'file_access_limited': fileAccessLimited,
      'sessions': [
        {'id': 'session_root', 'name': 'Root'},
      ],
      'projects': [],
    }, aad);
    return ServerBootstrap(
      email: base.email,
      device: base.device,
      catalog: OpaqueFrame(
        deviceId: base.device.id,
        sessionId: null,
        requestId: null,
        aad: aad,
        envelope: envelope,
      ),
      events: [],
      cursor: 0,
      ackSequence: 0,
      queuedCommands: 0,
    );
  }

  @override
  Future<ServerBootstrap> queueStatus({required String deviceId}) async {
    queueReads += 1;
    return _bootstrap();
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
    if (commandType == 'session.read_history') {
      historyRequests.add(requestId);
      final command = await RelayCipher().openJson<Map<String, dynamic>>(
        _key,
        envelope,
        aad,
      );
      historyPayloads.add(Map<String, dynamic>.from(command['payload'] as Map));
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
    responseReads += 1;
    historyDownloadProgress = onProgress;
    final pending = pendingResponse;
    if (pending != null) {
      pendingResponse = null;
      await pending;
      throw RelayApiException('pending', 404, pendingCode);
    }
    final aad = RelayAad(
      direction: 'relay_to_web',
      type: 'session.history',
      deviceId: 'dev_test',
      sessionId: null,
      requestId: requestId,
      eventSeq: null,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      expiresAt: null,
    );
    final envelope = await RelayCipher().sealJson(_key, responsePayload, aad);
    return OpaqueFrame(
      deviceId: 'dev_test',
      sessionId: null,
      requestId: requestId,
      aad: aad,
      envelope: envelope,
    );
  }
}

Map<String, dynamic> _historyPage() => {
  'type': 'session.history',
  'messages': [
    {
      'id': 'hist_1',
      'role': 'user',
      'content': '早期问题',
      'created_at': '2026-08-12T08:00:00.000Z',
      'kind': 'user.message',
    },
    {
      'id': 'hist_2',
      'role': 'codex',
      'content': '早期回答',
      'created_at': '2026-08-12T08:01:00.000Z',
      'kind': 'message.completed',
    },
  ],
  'next_cursor': null,
  'has_more': false,
  'agents': <Map<String, dynamic>>[],
  'sessions': <Map<String, dynamic>>[],
};

RelayEvent _event(
  String eventId,
  Map<String, dynamic> event, {
  String createdAt = '2026-08-12T10:00:00.000Z',
  int sourceSequence = 0,
}) => RelayEvent(
  cursor: 0,
  sourceSequence: sourceSequence,
  eventId: eventId,
  sessionId: 'session_root',
  agentId: null,
  createdAt: createdAt,
  event: event,
);

ServerBootstrap _bootstrap() => const ServerBootstrap(
  email: 'owner@example.com',
  device: RelayDevice(
    id: 'dev_test',
    name: 'Test Mac',
    online: true,
    agentConnected: true,
    lastSeenAt: '2026-08-12T08:00:00.000Z',
  ),
  catalog: null,
  events: [],
  cursor: 0,
  ackSequence: 0,
  queuedCommands: 0,
);

String _testKey() => base64Url
    .encode(List<int>.generate(32, (index) => index))
    .replaceAll('=', '');

class _HistorySecureStore extends SecureStore {
  final Map<String, String> keys = {};
  @override
  Future<String?> readHistoryKey(String scope) async => keys[scope];
  @override
  Future<void> saveHistoryKey(String scope, String key) async {
    keys[scope] = key;
  }

  @override
  Future<void> clearHistoryKey(String scope) async {
    keys.remove(scope);
  }

  @override
  Future<void> clearPairing() async {}
}

class _PreviewBeforeSnapshotStore extends HistoryStore {
  _PreviewBeforeSnapshotStore()
    : super(factory: databaseFactoryFfi, path: inMemoryDatabasePath);
  final entered = Completer<void>(), release = Completer<void>();

  @override
  Future<({HistoryPage? page, HistoryPage? recent})> readLatest(
    List<int> key,
    String session, {
    void Function(HistoryPage preview)? onPreview,
  }) async {
    final full = HistoryPage.fromJson({
      ..._historyPage(),
      'next_cursor': 'older',
      'has_more': true,
    });
    onPreview?.call(
      HistoryPage(
        messages: full.messages.take(1).toList(),
        nextCursor: null,
        hasMore: true,
        agents: const [],
        sessions: const [],
      ),
    );
    entered.complete();
    await release.future;
    return (page: full, recent: null);
  }
}

class _BlockedHistoryStore extends HistoryStore {
  _BlockedHistoryStore()
    : super(factory: databaseFactoryFfi, path: inMemoryDatabasePath);

  final entered = Completer<void>();
  final release = Completer<void>();
  int recentReads = 0;
  bool failRead = false;
  HistoryPage? recentPage;
  final finished = Completer<void>();

  @override
  Future<({HistoryPage? page, HistoryPage? recent})> readLatest(
    List<int> key,
    String session, {
    void Function(HistoryPage preview)? onPreview,
  }) async {
    try {
      return (
        page: await readPage(key, session),
        recent: await readRecent(key, session),
      );
    } finally {
      if (!finished.isCompleted) finished.complete();
    }
  }

  @override
  Future<HistoryPage?> readPage(
    List<int> key,
    String session, {
    String? before,
  }) async {
    entered.complete();
    await release.future;
    if (failRead) throw StateError('fixture cache failure');
    return null;
  }

  @override
  Future<HistoryPage?> readRecent(List<int> key, String session) async {
    recentReads++;
    return recentPage ?? HistoryPage.fromJson(_historyPage());
  }
}

class _OfflineHistorySecureStore extends _HistorySecureStore {
  @override
  Future<StoredCredentials> read() async => StoredCredentials(
    sessionToken: 'session',
    contentKey: _testKey(),
    deviceId: 'dev_test',
    browserId: 'browser',
    browserToken: 'token',
  );
  @override
  Future<String?> lastAccountEmail() async => 'owner@example.com';
}

class _OfflineHistoryApi extends _HistoryRelayApi {
  _OfflineHistoryApi(super.key, {this.selfHosted = false});
  final bool selfHosted;
  @override
  String get origin => selfHosted ? 'https://selfhost.example' : super.origin;
  @override
  Future<InstanceCapabilities> discoverInstance() async {
    identityEntered.complete();
    await identityRelease.future;
    throw const RelayApiException('offline', 0, 'network_unavailable');
  }

  final identityEntered = Completer<void>();
  final identityRelease = Completer<void>();
  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) async {
    identityEntered.complete();
    await identityRelease.future;
    throw const RelayApiException('offline', 0, 'network_unavailable');
  }
}

class _PendingHistoryApi extends _HistoryRelayApi {
  _PendingHistoryApi(super.key, this.store, this.secure);
  final HistoryStore store;
  final _HistorySecureStore secure;
  int submissions = 0;
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
    if (commandType == 'session.submit_message') {
      submissions++;
      final pending = (await store.readPending(
        base64Decode(secure.keys.values.single),
        sessionId!,
      )).single;
      final frame = pending['frame'] as Map;
      expect(frame['request_id'], requestId);
      expect(frame['aad'], aad.toJson());
      expect(frame['envelope'], envelope.toJson());
      expect((pending['message'] as Map)['content'], 'Protected input');
    }
    return CommandResult(requestId: requestId, delivery: 'delivered');
  }
}

class _BlockedCheckpointStore extends HistoryStore {
  _BlockedCheckpointStore()
    : super(factory: databaseFactoryFfi, path: inMemoryDatabasePath);
  final entered = Completer<void>(), release = Completer<void>();
  int pendingSaves = 0;
  @override
  Future<void> appendMessages(
    List<int> key,
    String session,
    List<RelayMessage> messages,
  ) async {
    if (!entered.isCompleted) {
      entered.complete();
      await release.future;
    }
    await super.appendMessages(key, session, messages);
  }

  @override
  Future<void> savePending(
    List<int> key,
    String session,
    RelayMessage message,
    Map<String, dynamic> frame,
  ) async {
    pendingSaves++;
    await super.savePending(key, session, message, frame);
  }
}

class _HeldPendingStore extends HistoryStore {
  _HeldPendingStore({required this.holdSave})
    : super(factory: databaseFactoryFfi, path: inMemoryDatabasePath);
  final int holdSave;
  int saves = 0;
  final entered = Completer<void>(), release = Completer<void>();
  @override
  Future<void> savePending(
    List<int> key,
    String session,
    RelayMessage message,
    Map<String, dynamic> frame,
  ) async {
    if (++saves == holdSave) {
      entered.complete();
      await release.future;
    }
    await super.savePending(key, session, message, frame);
  }
}

class _DelayedSnapshotStore extends HistoryStore {
  _DelayedSnapshotStore()
    : super(factory: databaseFactoryFfi, path: inMemoryDatabasePath);
  bool holdSnapshot = false, holdFilter = false;
  final snapshotEntered = Completer<void>(),
      releaseSnapshot = Completer<void>();
  final filterEntered = Completer<void>(), releaseFilter = Completer<void>();
  @override
  Future<({HistoryPage? page, HistoryPage? recent})> readLatest(
    List<int> key,
    String session, {
    void Function(HistoryPage)? onPreview,
  }) async {
    final result = await super.readLatest(key, session);
    if (holdSnapshot) {
      snapshotEntered.complete();
      await releaseSnapshot.future;
    }
    if (result.page != null) onPreview?.call(result.page!);
    return result;
  }

  @override
  Future<List<RelayMessage>> withoutDeleted(
    List<int> key,
    String session,
    List<RelayMessage> messages,
  ) async {
    final result = await super.withoutDeleted(key, session, messages);
    if (holdFilter) {
      holdFilter = false;
      filterEntered.complete();
      await releaseFilter.future;
    }
    return result;
  }
}

class _BlockedDeletionStore extends HistoryStore {
  _BlockedDeletionStore()
    : super(factory: databaseFactoryFfi, path: inMemoryDatabasePath);
  bool block = false;
  final entered = Completer<void>(), release = Completer<void>();
  @override
  Future<List<RelayMessage>> withoutDeleted(
    List<int> key,
    String session,
    List<RelayMessage> messages,
  ) async {
    if (block) {
      if (!entered.isCompleted) entered.complete();
      await release.future;
    }
    return super.withoutDeleted(key, session, messages);
  }
}

class _UnreachableHistoryRelayApi extends _HistoryRelayApi {
  _UnreachableHistoryRelayApi(super.key);
  Future<void>? beforeFailure;
  @override
  Future<OpaqueFrame> encryptedResponse(
    String requestId, {
    bool preserveCompression = false,
    DownloadProgressCallback? onProgress,
    Future<void>? abortTrigger,
    Duration? maxWait,
  }) async {
    await beforeFailure;
    throw const RelayApiException(
      'Fixture network failure',
      503,
      'network_unavailable',
    );
  }
}
