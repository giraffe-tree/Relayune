import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/network/online_stream.dart';

void main() {
  late HttpServer server;
  late OnlineStream stream;
  late WebSocket peer;
  late StreamIterator<dynamic> incoming;
  late DateTime now;
  setUp(() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final accepted = Completer<WebSocket>();
    server.listen((request) async {
      accepted.complete(await WebSocketTransformer.upgrade(request));
    });
    now = DateTime.utc(2026, 9, 23);
    stream = OnlineStream(
      origin: 'http://127.0.0.1:${server.port}',
      sessionToken: 'session',
      browserToken: 'browser',
      deviceId: 'device',
      now: () => now,
      onFrame: (_) async {},
      onOnline: () {},
      onClosed: () {},
    );
    await stream.connect();
    peer = await accepted.future;
    incoming = StreamIterator(peer);
    await incoming.moveNext();
    expect(jsonDecode(incoming.current as String)['type'], 'hello');
    peer.add(
      jsonEncode({'type': 'ready', 'connection_id': 'c', 'browser_id': 'b'}),
    );
    peer.add(jsonEncode({'type': 'relay', 'state': 'online'}));
    for (var i = 0; i < 50 && !stream.available; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 2));
    }
    expect(stream.available, true);
  });
  tearDown(() async {
    stream.close();
    await incoming.cancel();
    await peer.close();
    await server.close(force: true);
  });
  test(
    'business lease expires even while socket and native pong remain alive',
    () {
      now = now.add(const Duration(seconds: 31));
      stream.renew();
      expect(stream.available, false);
    },
  );
  test(
    'response binds connection generation; oversized ciphertext is not sent',
    () async {
      final pending = stream.request({
        'request_id': 'r',
        'envelope': {'ciphertext': 'sealed'},
      });
      await incoming.moveNext();
      final sent = jsonDecode(incoming.current as String) as Map;
      expect(sent['connection_id'], 'c');
      expect(sent['frame']['envelope']['ciphertext'], 'sealed');
      peer.add(
        jsonEncode({
          'type': 'frame',
          'connection_id': 'old',
          'browser_id': 'b',
          'frame': {'kind': 'response', 'request_id': 'r'},
        }),
      );
      var completed = false;
      unawaited(
        pending.then((_) {
          completed = true;
        }),
      );
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(completed, false);
      peer.add(
        jsonEncode({
          'type': 'frame',
          'connection_id': 'c',
          'browser_id': 'b',
          'frame': {'kind': 'response', 'request_id': 'r'},
        }),
      );
      expect((await pending)['request_id'], 'r');
      expect(
        () => stream.send({'ciphertext': 'x' * 1048576}),
        throwsStateError,
      );
    },
  );
  test(
    'missing Desktop rejects immediately and user writes never enter read lane',
    () async {
      final pending = stream.request({'request_id': 'r'});
      peer.add(
        jsonEncode({
          'type': 'unavailable',
          'connection_id': 'c',
          'request_id': 'r',
        }),
      );
      await expectLater(
        pending,
        throwsA(
          isA<StateError>().having(
            (e) => e is OnlineRequestNotSentError,
            'local failure',
            isFalse,
          ),
        ),
      );
      for (final type in [
        'session.submit_message',
        'approval.resolve',
        'session.create',
      ]) {
        expect(onlineReadTypes.contains(type), false);
      }
    },
  );
  test('no more than eight request futures are retained', () async {
    final pending = List.generate(
      8,
      (i) => stream.request({'request_id': 'r$i'}),
    );
    final errors = pending
        .map((request) => expectLater(request, throwsStateError))
        .toList();
    await expectLater(
      stream.request({'request_id': 'excess'}),
      throwsA(isA<OnlineRequestNotSentError>()),
    );
    stream.close();
    await Future.wait(errors);
  });
  test(
    'completed request cleanup cannot cancel a newer waiter with the same id',
    () async {
      void reply() => peer.add(
        jsonEncode({
          'type': 'frame',
          'connection_id': 'c',
          'browser_id': 'b',
          'frame': {'kind': 'response', 'request_id': 'reused'},
        }),
      );
      final previous = stream.request({'request_id': 'reused'});
      await incoming.moveNext();
      reply();
      await previous;
      final next = stream.request({'request_id': 'reused'});
      await incoming.moveNext();
      stream.cancelRequest('reused', expectedFuture: previous);
      reply();
      expect((await next)['request_id'], 'reused');
    },
  );
  test(
    'local backpressure and unavailable sends explicitly mark requests not sent',
    () async {
      await expectLater(
        stream.request({'request_id': 'large', 'ciphertext': 'x' * 1048576}),
        throwsA(isA<OnlineRequestNotSentError>()),
      );
      stream.close();
      await expectLater(
        stream.request({'request_id': 'closed'}),
        throwsA(isA<OnlineRequestNotSentError>()),
      );
    },
  );
}
