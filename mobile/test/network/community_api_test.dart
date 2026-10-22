import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:relayune_mobile/src/network/community_api.dart';

void main() {
  final png = File(
    '../public/community/assets/wechat-group-d0e56e76985d54f2.png',
  ).readAsBytesSync();
  final expiry = DateTime.now()
      .add(const Duration(days: 3))
      .toUtc()
      .toIso8601String();
  Map<String, String> config(String time) => {
    'image': '/community/assets/wechat-group-test.png',
    'expiresAt': time,
  };

  test(
    'downloads current image without account headers and cache-busts config',
    () async {
      final requests = <http.Request>[];
      final api = CommunityApi(
        client: MockClient((request) async {
          requests.add(request);
          return request.url.path.endsWith('.json')
              ? http.Response(jsonEncode(config(expiry)), 200)
              : http.Response.bytes(png, 200);
        }),
      );
      addTearDown(api.close);
      final qr = await api.load();
      expect(qr.bytes, png);
      expect(qr.expired, isFalse);
      expect(requests.first.url.queryParameters['t'], isNotEmpty);
      expect(requests.first.headers['Cache-Control'], contains('no-store'));
      expect(
        requests.every(
          (r) =>
              !r.headers.containsKey('authorization') &&
              !r.headers.containsKey('cookie'),
        ),
        isTrue,
      );
    },
  );

  test('expired config does not download an expired image', () async {
    var calls = 0;
    final api = CommunityApi(
      client: MockClient((request) async {
        calls++;
        return http.Response(jsonEncode(config('2020-01-01T00:00:00Z')), 200);
      }),
    );
    addTearDown(api.close);
    final qr = await api.load();
    expect(qr.expired, isTrue);
    expect(qr.bytes, isNull);
    expect(calls, 1);
  });

  test('rejects malformed config and invalid image responses', () async {
    for (final value in [
      null,
      {},
      {...config(expiry), 'image': 'https://example.com/qr.png'},
      {...config(expiry), 'expiresAt': 'bad'},
    ]) {
      final api = CommunityApi(
        client: MockClient((_) async => http.Response(jsonEncode(value), 200)),
      );
      await expectLater(api.load(), throwsFormatException);
      api.close();
    }
    final api = CommunityApi(
      client: MockClient(
        (request) async => request.url.path.endsWith('.json')
            ? http.Response(jsonEncode(config(expiry)), 200)
            : http.Response('not an image', 200),
      ),
    );
    addTearDown(api.close);
    await expectLater(api.load(), throwsFormatException);
  });
}
