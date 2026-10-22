import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';

void main() {
  test(
    'only confirmed server deletion clears the session; failed requests preserve retry credentials',
    () async {
      var reply = http.Response(
        '{"error":{"code":"invalid_credentials"}}',
        401,
      );
      final api = RelayApi(
        origin: 'https://relayune.test',
        client: MockClient((request) async {
          expect(request.method, 'POST');
          expect(request.url.path, '/api/account/delete');
          expect(
            request.headers['cookie'],
            contains('relay_session=test-session'),
          );
          expect(request.body, contains('"confirm":true'));
          expect(request.body, isNot(contains('email')));
          return reply;
        }),
      )..sessionToken = 'test-session';
      await expectLater(
        api.deleteAccount('test-password'),
        throwsA(isA<RelayApiException>()),
      );
      expect(api.sessionToken, 'test-session');
      reply = http.Response('{"deleted":false,"authenticated":false}', 200);
      await expectLater(
        api.deleteAccount('test-password'),
        throwsA(isA<RelayApiException>()),
      );
      expect(api.sessionToken, 'test-session');
      reply = http.Response('{"deleted":true,"authenticated":false}', 200);
      await api.deleteAccount('test-password');
      expect(api.sessionToken, isNull);
    },
  );
}
