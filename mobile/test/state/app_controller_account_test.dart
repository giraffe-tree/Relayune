import 'dart:convert';
import 'dart:async';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test(
    'restoring an account authenticates bootstrap then discovers pairings',
    () async {
      final requests = <http.Request>[];
      final api = RelayApi(
        client: MockClient((request) async {
          requests.add(request);
          final body = switch (request.url.path) {
            '/api/bootstrap' => {
              'user': {'email': 'owner@example.com'},
              'device': {'id': ''},
            },
            '/api/browser/pairings/pending' => {
              'has_bound_computer': false,
              'pairings': [],
            },
            _ => throw StateError('Unexpected request: ${request.url.path}'),
          };
          expect(request.headers['Cookie'], 'relay_session=session');
          return http.Response(jsonEncode(body), 200);
        }),
      );
      final store = SecureStore();
      await store.saveSession('session');
      final controller = AppController(api: api, secureStore: store);
      addTearDown(controller.dispose);
      await controller.initialize();
      expect(controller.phase, AppPhase.needsPairing);
      expect(controller.email, 'owner@example.com');
      expect(requests.map((r) => r.url.path), [
        '/api/bootstrap',
        '/api/browser/pairings/pending',
      ]);
    },
  );

  test('rejected online identity clears the stored account session', () async {
    final api = RelayApi(
      client: MockClient(
        (request) async => http.Response(
          jsonEncode({
            'error': {'code': 'unauthorized'},
          }),
          401,
        ),
      ),
    );
    final store = SecureStore();
    await store.saveSession('rejected');
    final controller = AppController(api: api, secureStore: store);
    addTearDown(controller.dispose);
    await controller.initialize();
    expect(controller.phase, AppPhase.signedOut);
    expect(api.sessionToken, isNull);
    expect((await store.read()).sessionToken, isNull);
  });

  test(
    'password login restores the account using only authentication and pairing APIs',
    () async {
      final paths = <String>[];
      final api = RelayApi(
        client: MockClient((request) async {
          paths.add(request.url.path);
          if (request.url.path == '/api/auth/password') {
            return http.Response(
              '{}',
              200,
              headers: {'set-cookie': 'relay_session=new-session; HttpOnly'},
            );
          }
          expect(request.headers['Cookie'], 'relay_session=new-session');
          if (request.url.path == '/api/bootstrap') {
            return http.Response(
              jsonEncode({
                'user': {'email': 'owner@example.com'},
                'device': {'id': ''},
              }),
              200,
            );
          }
          if (request.url.path == '/api/browser/pairings/pending') {
            return http.Response(
              jsonEncode({'has_bound_computer': false, 'pairings': []}),
              200,
            );
          }
          throw StateError('Unexpected request: ${request.url.path}');
        }),
      );
      final store = SecureStore();
      final controller = AppController(api: api, secureStore: store)
        ..email = 'owner@example.com';
      addTearDown(controller.dispose);
      await controller.login('test-password');
      expect(controller.phase, AppPhase.needsPairing);
      expect((await store.read()).sessionToken, 'new-session');
      expect(paths, [
        '/api/auth/password',
        '/api/bootstrap',
        '/api/browser/pairings/pending',
      ]);
    },
  );

  test(
    'disposing during local restoration prevents the later account request',
    () async {
      final api = _CountingIdentityApi();
      final store = _DelayedLocalStore();
      final controller = AppController(api: api, secureStore: store);
      final restoring = controller.initialize(
        credentials: StoredCredentials(
          sessionToken: 'session',
          browserToken: 'browser-token',
          browserId: 'browser',
          deviceId: 'device',
          contentKey: base64UrlEncode(List.filled(32, 7)).replaceAll('=', ''),
        ),
      );
      await store.entered.future.timeout(const Duration(seconds: 3));
      controller.dispose();
      store.release.complete(null);
      await restoring;
      expect(api.calls, 0);
    },
  );

  test(
    'signed-out clients cannot send commands or request account data',
    () async {
      var requests = 0;
      final api = RelayApi(
        client: MockClient((_) async {
          requests++;
          throw StateError('Signed-out request');
        }),
      );
      final controller = AppController(api: api, secureStore: SecureStore());
      addTearDown(controller.dispose);
      await controller.initialize();
      expect(controller.phase, AppPhase.signedOut);
      await expectLater(
        controller.sendEncryptedCommand(
          'session.interrupt_turn',
          'session',
          {},
        ),
        throwsStateError,
      );
      expect(requests, 0);
    },
  );
}

class _DelayedLocalStore extends SecureStore {
  final entered = Completer<void>();
  final release = Completer<String?>();
  @override
  Future<String?> lastAccountEmail() {
    entered.complete();
    return release.future;
  }
}

class _CountingIdentityApi extends RelayApi {
  int calls = 0;
  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) async {
    calls++;
    throw StateError('Disposed account requested identity');
  }
}
