import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';

void main() {
  final payload = utf8.encode(
    jsonEncode({
      'device_id': 'test-device',
      'aad': {
        'direction': 'relay_to_web',
        'type': 'session.attachment',
        'device_id': 'test-device',
        'created_at': '2026-09-05T00:00:00Z',
      },
      'envelope': {
        'v': 2,
        'alg': 'A256GCM',
        'kid': 'test-key',
        'iv': 'fixture',
        'aad': 'fixture',
        'ciphertext': 'fixture',
      },
    }),
  );

  test(
    'encrypted download reports actual bytes while the stream is open',
    () async {
      final chunks = StreamController<List<int>>();
      final updates = <DownloadProgress>[];
      final firstChunk = Completer<void>();
      final api = RelayApi(
        client: MockClient.streaming((request, _) async {
          expect(request.headers['Accept-Encoding'], 'identity');
          return http.StreamedResponse(
            chunks.stream,
            200,
            contentLength: payload.length,
          );
        }),
      );
      addTearDown(api.close);
      var completed = false;
      final result = api
          .encryptedResponse(
            'test',
            onProgress: (progress) {
              updates.add(progress);
              if (progress.receivedBytes > 0 && !firstChunk.isCompleted) {
                firstChunk.complete();
              }
            },
          )
          .then((frame) {
            completed = true;
            return frame;
          });
      final split = payload.length ~/ 5;
      chunks.add(payload.sublist(0, split));
      await firstChunk.future;
      expect(completed, isFalse);
      expect(updates.last.receivedBytes, split);
      expect(updates.last.fraction, split / payload.length);
      chunks.add(payload.sublist(split));
      await chunks.close();
      expect((await result).deviceId, 'test-device');
      expect(updates.last.fraction, 1);
    },
  );

  test('pending polling responses do not report download progress', () async {
    final updates = <DownloadProgress>[];
    final api = RelayApi(
      client: MockClient(
        (_) async =>
            http.Response('{"error":{"code":"response_pending"}}', 404),
      ),
    );
    addTearDown(api.close);
    await expectLater(
      api.encryptedResponse('test', onProgress: updates.add),
      throwsA(isA<RelayApiException>()),
    );
    expect(updates, isEmpty);
  });

  for (final compressed in [false, true]) {
    test(
      'unknown or compressed length never invents a percentage ($compressed)',
      () async {
        final updates = <DownloadProgress>[];
        final api = RelayApi(
          client: MockClient.streaming(
            (_, _) async => http.StreamedResponse(
              Stream.fromIterable([
                payload.sublist(0, 10),
                payload.sublist(10),
              ]),
              200,
              contentLength: compressed ? 10 : null,
              headers: compressed ? {'content-encoding': 'gzip'} : {},
            ),
          ),
        );
        addTearDown(api.close);
        await api.encryptedResponse('test', onProgress: updates.add);
        expect(updates[1].receivedBytes, 10);
        expect(updates[1].fraction, isNull);
        expect(updates.last.fraction, 1);
      },
    );
  }

  test('truncated download fails without reporting completion', () async {
    final updates = <DownloadProgress>[];
    final api = RelayApi(
      client: MockClient.streaming(
        (_, _) async => http.StreamedResponse(
          Stream.value(payload.sublist(0, 10)),
          200,
          contentLength: payload.length,
        ),
      ),
    );
    addTearDown(api.close);
    await expectLater(
      api.encryptedResponse('test', onProgress: updates.add),
      throwsA(isA<RelayApiException>()),
    );
    expect(updates.last.fraction, lessThan(1));
  });
  test('response waits are negotiated, scoped to credentials, and backward compatible', () async {
    final paths = <Uri>[];
    int? offered = 10000;
    final api = RelayApi(client: MockClient((request) async {
      paths.add(request.url);
      if (request.url.path == '/api/bootstrap') {
        return http.Response(jsonEncode({
          'user': {'email': 'test@example.com'},
          'device': {'id': 'test-device', 'name': 'Test', 'online': true},
          'events': [],
          if (offered != null) 'response_wait_ms': offered,
        }), 200);
      }
      return http.Response.bytes(payload, 200);
    }));
    addTearDown(api.close);
    api.sessionToken = 'session';
    api.browserToken = 'browser';
    await api.bootstrap(deviceId: 'test-device');
    await api.encryptedResponse('result');
    expect(paths.last.queryParameters, {'device_id': 'test-device', 'wait_ms': '10000'});
    api.browserToken = 'replacement';
    await api.encryptedResponse('result');
    expect(paths.last.hasQuery, false);
    offered = null;
    await api.bootstrap(deviceId: 'test-device');
    await api.encryptedResponse('result');
    expect(paths.last.hasQuery, false);
    offered = 60000;
    await api.bootstrap(deviceId: 'test-device');
    await api.encryptedResponse('result');
    expect(paths.last.queryParameters['wait_ms'], '10000');
    api.sessionToken = 'new-session';
    await api.encryptedResponse('result');
    expect(paths.last.hasQuery, false);
  });

}
