import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';

void main() {
  test('large HTTP JSON retains Unicode and bootstrap metadata', () async {
    final email = '${'加载🌊' * 4000}@example.invalid';
    final api = RelayApi(
      client: MockClient(
        (_) async => http.Response.bytes(
          utf8.encode(
            jsonEncode({
              'user': {'email': email},
              'device': {'id': 'device'},
              'queued_commands': 3,
              'ack_seq': 12,
            }),
          ),
          200,
        ),
      ),
    );
    addTearDown(api.close);
    final status = await api.queueStatus(deviceId: 'device');
    expect(status.email, email);
    expect(status.queuedCommands, 3);
    expect(status.ackSequence, 12);
  });

  test(
    'large invalid JSON preserves the HTTP invalid-response error',
    () async {
      final api = RelayApi(
        client: MockClient((_) async => http.Response('${' ' * 40000}{', 502)),
      );
      addTearDown(api.close);
      await expectLater(
        api.queueStatus(deviceId: 'device'),
        throwsA(
          isA<RelayApiException>()
              .having((e) => e.status, 'status', 502)
              .having((e) => e.code, 'code', 'invalid_response'),
        ),
      );
    },
  );

  test('large rejected login cannot accept a response cookie', () async {
    final api = RelayApi(
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'padding': 'x' * 40000,
            'error': {'code': 'invalid_credentials', 'message': 'Denied'},
          }),
          401,
          headers: {
            'set-cookie': 'relay_session=must_not_be_accepted; HttpOnly',
          },
        ),
      ),
    );
    addTearDown(api.close);
    await expectLater(
      api.loginWithPassword(email: 'test@example.invalid', password: 'invalid'),
      throwsA(
        isA<RelayApiException>().having(
          (e) => e.code,
          'code',
          'invalid_credentials',
        ),
      ),
    );
    expect(api.sessionToken, isNull);
  });

  test('expired event windows expose the explicit cursor reset', () async {
    final api = RelayApi(
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'events': [],
            'next_cursor': 0,
            'has_more': false,
            'resync_required': true,
          }),
          200,
        ),
      ),
    )..browserToken = 'test_browser_token';
    addTearDown(api.close);
    final page = await api.pollEvents(deviceId: 'dev_test', cursor: 99);
    expect(page.resyncRequired, isTrue);
    expect(page.nextCursor, 0);
    expect(page.events, isEmpty);
  });
  test(
    'pairing identity is metadata and activation requires the new token',
    () async {
      final requests = <http.Request>[];
      final api = RelayApi(
        client: MockClient((request) async {
          requests.add(request);
          return http.Response(
            jsonEncode({'browser_id': 'web_test', 'activated': true}),
            200,
          );
        }),
      )..browserToken = 'new_authorization_token';
      addTearDown(api.close);
      final identity = 'android:${'a' * 64}';
      await api.respondToPairing(
        pairingId: 'pair_test',
        responderShare: 'share',
        responderConfirm: 'confirm',
        browserTokenHash: 'hash',
        browserKeyId: 'key',
        browserName: 'Phone',
        clientIdentity: identity,
      );
      expect(jsonDecode(requests.first.body)['client_identity'], identity);
      expect(
        requests.first.headers.containsKey('X-Relay-Browser-Token'),
        isFalse,
      );
      await api.activateClientDevice();
      expect(requests.last.url.path, '/api/browser/pairings/activate');
      expect(
        requests.last.headers['X-Relay-Browser-Token'],
        'new_authorization_token',
      );
      expect(jsonDecode(requests.last.body), isEmpty);
    },
  );
  test(
    'queue status requests only summary data with browser authorization',
    () async {
      late http.Request captured;
      final api = RelayApi(
        client: MockClient((request) async {
          captured = request;
          return http.Response(
            jsonEncode({
              'user': {'email': 'benchmark@example.invalid'},
              'device': {'id': 'device'},
              'queued_commands': 3,
              'ack_seq': 12,
            }),
            200,
          );
        }),
      )..browserToken = 'test_browser_token';
      addTearDown(api.close);
      final status = await api.queueStatus(deviceId: 'device');
      expect(captured.url.queryParameters, {
        'device_id': 'device',
        'summary_only': '1',
      });
      expect(captured.headers['X-Relay-Browser-Token'], 'test_browser_token');
      expect(status.queuedCommands, 3);
      expect(status.ackSequence, 12);
    },
  );

  setUp(() {
    PackageInfo.setMockInitialValues(
      appName: 'Relayune',
      packageName: 'cn.giraffetree.relayune',
      version: '0.3.20',
      buildNumber: '30',
      buildSignature: '',
    );
  });

  test(
    'magic-link request carries the resolved locale in body and headers',
    () async {
      late http.Request captured;
      final api = RelayApi(
        client: MockClient((request) async {
          captured = request;
          return http.Response('{}', 200);
        }),
      );

      await api.requestMagicLink(
        'User@Example.com',
        pairingId: 'pair_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        locale: 'ar',
      );

      expect(captured.headers['Accept-Language'], 'ar');
      expect(jsonDecode(captured.body), {
        'email': 'user@example.com',
        'pairing_id': 'pair_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'locale': 'ar',
      });
    },
  );

  test(
    'native login keeps HttpOnly session semantics in secure client state',
    () async {
      late http.Request captured;
      final api = RelayApi(
        origin: 'https://relayune.giraffetree.cn',
        client: MockClient((request) async {
          captured = request;
          return http.Response(
            jsonEncode({'authenticated': true}),
            200,
            headers: {
              'content-type': 'application/json',
              'set-cookie':
                  'relay_session=native_secret; HttpOnly; Secure; SameSite=Lax; Path=/',
            },
          );
        }),
      );

      final result = await api.loginWithPassword(
        email: 'User@Example.com',
        password: 'correct horse battery staple',
        pairingId: 'pair_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      );

      expect(result.sessionToken, 'native_secret');
      expect(api.sessionToken, 'native_secret');
      expect(captured.headers['Origin'], 'https://relayune.giraffetree.cn');
      expect(captured.headers.containsKey('Authorization'), isFalse);
      expect(jsonDecode(captured.body), {
        'email': 'user@example.com',
        'password': 'correct horse battery staple',
        'pairing_id': 'pair_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      });
    },
  );

  test('native login preserves the server authentication error', () async {
    final api = RelayApi(
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'error': {'code': 'invalid_credentials', 'message': '邮箱或密码不正确。'},
          }),
          401,
          headers: {'content-type': 'application/json'},
        ),
      ),
    );

    await expectLater(
      api.loginWithPassword(
        email: 'user@example.com',
        password: 'incorrect-password',
      ),
      throwsA(
        isA<RelayApiException>()
            .having((error) => error.status, 'status', 401)
            .having((error) => error.code, 'code', 'invalid_credentials')
            .having((error) => error.message, 'message', '邮箱或密码不正确。'),
      ),
    );
  });

  test(
    'native login explains a successful response without a session',
    () async {
      final api = RelayApi(
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({'authenticated': true}),
            200,
            headers: {'content-type': 'application/json'},
          ),
        ),
      );

      await expectLater(
        api.loginWithPassword(
          email: 'user@example.com',
          password: 'correct horse battery staple',
        ),
        throwsA(
          isA<RelayApiException>()
              .having((error) => error.status, 'status', 502)
              .having((error) => error.code, 'code', 'session_cookie_missing')
              .having(
                (error) => error.message,
                'message',
                '登录未完成，请稍后重试。若持续出现，请更新 Relayune 或联系支持。',
              ),
        ),
      );
    },
  );

  test('browser-authorized APIs send both scoped credentials', () async {
    late http.Request captured;
    final api =
        RelayApi(
            client: MockClient((request) async {
              captured = request;
              return http.Response(
                jsonEncode({
                  'protocol_version': 2,
                  'user': {'email': 'user@example.com'},
                  'device': {
                    'id': 'dev_0123456789abcdef0123456789abcdef',
                    'name': 'Mac',
                    'online': true,
                    'codex_connected': true,
                    'last_seen_at': '2026-08-09T00:00:00.000Z',
                  },
                  'catalog': null,
                  'events': [],
                  'cursor': 0,
                  'ack_seq': 0,
                  'queued_commands': 0,
                }),
                200,
              );
            }),
          )
          ..sessionToken = 'session_secret'
          ..browserToken = 'browser_secret';

    await api.bootstrap(deviceId: 'dev_0123456789abcdef0123456789abcdef');

    expect(captured.headers['Cookie'], 'relay_session=session_secret');
    expect(captured.headers['X-Relay-Browser-Token'], 'browser_secret');
    expect(captured.headers['X-Relay-Client-Version'], '0.3.20+30');
    expect(
      captured.headers['X-Relay-Client-Platform'],
      Platform.isIOS
          ? 'ios'
          : Platform.isAndroid
          ? 'android'
          : 'unknown',
    );
    expect(
      captured.url.queryParameters['device_id'],
      'dev_0123456789abcdef0123456789abcdef',
    );
  });

  test(
    'pending pairing discovery is account-scoped and contains no code',
    () async {
      late http.Request captured;
      final api = RelayApi(
        client: MockClient((request) async {
          captured = request;
          return http.Response.bytes(
            utf8.encode(
              jsonEncode({
                'has_bound_computer': true,
                'pairings': [
                  {
                    'pairing_id':
                        'pair_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                    'device_id': 'dev_0123456789abcdef0123456789abcdef',
                    'device_name': '书房 Mac',
                    'expires_at': '2026-08-12T16:00:00.000Z',
                  },
                ],
              }),
            ),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      )..sessionToken = 'session_secret';

      final discovery = await api.pendingBrowserPairings();

      expect(captured.method, 'GET');
      expect(captured.url.path, '/api/browser/pairings/pending');
      expect(captured.headers['Cookie'], 'relay_session=session_secret');
      expect(captured.headers.containsKey('X-Relay-Browser-Token'), isFalse);
      expect(captured.body, isEmpty);
      expect(discovery.hasBoundComputer, isTrue);
      expect(discovery.pairings, hasLength(1));
      expect(discovery.pairings.single.deviceName, '书房 Mac');
    },
  );

  test(
    'public release notes request the locale without sending credentials',
    () async {
      late http.Request captured;
      final api =
          RelayApi(
              client: MockClient((request) async {
                captured = request;
                return http.Response.bytes(
                  utf8.encode(
                    jsonEncode({
                      'locale': 'zh-CN',
                      'releases': [
                        {
                          'version': '0.3.0',
                          'publishedAt': '2026-08-10T12:00:00.000Z',
                          'title': '移动端更新',
                          'items': ['实时状态', '版本记录'],
                          'platforms': ['android', 'ios'],
                        },
                      ],
                    }),
                  ),
                  200,
                  headers: {'content-type': 'application/json; charset=utf-8'},
                );
              }),
            )
            ..sessionToken = 'session_secret'
            ..browserToken = 'browser_secret';

      final releases = await api.releases(locale: 'zh-CN');

      expect(captured.method, 'GET');
      expect(captured.url.path, '/api/release-notes');
      expect(captured.url.queryParameters['locale'], 'zh-CN');
      expect(captured.headers.containsKey('Cookie'), isFalse);
      expect(captured.headers.containsKey('X-Relay-Browser-Token'), isFalse);
      expect(releases, hasLength(1));
      expect(releases.single.version, '0.3.0');
      expect(releases.single.publishedAt, '2026-08-10T12:00:00.000Z');
      expect(releases.single.title, '移动端更新');
      expect(releases.single.items, ['实时状态', '版本记录']);
      expect(releases.single.platforms, ['android', 'ios']);
    },
  );
}
