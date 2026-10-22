import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  test(
    'custom username sign-in restores immutable identity without email or official requests',
    () async {
      final requests = <String>[];
      final api = RelayApi(
        origin: 'https://selfhost.example',
        client: MockClient((request) async {
          expect(request.url.origin, 'https://selfhost.example');
          requests.add(request.url.path);
          switch (request.url.path) {
            case '/api/instance':
              return http.Response(
                '{"schema_version":1,"auth_mode":"username","setup_required":false}',
                200,
              );
            case '/api/auth/password':
              expect(jsonDecode(request.body)['username'], 'admin');
              return http.Response(
                '{}',
                200,
                headers: {
                  'set-cookie': 'relay_session=local-session; Secure; HttpOnly',
                },
              );
            case '/api/bootstrap':
              return http.Response(
                '{"user":{"auth_mode":"username","email":null,"username":"admin","account_id":"acct_0123456789abcdef0123456789abcdef"},"device":{}}',
                200,
              );
            case '/api/browser/pairings/pending':
              return http.Response('{"pairings":[]}', 200);
            default:
              fail('Unexpected request ${request.url.path}');
          }
        }),
      );
      final store = SecureStore();
      final controller = AppController(api: api, secureStore: store);
      addTearDown(controller.dispose);
      await controller.initialize();
      expect(controller.phase, AppPhase.signedOut);
      expect(controller.usernameLogin, isTrue);
      await controller.continueWithEmail('admin');
      expect(controller.loginStage, LoginStage.password);
      await controller.login('synthetic-local-password');
      expect(controller.phase, AppPhase.needsPairing);
      expect(controller.error, isEmpty);
      expect(controller.email, 'acct_0123456789abcdef0123456789abcdef');
      expect(controller.accountDisplayName, 'admin');
      expect((await store.read()).sessionToken, 'local-session');
      expect(requests, isNot(contains('/api/auth/email-status')));
      expect(requests, isNot(contains('/api/auth/magic-link')));
    },
  );
  test(
    'uninitialized custom instance cannot claim the owner or send a password',
    () async {
      final api = RelayApi(
        origin: 'https://selfhost.example',
        client: MockClient((request) async {
          expect(request.url.path, '/api/instance');
          return http.Response(
            '{"schema_version":1,"auth_mode":"username","setup_required":true}',
            200,
          );
        }),
      );
      final controller = AppController(api: api, secureStore: SecureStore());
      addTearDown(controller.dispose);
      await controller.initialize();
      await controller.continueWithEmail('admin');
      await controller.login('synthetic');
      expect(controller.phase, AppPhase.signedOut);
      expect(controller.loginStage, LoginStage.email);
      expect(controller.error, isNotEmpty);
      expect(api.sessionToken, isNull);
    },
  );
}
