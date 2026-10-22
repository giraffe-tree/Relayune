import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/device_connection.dart';
import 'package:relayune_mobile/src/storage/history_store.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'session_directory_test.dart' as fixture;

void _configure(_Controller c, {String device = 'mac'}) {
  c.phase = AppPhase.ready;
  c.desktopInfo = const RelayDesktopInfo(supportsSessionDirectory: true);
  c.relayKey = RelayKey.import(
    base64Url.encode(List.filled(32, 1)).replaceAll('=', ''),
  );
  c.bootstrap = ServerBootstrap(
    email: 'owner@example.com',
    device: RelayDevice(
      id: device,
      name: 'Mac',
      online: true,
      agentConnected: true,
      lastSeenAt: '',
    ),
    catalog: null,
    events: [],
    cursor: 0,
    ackSequence: 0,
    queuedCommands: 0,
  );
}

void main() {
  testWidgets(
    'home loading covers initial unknown catalog and stops for authoritative empty',
    (tester) async {
      final c = _Controller();
      _configure(c);
      c.desktopInfo = null;
      c.connectionSnapshot = const DeviceConnectionSnapshot(
        online: true,
        lastSeenAt: null,
        revision: 1,
        transport: RealtimeTransportState.connecting,
        realtimeConfirmed: true,
      );
      c.startDirectorySyncForTesting();
      await tester.pump();
      expect(c.homeSessionsLoading, isTrue);
      c.desktopInfo = const RelayDesktopInfo(supportsSessionDirectory: true);
      await c.syncDirectoryForTesting();
      expect(c.sessions, isEmpty);
      expect(c.homeSessionsLoading, isFalse);
      c.dispose();
    },
  );

  testWidgets(
    'home loading stops on failure/offline and preserves cached rows',
    (tester) async {
      final c = _Controller()..fail = true;
      _configure(c);
      c.startDirectorySyncForTesting();
      await tester.pump();
      expect(c.homeSessionsLoading, isFalse);
      c.fail = false;
      c.pending = Completer<Map<String, dynamic>>();
      final syncing = c.syncDirectoryForTesting();
      await tester.pump();
      expect(c.homeSessionsLoading, isTrue);
      c.connectionSnapshot = const DeviceConnectionSnapshot(
        online: false,
        lastSeenAt: null,
        revision: 1,
        transport: RealtimeTransportState.connected,
        realtimeConfirmed: true,
      );
      expect(c.homeSessionsLoading, isFalse);
      c.sessions = [RelaySession.fromJson(fixture.row('cached'))];
      c.connectionSnapshot = c.connectionSnapshot.applyPresence(
        online: true,
        lastSeenAt: null,
        revision: 2,
      );
      expect(c.homeSessionsLoading, isFalse);
      c.pending!.complete({'directory': fixture.page(reset: true)});
      await syncing;
      c.dispose();
    },
  );

  testWidgets(
    'immediate first sync, one second cadence, no overlap, and paused replies discarded',
    (tester) async {
      final c = _Controller()..pending = Completer<Map<String, dynamic>>();
      _configure(c);
      addTearDown(c.dispose);
      c.startDirectorySyncForTesting();
      await tester.pump();
      expect(c.requests.length, 1);
      expect(c.requests.single['batch_size'], 300);
      await tester.pump(const Duration(seconds: 5));
      expect(c.requests.length, 1);
      c.pauseRealtime();
      c.pending!.complete({
        'directory': fixture.page(reset: true, rows: [fixture.row('late')]),
      });
      await tester.pump();
      expect(c.sessions, isEmpty);
      await tester.pump(const Duration(seconds: 5));
      expect(c.requests.length, 1);
    },
  );
  testWidgets(
    'each tick fetches one batch; errors retry the same checkpoint on a later tick',
    (tester) async {
      final c = _Controller();
      _configure(c);
      c.response = {
        'directory': fixture.page(
          reset: true,
          rows: [fixture.row('a')],
          next: 'next',
        ),
      };
      c.startDirectorySyncForTesting();
      await tester.pump();
      expect(c.sessions.map((s) => s.id), ['a']);
      expect(c.requests.length, 1);
      c.fail = true;
      await tester.pump(const Duration(seconds: 1));
      expect(c.requests.last['cursor'], 'next');
      expect(c.sessions.length, 1);
      c.fail = false;
      c.response = {
        'directory': fixture.page(rows: [fixture.row('b')]),
      };
      await tester.pump(const Duration(seconds: 1));
      expect(c.requests.last['cursor'], 'next');
      expect(c.sessions.length, 2);
      c.response = {'directory': fixture.page()};
      await tester.pump(const Duration(seconds: 1));
      expect(c.requests.last['revision'], 'a');
      expect(c.requests.last['cursor'], isNull);
      c.dispose();
    },
  );
  testWidgets('switching devices rejects an in-flight directory response', (
    tester,
  ) async {
    final c = _Controller()..pending = Completer<Map<String, dynamic>>();
    _configure(c);
    c.startDirectorySyncForTesting();
    await tester.pump(const Duration(seconds: 1));
    _configure(c, device: 'other');
    c.pending!.complete({
      'directory': fixture.page(reset: true, rows: [fixture.row('old')]),
    });
    await tester.pump();
    expect(c.sessions, isEmpty);
    c.dispose();
  });

  testWidgets(
    'background pauses directory polling and foreground refreshes immediately',
    (tester) async {
      final c = _Controller();
      _configure(c);
      c.startDirectorySyncForTesting();
      await tester.pump();
      expect(c.requests.length, 1);
      c.setPresentationForeground(false);
      await tester.pump(const Duration(seconds: 5));
      expect(c.requests.length, 1);
      c.setPresentationForeground(true);
      await tester.pump();
      expect(c.requests.length, 2);
      await tester.pump(const Duration(milliseconds: 999));
      expect(c.requests.length, 2);
      c.dispose();
    },
  );

  for (final bootstrapFails in [false, true]) {
    testWidgets(
      'resume publishes directory before pending bootstrap; failure=$bootstrapFails',
      (tester) async {
        final c = _Controller()..refreshPending = Completer<void>();
        _configure(c);
        c.setPresentationForeground(false);
        await tester.pump(const Duration(minutes: 3));
        c.response = {
          'directory': fixture.page(reset: true, rows: [fixture.row('fresh')]),
        };
        c.setPresentationForeground(true, resumeTransport: false);
        final resumed = c.resumeRealtime();
        final completion = bootstrapFails
            ? expectLater(resumed, throwsStateError)
            : resumed;
        await tester.pump();
        expect(c.refreshCalls, 1);
        expect(c.requests.length, 1);
        expect(c.sessions.single.id, 'fresh');
        expect(c.refreshPending!.isCompleted, isFalse);
        // A response already in flight must survive bootstrap completion/failure.
        c.pending = Completer<Map<String, dynamic>>();
        await tester.pump(const Duration(seconds: 1));
        expect(c.requests.length, 2);
        c.activeSessionId = null; // Home has no open history to recover.
        if (bootstrapFails) {
          c.refreshPending!.completeError(StateError('bootstrap unavailable'));
        } else {
          c.refreshPending!.complete();
        }
        await completion;
        c.pending!.complete({
          'directory': fixture.page(rows: [fixture.row('newer')]),
        });
        await tester.pump();
        expect(c.sessions.map((s) => s.id), contains('newer'));
        c.pending = null;
        await tester.pump(const Duration(seconds: 1));
        expect(c.requests.length, 3);
        c.dispose();
      },
    );
  }

  test(
    'encrypted directory and pagination checkpoint restore on restart and isolate accounts/devices',
    () async {
      sqfliteFfiInit();
      final directory = await Directory.systemTemp.createTemp(
        'relayune-directory-test-',
      );
      final secure = _Secure();
      _Controller create({
        String device = 'mac',
        String email = 'owner@example.com',
      }) {
        final c = _Controller(
          secureStore: secure,
          historyStore: HistoryStore(
            factory: databaseFactoryFfi,
            path: '${directory.path}/cache.sqlite',
          ),
        );
        _configure(c, device: device);
        c.email = email;
        return c;
      }

      Future<void> close(_Controller c) async {
        c.pauseRealtime();
        await c.flushHistoryCache();
        c.dispose();
        await c.store!.close();
      }

      final first = create();
      first.response = {
        'directory': fixture.page(
          reset: true,
          rows: [fixture.row('a')],
          next: 'next',
        ),
      };
      first.startDirectorySyncForTesting();
      await first.syncDirectoryForTesting();
      await close(first);
      final next = create();
      next.response = {
        'directory': fixture.page(rows: [fixture.row('b')]),
      };
      next.startDirectorySyncForTesting();
      await next.syncDirectoryForTesting();
      expect(next.requests.single['cursor'], 'next');
      expect(next.sessions.map((s) => s.id).toSet(), {'a', 'b'});
      await close(next);
      for (final c in [
        create(device: 'other'),
        create(email: 'other@example.com'),
      ]) {
        c.response = {'directory': fixture.page(reset: true)};
        c.startDirectorySyncForTesting();
        await c.syncDirectoryForTesting();
        expect(c.requests.single['revision'], isNull);
        expect(c.requests.single['cursor'], isNull);
        expect(c.sessions, isEmpty);
        await close(c);
      }
      await directory.delete(recursive: true);
    },
  );
}

class _Controller extends AppController {
  // Keep the injected store available for deterministic close in disk tests.
  // ignore: use_super_parameters
  _Controller({super.secureStore, HistoryStore? historyStore})
    : store = historyStore,
      super(historyStore: historyStore);
  final HistoryStore? store;
  final requests = <Map<String, dynamic>>[];
  bool fail = false;
  Completer<void>? refreshPending;
  int refreshCalls = 0;
  @override
  Future<void> refresh({String? deviceId}) {
    refreshCalls++;
    return refreshPending?.future ?? Future<void>.value();
  }

  Completer<Map<String, dynamic>>? pending;
  Map<String, dynamic> response = {'directory': fixture.page(reset: true)};
  @override
  Future<Map<String, dynamic>> projectRequest(
    String type,
    Map<String, dynamic> payload,
  ) async {
    requests.add(payload);
    if (type != 'project.sessions' || payload['directory_sync'] != true) {
      throw StateError('unexpected directory request');
    }
    if (fail) throw StateError('offline');
    return pending == null ? response : pending!.future;
  }
}

class _Secure extends SecureStore {
  final keys = <String, String>{};
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
}
