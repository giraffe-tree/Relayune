import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart' as hashes;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/notifications/notification_coordinator.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/computer_connections.dart';
import 'package:relayune_mobile/src/storage/history_store.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  for (final expired in [false, true]) {
    test(
      expired
          ? 'expired account hides restored computers and ignores late verification'
          : 'scoped computer cache opens while root account verification is pending',
      () async {
        FlutterSecureStorage.setMockInitialValues({});
        sqfliteFfiInit();
        final directory = await Directory.systemTemp.createTemp(
          'relayune-launch-',
        );
        final history = HistoryStore(
          factory: databaseFactoryFfi,
          path: '${directory.path}/history.sqlite',
        );
        final secure = SecureStore();
        await secure.saveSession('account-token');
        await secure.saveAccountEmail('owner@example.com');
        final scoped = secure.forComputer('saved-computer');
        final contentKey = base64Url
            .encode(List.filled(32, 7))
            .replaceAll('=', '');
        await scoped.savePairing(
          contentKey: contentKey,
          deviceId: 'saved-device',
          browserId: 'saved-authorization',
          browserToken: 'browser-token',
        );
        await secure.rememberComputer('owner@example.com', 'saved-computer');
        final relayKey = RelayKey.import(contentKey);
        final scope = hashes.sha256
            .convert(
              utf8.encode('owner@example.com:saved-device:${relayKey.keyId}'),
            )
            .toString();
        relayKey.dispose();
        final cacheKey = List<int>.generate(32, (i) => 31 - i);
        await scoped.saveHistoryKey(scope, base64Encode(cacheKey));
        await history.appendSessionDirectory(cacheKey, {
          'sessions': [
            {
              'id': 'saved-session',
              'name': 'Saved conversation',
              'provider': 'codex',
            },
          ],
          'projects': [],
        });
        await history.appendPage(
          cacheKey,
          'saved-session',
          null,
          HistoryPage.fromJson({
            'messages': [
              {
                'id': 'saved-message',
                'role': 'codex',
                'content': 'Cached reply',
              },
            ],
            'has_more': false,
          }),
        );
        final accountApi = _WaitingApi();
        final computerApi = _WaitingApi();
        final notifications = RelayNotificationCoordinator(
          gateway: _QuietGateway(),
        );
        final connections = ComputerConnections(
          store: secure,
          notifications: notifications,
          controllerFactory: (store, sink, manager, locale) => AppController(
            api: store.computerScope == null ? accountApi : computerApi,
            secureStore: store,
            historyStore: history,
            eventNotifications: sink,
            notificationManager: manager,
            locale: locale,
          ),
        );
        final initializing = connections.initialize();
        addTearDown(() async {
          for (final api in [accountApi, computerApi]) {
            if (!api.release.isCompleted) api.release.complete();
          }
          await initializing;
          await connections.restored;
          final controllers = connections.controllers;
          connections.dispose();
          for (final c in controllers) {
            await c.flushHistoryCache();
          }
          notifications.dispose();
          await history.close();
          await directory.delete(recursive: true);
        });
        await accountApi.entered.future.timeout(const Duration(seconds: 5));
        await computerApi.entered.future.timeout(const Duration(seconds: 2));
        expect(accountApi.release.isCompleted, isFalse);
        expect(connections.phase, AppPhase.ready);
        final computer = connections.readyComputers.single;
        expect(computer.messages['saved-session'], isNull);
        await computer.selectSession('saved-session');
        expect(
          computer.messages['saved-session']!.single.content,
          'Cached reply',
        );
        expect(computer.localReadOnly, isTrue);
        expect(computer.deviceOnline, isFalse);
        await expectLater(
          computer.sendEncryptedCommand(
            'session.interrupt_turn',
            'saved-session',
            {},
          ),
          throwsStateError,
        );
        if (expired) {
          accountApi.failure = const RelayApiException(
            'Expired',
            401,
            'unauthorized',
          );
          accountApi.release.complete();
          await initializing;
          expect(connections.phase, AppPhase.signedOut);
          computerApi.release.complete();
          await connections.restored;
          expect(connections.phase, AppPhase.signedOut);
          // Account rejection hides the UI immediately; credential cleanup is
          // asynchronous and must finish before checking the retained registry.
          await (() async {
            while (connections.computers.contains(computer)) {
              await Future<void>.delayed(Duration.zero);
            }
          })().timeout(const Duration(seconds: 5));
          expect(connections.readyComputers, isEmpty);
          expect((await scoped.read()).hasPairing, isTrue);
          expect(await scoped.readHistoryKey(scope), isNull);
        } else {
          accountApi.release.complete();
          computerApi.release.complete();
          await initializing;
          await connections.restored;
          expect(connections.phase, AppPhase.ready);
          expect(computer.localReadOnly, isTrue);
        }
      },
    );
  }
}

class _WaitingApi extends RelayApi {
  final entered = Completer<void>();
  final release = Completer<void>();
  RelayApiException failure = const RelayApiException(
    'Offline',
    0,
    'network_unavailable',
  );

  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) async {
    if (!entered.isCompleted) entered.complete();
    await release.future;
    throw failure;
  }
}

class _QuietGateway extends RelayNotificationGateway {
  @override
  Future<String?> initialize({
    required RelayNotificationResponseCallback onResponse,
  }) async => null;
  @override
  Future<bool> requestAuthorization() async => false;
  @override
  Future<bool?> authorizationEnabled() async => false;
  @override
  Future<void> openSettings() async {}
  @override
  Future<void> show(RelayLocalNotification notification) async {}
  @override
  Future<void> cancel(int notificationId) async {}
}
