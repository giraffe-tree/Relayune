import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/io_client.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/history_load_progress.dart';

Future<void> _until(bool Function() condition) async {
  for (var i = 0; i < 300 && !condition(); i++) {
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  expect(condition(), isTrue);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // This fixture binds only loopback; use real per-instance HttpClient sockets.
  HttpOverrides.global = null;
  late _HedgeFixture fixture;
  setUp(() async => fixture = await _HedgeFixture.open());
  tearDown(() async => fixture.close());

  test(
    '[MOB-RT-012][flutter] existing original HTTP response beats the real eight-second WSS timeout without executing again',
    () async {
      final watch = Stopwatch()..start();
      final result = await fixture.read();
      final elapsed = watch.elapsedMilliseconds;
      expect(result['messages'].single['content'], 'fixture history');
      expect(elapsed, lessThan(1000));
      expect(fixture.providerExecutions, 1);
      expect(fixture.posts, isEmpty);
      expect(fixture.gets, [fixture.commands.single['request_id']]);
      expect(fixture.waits.single, inInclusiveRange(1, 7500));
      // Numeric-only transport timing, from real loopback HTTP and WebSocket.
      debugPrint(
        'online_read_hedge elapsed_ms=$elapsed provider_executions=${fixture.providerExecutions}',
      );
    },
  );

  test('fast authenticated WSS result never starts HTTP', () async {
    fixture.replyImmediately = true;
    final result = await fixture.read();
    expect(result['messages'].single['content'], 'fixture history');
    await Future<void>.delayed(const Duration(milliseconds: 550));
    expect(fixture.gets, isEmpty);
    expect(fixture.posts, isEmpty);
  });

  for (final compressed in [false, true]) {
    test(
      'the original HTTP hedge shows real partial body counts with gzip=$compressed',
      () async {
        fixture.splitBodyGate = Completer<void>();
        fixture.gzipResponses = compressed;
        fixture.historyContent = 'fixture history${'x' * 100000}';
        await fixture.controller.selectSession('s', waitForHistory: false);
        await _until(
          () =>
              (fixture.controller.historyProgressFor('s')?.receivedBytes ?? 0) >
              0,
        );
        final progress = fixture.controller.historyProgressFor('s')!;
        expect(progress.phase, HistoryLoadPhase.transferring);
        expect(fixture.requestEncoding, contains('gzip'));
        if (compressed) {
          expect(progress.receiveTotalBytes, isNull);
          expect(progress.pendingReceiveBytes, isNull);
        } else {
          expect(progress.receivedBytes, lessThan(progress.receiveTotalBytes!));
          expect(progress.pendingReceiveBytes, greaterThan(0));
        }
        expect(
          fixture.controller.messages['s'],
          isNull,
          reason: 'partial ciphertext must not become history',
        );
        fixture.splitBodyGate!.complete();
        await _until(() => !fixture.controller.historyLoading.contains('s'));
        expect(
          fixture.controller.messages['s']!.single.content,
          fixture.historyContent,
        );
        expect(fixture.controller.historyProgressFor('s'), isNull);
        expect(fixture.providerExecutions, 1);
        expect(fixture.posts, isEmpty);
      },
    );
  }

  test(
    'invalid WSS response cannot defeat the valid original HTTP result',
    () async {
      final pending = fixture.read();
      await _until(() => fixture.commands.isNotEmpty);
      await fixture.reply(mismatch: 'body_session');
      expect((await pending)['messages'].single['content'], 'fixture history');
      expect(fixture.posts, isEmpty);
      expect(fixture.providerExecutions, 1);
    },
  );

  test(
    'local WSS backpressure falls back promptly without querying an unsent original id',
    () async {
      final watch = Stopwatch()..start();
      final result = await fixture.read(payload: {'fixture': 'x' * 800000});
      expect(result['type'], 'session.history');
      expect(watch.elapsedMilliseconds, lessThan(500));
      expect(fixture.commands, isEmpty);
      expect(fixture.posts, hasLength(1));
      expect(fixture.gets, fixture.posts);
      expect(fixture.providerExecutions, 1);
    },
  );

  test(
    'old server pending responses are renewed before eight seconds without a POST',
    () async {
      fixture.availableAfter = const Duration(milliseconds: 1000);
      final watch = Stopwatch()..start();
      await fixture.read();
      expect(watch.elapsedMilliseconds, lessThan(1800));
      expect(fixture.gets.length, inInclusiveRange(2, 5));
      expect(fixture.providerExecutions, 1);
      expect(fixture.posts, isEmpty);
    },
  );

  test(
    'sent WSS failure still renews pending original HTTP until the old server result arrives',
    () async {
      fixture.availableAfter = const Duration(milliseconds: 1000);
      final watch = Stopwatch()..start();
      final pending = fixture.read();
      await _until(() => fixture.commands.isNotEmpty);
      fixture.reject();
      final result = await pending;
      expect(result['request_id'], fixture.commands.single['request_id']);
      expect(watch.elapsedMilliseconds, inInclusiveRange(950, 1800));
      expect(fixture.gets.length, inInclusiveRange(2, 6));
      expect(fixture.providerExecutions, 1);
      expect(fixture.posts, isEmpty);
    },
  );

  test(
    'duplicate id admission cannot cancel the first read pending stream result',
    () async {
      fixture.holdGet = true;
      final first = fixture.read(requestId: 'same_read');
      await _until(() => fixture.commands.isNotEmpty);
      final second = await fixture.read(requestId: 'same_read');
      expect(second['request_id'], 'same_read');
      expect(fixture.posts, hasLength(1));
      await fixture.reply();
      expect((await first)['request_id'], 'same_read');
      expect(fixture.commands, hasLength(1));
      expect(fixture.posts, hasLength(1));
      expect(fixture.providerExecutions, 2);
    },
  );

  test(
    'delayed WSS winner closes the losing real HTTP socket and wait slot',
    () async {
      fixture.holdGet = true;
      final pending = fixture.read();
      await _until(() => fixture.held.isNotEmpty);
      await fixture.reply();
      expect((await pending)['messages'].single['content'], 'fixture history');
      await _until(() => fixture.closedWaits == 1);
      expect(fixture.posts, isEmpty);
      expect(fixture.providerExecutions, 1);
    },
  );

  for (final mismatch in [
    'frame_device',
    'frame_request',
    'frame_session',
    'aad_device',
    'aad_session',
    'aad_request',
    'aad_type',
    'aad_event',
    'body_type',
    'body_session',
    'body_request',
    'key',
  ]) {
    test('authenticated HTTP $mismatch cannot win over healthy WSS', () async {
      fixture.mismatch = mismatch;
      var completed = false;
      final pending = fixture.read().then((value) {
        completed = true;
        return value;
      });
      await _until(() => fixture.gets.isNotEmpty);
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(completed, isFalse);
      await fixture.reply();
      expect((await pending)['messages'].single['content'], 'fixture history');
      expect(fixture.posts, isEmpty);
    });
  }

  test('ordinary HTTP error does not cancel the delayed WSS result', () async {
    fixture.httpStatus = 502;
    final pending = fixture.read();
    await _until(() => fixture.gets.isNotEmpty);
    await fixture.reply();
    expect((await pending)['type'], 'session.history');
    expect(fixture.posts, isEmpty);
  });

  test(
    'both original routes fail before the fresh read retries once',
    () async {
      fixture.httpStatus = 502;
      final pending = fixture.read();
      await _until(() => fixture.gets.isNotEmpty);
      fixture.reject();
      final result = await pending;
      expect(result['request_id'], fixture.commands.single['request_id']);
      expect(fixture.posts, hasLength(1));
      expect(
        fixture.posts.single,
        isNot(fixture.commands.single['request_id']),
      );
    },
  );

  test(
    'shared deadline aborts a held original GET before fresh fallback',
    () async {
      fixture.holdGet = true;
      final watch = Stopwatch()..start();
      final result = await fixture.read();
      expect(result['type'], 'session.history');
      expect(watch.elapsedMilliseconds, inInclusiveRange(7900, 9500));
      await _until(() => fixture.closedWaits == 1);
      expect(fixture.posts, hasLength(1));
    },
    timeout: const Timeout(Duration(seconds: 12)),
  );

  for (final change in [
    'key',
    'device',
    'background',
    'background_resume',
    'dispose',
  ]) {
    test('$change cancels both original waits without a fresh POST', () async {
      fixture.holdGet = true;
      final pending = fixture.read();
      final rejected = expectLater(
        pending,
        throwsA(
          isA<StateError>().having(
            (e) => e.message,
            'message',
            'request_cancelled',
          ),
        ),
      );
      await _until(() => fixture.held.isNotEmpty);
      switch (change) {
        case 'key':
          fixture.controller.relayKey = null;
        case 'device':
          fixture.controller.bootstrap = _bootstrap('other');
        case 'background':
          fixture.controller.setPresentationForeground(false);
        case 'background_resume':
          fixture.controller.setPresentationForeground(false);
          fixture.controller.setPresentationForeground(
            true,
            resumeTransport: false,
          );
        case 'dispose':
          fixture.controller.dispose();
          fixture.disposed = true;
      }
      await rejected;
      await _until(() => fixture.closedWaits == 1);
      expect(fixture.posts, isEmpty);
    });
  }

  test(
    'authorization change during HTTP decrypt cannot publish its authenticated old result',
    () async {
      fixture.cipher.gate = Completer<void>();
      fixture.cipher.entered = Completer<void>();
      final rejected = expectLater(
        fixture.read(),
        throwsA(
          isA<StateError>().having(
            (e) => e.message,
            'message',
            'request_cancelled',
          ),
        ),
      );
      await fixture.cipher.entered!.future;
      fixture.controller.relayKey = null;
      await rejected;
      fixture.cipher.gate!.complete();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(fixture.posts, isEmpty);
    },
  );

  for (final status in [401, 403]) {
    test(
      'HTTP authorization denial $status rejects stale WSS and does not retry',
      () async {
        fixture.httpStatus = status;
        final rejected = expectLater(
          fixture.read(),
          throwsA(
            isA<RelayApiException>().having((e) => e.status, 'status', status),
          ),
        );
        await rejected;
        await fixture.reply();
        expect(fixture.posts, isEmpty);
      },
    );
  }
}

ServerBootstrap _bootstrap(String deviceId) => ServerBootstrap(
  email: 'fixture@example.test',
  device: RelayDevice(
    id: deviceId,
    name: 'Fixture',
    online: true,
    agentConnected: true,
    lastSeenAt: null,
  ),
  catalog: null,
  events: const [],
  cursor: 0,
  ackSequence: 0,
  queuedCommands: 0,
  onlineTransportVersion: 1,
);

class _HedgeFixture {
  _HedgeFixture(this.server, this.api, this.key, this.controller, this.cipher);
  final HttpServer server;
  final RelayApi api;
  final RelayKey key;
  final AppController controller;
  final _OpenGateCipher cipher;
  WebSocket? peer;
  final commands = <Map<String, dynamic>>[];
  final stored = <String, Map<String, dynamic>>{};
  final posts = <String>[];
  final gets = <String>[];
  final waits = <int>[];
  final held = <Socket>[];
  final started = Stopwatch()..start();
  var closedWaits = 0, providerExecutions = 0;
  var holdGet = false, replyImmediately = false, disposed = false;
  Duration? availableAfter;
  String? mismatch;
  int? httpStatus;
  Completer<void>? splitBodyGate;
  String historyContent = 'fixture history';
  bool gzipResponses = false;
  String? requestEncoding;

  static Future<_HedgeFixture> open() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final nativeHttp = HttpOverrides.runWithHttpOverrides(
      () => HttpClient(),
      _LoopbackHttpOverrides(),
    );
    final api =
        RelayApi(
            origin: 'http://127.0.0.1:${server.port}',
            allowInsecureLoopbackForTesting: true,
            client: IOClient(nativeHttp),
          )
          ..sessionToken = 'fixture_session'
          ..browserToken = 'fixture_browser';
    final key = RelayKey.import(
      base64Url.encode(List.generate(32, (i) => i)).replaceAll('=', ''),
    );
    final cipher = _OpenGateCipher();
    final controller = AppController(api: api, cipher: cipher)
      ..phase = AppPhase.ready
      ..relayKey = key
      ..bootstrap = _bootstrap('d')
      ..desktopInfo = const RelayDesktopInfo(supportsOnlineStream: true);
    final fixture = _HedgeFixture(server, api, key, controller, cipher);
    server.listen((request) async {
      if (WebSocketTransformer.isUpgradeRequest(request)) {
        fixture.peer = await WebSocketTransformer.upgrade(request);
        fixture.peer!.listen((wire) async {
          final value = jsonMap(jsonDecode(wire as String));
          if (value['type'] == 'hello') {
            fixture.peer!.add(
              jsonEncode({
                'type': 'ready',
                'connection_id': 'connection',
                'browser_id': 'browser',
              }),
            );
            fixture.peer!.add(jsonEncode({'type': 'relay', 'state': 'online'}));
          } else if (value['type'] == 'frame') {
            final command = jsonMap(value['frame']);
            fixture.commands.add(command);
            fixture.providerExecutions++;
            fixture.stored[command['request_id'] as String] = await fixture
                .response(command);
            if (fixture.replyImmediately) await fixture.reply();
          }
        });
        return;
      }
      if (request.uri.path == '/api/bootstrap') {
        await fixture.json(request, {
          'user': {'email': 'fixture@example.test'},
          'device': {'id': 'd', 'online': true},
          'response_wait_ms': 10000,
        });
        return;
      }
      if (request.uri.path == '/api/commands') {
        final command = jsonMap(
          jsonDecode(await utf8.decoder.bind(request).join()),
        );
        final id = command['request_id'] as String;
        fixture.posts.add(id);
        fixture.providerExecutions++;
        fixture.stored[id] = await fixture.response(command);
        await fixture.json(request, {
          'request_id': id,
          'delivery': 'delivered',
        });
        return;
      }
      final id = request.uri.pathSegments.last;
      fixture.gets.add(id);
      fixture.waits.add(
        int.tryParse(request.uri.queryParameters['wait_ms'] ?? '') ?? 0,
      );
      final original = !fixture.posts.contains(id);
      if (original && fixture.holdGet) {
        // A native socket waits for response headers, as a real long GET does.
        // Observe client disconnect rather than merely a mock abort signal.
        final socket = await request.response.detachSocket(writeHeaders: false);
        fixture.held.add(socket);
        socket.listen(
          (_) {},
          onDone: () {
            fixture.closedWaits++;
            socket.destroy();
          },
          onError: (_) {
            fixture.closedWaits++;
            socket.destroy();
          },
        );
        return;
      }
      if (original && fixture.httpStatus != null) {
        request.response.statusCode = fixture.httpStatus!;
        await fixture.json(request, {
          'error': {'code': 'fixture_denial', 'message': 'fixture'},
        });
        return;
      }
      if (original &&
          fixture.availableAfter != null &&
          fixture.started.elapsed < fixture.availableAfter!) {
        request.response.statusCode = 404;
        await fixture.json(request, {
          'error': {'code': 'response_pending', 'message': 'fixture'},
        });
        return;
      }
      final command = original ? fixture.commands.single : null;
      final body = original && fixture.mismatch != null
          ? await fixture.response(command!, mismatch: fixture.mismatch)
          : fixture.stored[id]!;
      await fixture.json(request, body);
    });
    await api.bootstrap(deviceId: 'd');
    controller.startOnlineForTesting();
    await _until(() => controller.connectionSnapshot.online);
    fixture.started.reset();
    return fixture;
  }

  Future<void> json(HttpRequest request, Object value) async {
    request.response.headers.contentType = ContentType.json;
    final gate = splitBodyGate;
    if (gate != null && request.uri.path.contains('/responses/')) {
      requestEncoding = request.headers.value('accept-encoding');
      List<int> body = utf8.encode(jsonEncode(value));
      if (gzipResponses) {
        body = gzip.encode(body);
        request.response.headers.set('content-encoding', 'gzip');
      }
      request.response.contentLength = body.length;
      request.response.add(body.sublist(0, body.length ~/ 2));
      await request.response.flush();
      await gate.future;
      request.response.add(body.sublist(body.length ~/ 2));
      await request.response.close();
      return;
    }
    request.response.write(jsonEncode(value));
    await request.response.close();
  }

  Future<Map<String, dynamic>> response(
    Map<String, dynamic> command, {
    String? mismatch,
  }) async {
    final id = command['request_id'] as String;
    final aad = RelayAad(
      direction: 'relay_to_web',
      type: mismatch == 'aad_type' ? 'session.agents' : 'session.history',
      deviceId: mismatch == 'aad_device' ? 'other' : 'd',
      sessionId: mismatch == 'aad_session' ? 'other' : 's',
      requestId: mismatch == 'aad_request' ? 'other' : id,
      eventSeq: mismatch == 'aad_event' ? 1 : null,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      expiresAt: null,
    );
    final responseKey = mismatch == 'key'
        ? RelayKey.import(
            base64Url.encode(List.filled(32, 99)).replaceAll('=', ''),
          )
        : key;
    final envelope = await RelayCipher().sealJson(responseKey, {
      'type': mismatch == 'body_type' ? 'session.agents' : 'session.history',
      'session_id': mismatch == 'body_session' ? 'other' : 's',
      'request_id': mismatch == 'body_request' ? 'other' : id,
      'messages': [
        {
          'id': 'fixture-message',
          'role': 'codex',
          'content': historyContent,
          'created_at': '2026-10-05T00:00:00Z',
        },
      ],
    }, aad);
    return {
      'kind': 'response',
      'device_id': mismatch == 'frame_device' ? 'other' : 'd',
      'session_id': mismatch == 'frame_session' ? 'other' : 's',
      'request_id': mismatch == 'frame_request' ? 'other' : id,
      'aad': aad.toJson(),
      'envelope': envelope.toJson(),
    };
  }

  Future<Map<String, dynamic>> read({
    Map<String, dynamic> payload = const {},
    String? requestId,
  }) async {
    final sent = await controller.sendEncryptedCommand(
      'session.read_history',
      's',
      payload,
      requestId: requestId,
    );
    return controller.waitForEncryptedResponse(sent.requestId);
  }

  Future<void> reply({String? mismatch}) async {
    final body = await response(commands.single, mismatch: mismatch);
    peer!.add(
      jsonEncode({
        'type': 'frame',
        'connection_id': 'connection',
        'browser_id': 'browser',
        'frame': body,
      }),
    );
  }

  void reject() => peer!.add(
    jsonEncode({
      'type': 'unavailable',
      'connection_id': 'connection',
      'request_id': commands.single['request_id'],
    }),
  );

  Future<void> close() async {
    if (!disposed) controller.dispose();
    api.close();
    for (final socket in held) {
      socket.destroy();
    }
    await peer?.close();
    await server.close(force: true);
  }
}

class _LoopbackHttpOverrides extends HttpOverrides {}

class _OpenGateCipher extends RelayCipher {
  Completer<void>? gate, entered;
  @override
  Future<T> openJson<T>(
    RelayKey key,
    SealedEnvelope envelope,
    RelayAad expectedAad,
  ) async {
    if (gate != null) {
      if (!entered!.isCompleted) entered!.complete();
      await gate!.future;
    }
    return super.openJson<T>(key, envelope, expectedAad);
  }
}
