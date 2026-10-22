import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:relayune_mobile/src/config.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/notifications/notification_coordinator.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/computer_connections.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';

class _Gateway extends RelayNotificationGateway {
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

class _Controller extends AppController {
  _Controller(
    this.store,
    RelayEventNotificationSink sink,
    RelayNotificationManager manager,
    Locale locale,
  ) : super(
        api: RelayApi(
          client: MockClient((request) async => http.Response('{}', 200)),
        ),
        secureStore: store,
        eventNotifications: sink,
        notificationManager: manager,
        locale: locale,
      );
  final SecureStore store;
  @override
  Future<void> initialize({
    Uri? initialLink,
    StoredCredentials? credentials,
  }) async {
    final saved = credentials ?? await store.read();
    api.sessionToken = saved.sessionToken;
    api.browserToken = saved.browserToken;
    email = saved.sessionToken == null ? '' : 'admin';
    phase = saved.sessionToken == null ? AppPhase.signedOut : AppPhase.ready;
    notifyListeners();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late String originalOrigin;
  String? originalPem;
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    originalOrigin = RelayConfig.activeOrigin;
    originalPem = RelayConfig.activeCertificatePem;
    RelayConfig.activeOrigin = Uri.parse(RelayConfig.productionOrigin).origin;
    RelayConfig.activeCertificatePem = null;
  });
  tearDown(() {
    RelayConfig.activeOrigin = originalOrigin;
    RelayConfig.activeCertificatePem = originalPem;
  });
  test(
    'confirmed switch tears down old origin, destroys all credentials, and requires fresh login',
    () async {
      final store = SecureStore();
      await store.saveSession('old-session');
      await store.saveAccountEmail('admin');
      await store.savePairing(
        contentKey: base64Url.encode(List.filled(32, 7)),
        deviceId: 'device',
        browserId: 'old-browser',
        browserToken: 'old-browser-token',
      );
      await store.saveHistoryKey('orphan-cache', 'cache-key');
      final cleanupRequests = <String>[];
      final notifications = RelayNotificationCoordinator(gateway: _Gateway());
      final connections = ComputerConnections(
        store: store,
        notifications: notifications,
        controllerFactory: (storage, sink, manager, locale) =>
            _Controller(storage, sink, manager, locale),
        cleanupApiFactory: (old) => RelayApi(
          origin: old.origin,
          client: MockClient((request) async {
            expect(
              request.url.origin,
              Uri.parse(RelayConfig.productionOrigin).origin,
            );
            cleanupRequests.add(request.url.path);
            return http.Response('{}', 200);
          }),
        ),
      );
      addTearDown(() {
        connections.dispose();
        notifications.dispose();
      });
      await connections.initialize();
      final old = connections.account;
      var stoppedNative = false;
      connections.beforeLogout = () async {
        expect(connections.phase, AppPhase.loading);
        stoppedNative = true;
      };
      await connections.switchInstance('https://my-instance.example', null);
      expect(stoppedNative, isTrue);
      expect(identical(connections.account, old), isFalse);
      expect(connections.account.api.origin, 'https://my-instance.example');
      expect(connections.phase, AppPhase.signedOut);
      expect(connections.computers, isEmpty);
      expect(connections.account.api.sessionToken, isNull);
      expect(connections.account.api.browserToken, isNull);
      expect(
        cleanupRequests,
        containsAll(['/api/browser/authorizations/revoke', '/api/auth/logout']),
      );
      expect((await store.read()).sessionToken, isNull);
      expect((await store.read()).hasPairing, isFalse);
      expect(await store.allHistoryKeys(), isEmpty);
      expect(
        (await store.selectedInstance())!.origin,
        'https://my-instance.example',
      );
      await expectLater(
        old.api.emailStatus('admin'),
        throwsA(isA<RelayApiException>()),
      );
      await connections.switchInstance(RelayConfig.productionOrigin, null);
      expect(connections.phase, AppPhase.signedOut);
      expect(connections.account.api.sessionToken, isNull);
    },
  );
}
