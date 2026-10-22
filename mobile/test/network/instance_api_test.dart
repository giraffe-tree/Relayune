import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/config.dart';
import 'package:relayune_mobile/src/network/instance_endpoint.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'a configurable build default never grants official-service identity',
    () {
      final previous = RelayConfig.activeOrigin;
      RelayConfig.activeOrigin = 'https://selfhost.example';
      expect(RelayConfig.usesOfficialService, isFalse);
      RelayConfig.activeOrigin = RelayConfig.officialOrigin;
      expect(RelayConfig.usesOfficialService, isTrue);
      RelayConfig.activeOrigin = previous;
    },
  );
  test('API rejects remote HTTP and credential-bearing origins', () {
    expect(() => RelayApi(origin: 'http://192.0.2.10'), throwsFormatException);
    expect(
      () => RelayApi(origin: 'https://user:password@example.com'),
      throwsFormatException,
    );
    expect(
      () => RelayApi(
        origin: 'http://192.0.2.10',
        allowInsecureLoopbackForTesting: true,
      ),
      throwsFormatException,
    );
    expect(() => RelayApi(origin: 'http://127.0.0.1'), throwsFormatException);
  });
  test('strict HTTPS origins reject credentials, paths and unsafe schemes', () {
    expect(
      normalizeInstanceOrigin(' https://192.0.2.10:3443/ '),
      'https://192.0.2.10:3443',
    );
    for (final value in [
      'http://192.0.2.10',
      'https://u:p@example.com',
      'https://example.com/path',
      'https://example.com?q=x',
      'https://example.com/#x',
    ]) {
      expect(() => normalizeInstanceOrigin(value), throwsFormatException);
    }
  });
  test('WSS default 443 and explicit 443 match the confirmed HTTPS origin', () {
    for (final origin in [
      'https://server.example',
      'https://server.example:443',
    ]) {
      for (final url in [
        'wss://server.example/api/stream',
        'wss://server.example:443/api/stream',
      ]) {
        expect(normalizeInstanceSocketUri(origin, url).scheme, 'wss');
      }
    }
    expect(
      normalizeInstanceSocketUri(
        'https://server.example:8443',
        'wss://server.example:8443/api/stream',
      ).port,
      8443,
    );
  });
  test('socket default-port normalization preserves all origin boundaries', () {
    for (final url in [
      'wss://server.example:8443/api/stream',
      'wss://server.example:80/api/stream',
      'wss://server.example:0/api/stream',
      'wss://other.example/api/stream',
      'wss://user:password@server.example/api/stream',
      'ws://server.example:443/api/stream',
      'https://server.example/api/stream',
    ]) {
      expect(
        () => normalizeInstanceSocketUri('https://server.example', url),
        throwsFormatException,
      );
    }
    expect(
      () => normalizeInstanceSocketUri(
        'https://server.example:8443',
        'wss://server.example/api/stream',
      ),
      throwsFormatException,
    );
  });
  test(
    'WS default 80 remains limited to explicitly enabled loopback fixtures',
    () {
      for (final url in [
        'ws://localhost/api/stream',
        'ws://localhost:80/api/stream',
      ]) {
        expect(
          normalizeInstanceSocketUri(
            'http://localhost',
            url,
            allowInsecureLoopbackForTesting: true,
          ).scheme,
          'ws',
        );
        expect(
          () => normalizeInstanceSocketUri('http://localhost', url),
          throwsFormatException,
        );
      }
      expect(
        () => normalizeInstanceSocketUri(
          'http://server.example',
          'ws://server.example/api/stream',
          allowInsecureLoopbackForTesting: true,
        ),
        throwsFormatException,
      );
      expect(
        () => normalizeInstanceSocketUri(
          'http://localhost',
          'ws://localhost:81/api/stream',
          allowInsecureLoopbackForTesting: true,
        ),
        throwsFormatException,
      );
    },
  );
  test(
    'capability probe never sends existing credentials or follows redirects',
    () async {
      final api =
          RelayApi(
              origin: 'https://custom.example',
              client: MockClient((request) async {
                expect(
                  request.url.toString(),
                  'https://custom.example/api/instance',
                );
                expect(request.followRedirects, isFalse);
                final names = request.headers.keys.map((k) => k.toLowerCase());
                expect(names, isNot(contains('cookie')));
                expect(names, isNot(contains('x-relay-browser-token')));
                return http.Response(
                  '{"schema_version":1,"auth_mode":"username","setup_required":false}',
                  200,
                );
              }),
            )
            ..sessionToken = 'old-session'
            ..browserToken = 'old-browser';
      expect((await api.discoverInstance()).usernameMode, isTrue);
      api.close();
    },
  );
  test('unknown schema refuses implicit email login fallback', () async {
    final api = RelayApi(
      origin: 'https://custom.example',
      client: MockClient(
        (_) async => http.Response(
          '{"schema_version":2,"auth_mode":"username","setup_required":false}',
          200,
        ),
      ),
    );
    await expectLater(api.discoverInstance(), throwsFormatException);
    api.close();
  });
  test(
    'username login sends username only to selected origin with secure cookie contract',
    () async {
      final api = RelayApi(
        origin: 'https://custom.example',
        client: MockClient((request) async {
          expect(request.url.origin, 'https://custom.example');
          expect(request.followRedirects, isFalse);
          final body = jsonDecode(request.body) as Map;
          expect(body['username'], 'admin');
          expect(body.containsKey('email'), isFalse);
          return http.Response(
            '{}',
            200,
            headers: {
              'set-cookie':
                  'relay_session=new-instance-session; Secure; HttpOnly',
            },
          );
        }),
      );
      expect(
        (await api.loginWithPassword(
          email: 'admin',
          password: 'synthetic',
          usernameMode: true,
        )).sessionToken,
        'new-instance-session',
      );
      api.close();
    },
  );
  test(
    'username bootstrap uses immutable account id and separates display name',
    () {
      final value = ServerBootstrap.fromJson({
        'user': {
          'auth_mode': 'username',
          'email': null,
          'account_id': 'acct_0123456789abcdef0123456789abcdef',
          'username': 'admin',
        },
        'device': {},
      });
      expect(value.email, 'acct_0123456789abcdef0123456789abcdef');
      expect(value.accountDisplayName, 'admin');
    },
  );
  test(
    'self-revoke carries its own account and browser authorization',
    () async {
      final api =
          RelayApi(
              origin: 'https://custom.example',
              client: MockClient((request) async {
                expect(request.url.path, '/api/browser/authorizations/revoke');
                expect(request.headers['Cookie'], 'relay_session=session');
                expect(request.headers['X-Relay-Browser-Token'], 'browser');
                expect(request.headers['Origin'], 'https://custom.example');
                return http.Response('{"revoked":true}', 200);
              }),
            )
            ..sessionToken = 'session'
            ..browserToken = 'browser';
      await api.revokeOwnAuthorization();
      api.close();
    },
  );
}
