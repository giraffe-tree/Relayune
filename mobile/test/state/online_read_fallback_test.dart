import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';

Future<void> _until(bool Function() ready) async {
  for (var i = 0; i < 1500 && !ready(); i++) {
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  expect(ready(), isTrue);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // This fixture binds only loopback; use real per-instance HttpClient sockets.
  HttpOverrides.global = null;
  late _FallbackFixture fixture;
  setUp(() async {
    fixture = await _FallbackFixture.open();
  });
  tearDown(() async {
    await fixture.close();
  });

  test(
    '[MOB-RT-012][flutter] an eight-second WSS timeout recovers with a fresh authenticated HTTP read despite the late original reply',
    () async {
      fixture.api.responseGate = Completer<void>();
      final original = await fixture.controller.sendEncryptedCommand(
        'session.read_history',
        's',
        {'limit': 100, 'before': 'cursor'},
      );
      final pending = fixture.controller.waitForEncryptedResponse(
        original.requestId,
        timeout: const Duration(seconds: 15),
      );
      await _until(() => fixture.onlineFrames.isNotEmpty);
      final online = fixture.onlineFrames.single;
      final onlineAad = RelayAad.fromJson(jsonMap(online['aad']));
      expect(original.requestId, onlineAad.requestId);
      await _until(() => fixture.api.frames.isNotEmpty);
      final fallback = fixture.api.frames.single;
      expect(fallback.aad.requestId, isNot(original.requestId));
      expect(fallback.aad.sessionId, 's');
      expect(fallback.aad.type, 'session.read_history');
      expect(fallback.envelope.toJson(), isNot(online['envelope']));
      final command = await RelayCipher().openJson<Map<String, dynamic>>(
        fixture.key,
        fallback.envelope,
        fallback.aad,
      );
      expect(command['request_id'], fallback.aad.requestId);
      expect(command['payload'], {'limit': 100, 'before': 'cursor'});
      await fixture.reply(original.requestId, content: 'late original');
      fixture.api.responseGate!.complete();
      final result = await pending;
      expect(result['request_id'], original.requestId);
      expect(result['session_id'], 's');
      expect(result['messages'].single['content'], 'HTTP recovered');
      expect(fixture.onlineFrames, hasLength(1));
      expect(fixture.api.frames, hasLength(1));
      expect(fixture.api.responseIds, [fallback.aad.requestId]);
    },
    timeout: const Timeout(Duration(seconds: 20)),
  );

  test(
    'project reads retain the caller request after a fresh HTTP fallback',
    () async {
      fixture.api.responseType = 'project.result';
      final original = await fixture.controller.sendEncryptedCommand(
        'project.locations',
        null,
        {'provider': 'codex'},
      );
      final pending = fixture.controller.waitForEncryptedResponse(
        original.requestId,
      );
      await fixture.reject(original.requestId);
      final result = await pending;
      expect(result['type'], 'project.result');
      expect(result['request_id'], original.requestId);
      expect(result['session_id'], isNull);
      expect(
        fixture.api.frames.single.aad.requestId,
        isNot(original.requestId),
      );
    },
  );

  for (final resume in [false, true]) {
    test(
      'background during fallback sealing cancels before HTTP (resume=$resume)',
      () async {
        final original = await fixture.controller.sendEncryptedCommand(
          'session.read_history',
          's',
          {},
        );
        final pending = fixture.controller.waitForEncryptedResponse(
          original.requestId,
        );
        final rejected = expectLater(
          pending,
          throwsA(
            isA<StateError>().having(
              (error) => error.message,
              'message',
              'request_cancelled',
            ),
          ),
        );
        fixture.cipher.sealGate = Completer<void>();
        fixture.cipher.sealStarted = Completer<void>();
        await fixture.reject(original.requestId);
        await fixture.cipher.sealStarted!.future;
        fixture.controller.setPresentationForeground(false);
        if (resume) {
          fixture.controller.setPresentationForeground(
            true,
            resumeTransport: false,
          );
        }
        fixture.cipher.sealGate!.complete();
        await rejected;
        expect(fixture.api.frames, isEmpty);
      },
    );
  }

  for (final change in ['key', 'device', 'background']) {
    for (final stage in ['online', 'http']) {
      test('$change change during $stage cancels the pending read', () async {
        fixture.api.responseGate = Completer<void>();
        final original = await fixture.controller.sendEncryptedCommand(
          'session.read_history',
          's',
          {},
        );
        final pending = fixture.controller.waitForEncryptedResponse(
          original.requestId,
        );
        final rejected = expectLater(
          pending,
          stage == 'http'
              ? throwsA(
                  isA<RelayApiException>().having(
                    (error) => error.code,
                    'code',
                    'request_cancelled',
                  ),
                )
              : throwsA(
                  isA<StateError>().having(
                    (error) => error.message,
                    'message',
                    'request_cancelled',
                  ),
                ),
        );
        await _until(() => fixture.onlineFrames.isNotEmpty);
        if (stage == 'http') {
          await fixture.reject(original.requestId);
          await _until(() => fixture.api.responseIds.isNotEmpty);
        }
        switch (change) {
          case 'key':
            fixture.controller.relayKey = null;
          case 'device':
            fixture.controller.bootstrap = _bootstrap('another');
          case 'background':
            fixture.controller.setPresentationForeground(false);
        }
        if (stage == 'online' && change != 'background') {
          await fixture.reject(original.requestId);
        }
        fixture.api.responseGate!.complete();
        await rejected;
        expect(fixture.api.frames, hasLength(stage == 'http' ? 1 : 0));
      });
    }
  }

  for (final mismatch in [
    'frame_session',
    'aad_session',
    'aad_type',
    'aad_event',
    'body_type',
    'body_session',
    'body_request',
  ]) {
    test('HTTP fallback rejects authenticated $mismatch mismatches', () async {
      fixture.api.mismatch = mismatch;
      final original = await fixture.controller.sendEncryptedCommand(
        'session.read_history',
        's',
        {},
      );
      final pending = fixture.controller.waitForEncryptedResponse(
        original.requestId,
      );
      final rejected = expectLater(pending, throwsFormatException);
      await fixture.reject(original.requestId);
      await rejected;
      expect(fixture.api.frames, hasLength(1));
    });
  }

  test(
    'writes keep their single exact HTTP admission while WSS is connected',
    () async {
      for (final type in [
        'session.create',
        'session.submit_message',
        'approval.resolve',
      ]) {
        final result = await fixture.controller.sendEncryptedCommand(
          type,
          's',
          {'content': 'controlled fixture'},
          requestId: 'original_$type',
        );
        expect(result.requestId, 'original_$type');
      }
      expect(fixture.onlineFrames, isEmpty);
      expect(fixture.api.frames, hasLength(3));
      expect(fixture.api.frames.map((frame) => frame.aad.requestId), [
        'original_session.create',
        'original_session.submit_message',
        'original_approval.resolve',
      ]);
    },
  );
}

ServerBootstrap _bootstrap(String deviceId) => ServerBootstrap(
  email: 'fixture@example.test',
  device: RelayDevice(
    id: deviceId,
    name: 'Fixture desktop',
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

class _FallbackFixture {
  _FallbackFixture(
    this.server,
    this.key,
    this.api,
    this.controller,
    this.cipher,
  );
  final HttpServer server;
  final RelayKey key;
  final _FallbackApi api;
  final AppController controller;
  final _GateCipher cipher;
  WebSocket? peer;
  final onlineFrames = <Map<String, dynamic>>[];

  static Future<_FallbackFixture> open() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final key = RelayKey.import(
      base64Url.encode(List.generate(32, (i) => i)).replaceAll('=', ''),
    );
    final api = _FallbackApi('http://127.0.0.1:${server.port}', key)
      ..sessionToken = 'fixture_session'
      ..browserToken = 'fixture_browser';
    final cipher = _GateCipher();
    final controller = AppController(api: api, cipher: cipher)
      ..phase = AppPhase.ready
      ..relayKey = key
      ..bootstrap = _bootstrap('d')
      ..desktopInfo = const RelayDesktopInfo(supportsOnlineStream: true);
    final fixture = _FallbackFixture(server, key, api, controller, cipher);
    server.listen((request) async {
      fixture.peer = await WebSocketTransformer.upgrade(request);
      fixture.peer!.listen((wire) {
        final outer = jsonMap(jsonDecode(wire as String));
        if (outer['type'] == 'hello') {
          fixture.peer!.add(
            jsonEncode({
              'type': 'ready',
              'connection_id': 'connection',
              'browser_id': 'browser',
            }),
          );
          fixture.peer!.add(jsonEncode({'type': 'relay', 'state': 'online'}));
        } else if (outer['type'] == 'frame') {
          fixture.onlineFrames.add(jsonMap(outer['frame']));
        }
      });
    });
    controller.startOnlineForTesting();
    await _until(() => controller.connectionSnapshot.online);
    return fixture;
  }

  Future<void> reject(String requestId) async {
    await _until(
      () => onlineFrames.any((frame) => frame['request_id'] == requestId),
    );
    peer!.add(
      jsonEncode({
        'type': 'unavailable',
        'connection_id': 'connection',
        'request_id': requestId,
      }),
    );
  }

  Future<void> reply(String requestId, {required String content}) async {
    final aad = RelayAad(
      direction: 'relay_to_web',
      type: 'session.history',
      deviceId: 'd',
      sessionId: 's',
      requestId: requestId,
      eventSeq: null,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      expiresAt: null,
    );
    final envelope = await RelayCipher().sealJson(key, {
      'type': 'session.history',
      'session_id': 's',
      'request_id': requestId,
      'messages': [
        {'content': content},
      ],
    }, aad);
    peer!.add(
      jsonEncode({
        'type': 'frame',
        'connection_id': 'connection',
        'browser_id': 'browser',
        'frame': {
          'kind': 'response',
          'device_id': 'd',
          'session_id': 's',
          'request_id': requestId,
          'aad': aad.toJson(),
          'envelope': envelope.toJson(),
        },
      }),
    );
  }

  Future<void> close() async {
    controller.dispose();
    await peer?.close();
    await server.close(force: true);
  }
}

class _GateCipher extends RelayCipher {
  Completer<void>? sealGate;
  Completer<void>? sealStarted;

  @override
  Future<SealedEnvelope> sealJson(
    RelayKey key,
    Object? value,
    RelayAad aad,
  ) async {
    if (sealGate != null) {
      sealStarted?.complete();
      await sealGate!.future;
    }
    return super.sealJson(key, value, aad);
  }
}

class _FallbackApi extends RelayApi {
  _FallbackApi(String origin, this.key)
    : super(origin: origin, allowInsecureLoopbackForTesting: true);
  final RelayKey key;
  final frames = <({RelayAad aad, SealedEnvelope envelope})>[];
  final responseIds = <String>[];
  Completer<void>? responseGate;
  String responseType = 'session.history';
  String? mismatch;

  @override
  Future<CommandResult> sendCommand({
    required String deviceId,
    required String? sessionId,
    required String requestId,
    required String commandType,
    required String createdAt,
    required String expiresAt,
    required RelayAad aad,
    required SealedEnvelope envelope,
  }) async {
    frames.add((aad: aad, envelope: envelope));
    return CommandResult(requestId: requestId, delivery: 'delivered');
  }

  @override
  Future<OpaqueFrame> encryptedResponse(
    String requestId, {
    bool preserveCompression = false,
    DownloadProgressCallback? onProgress,
    Future<void>? abortTrigger,
    Duration? maxWait,
  }) async {
    if (abortTrigger != null) {
      // These cases exercise fresh-read recovery after both original routes
      // fail. Pending-original renewal has its own real transport fixtures.
      throw const RelayApiException('', 502, 'response_payload_missing');
    }
    responseIds.add(requestId);
    await responseGate?.future;
    final sessionId = frames.last.aad.sessionId;
    final aad = RelayAad(
      direction: 'relay_to_web',
      type: mismatch == 'aad_type' ? 'session.agents' : responseType,
      deviceId: 'd',
      sessionId: mismatch == 'aad_session' ? 'wrong' : sessionId,
      requestId: requestId,
      eventSeq: mismatch == 'aad_event' ? 1 : null,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      expiresAt: null,
    );
    final envelope = await RelayCipher().sealJson(key, {
      'type': mismatch == 'body_type' ? 'session.history_error' : responseType,
      'session_id': mismatch == 'body_session' ? 'wrong' : sessionId,
      'request_id': mismatch == 'body_request' ? 'wrong' : requestId,
      'messages': [
        {'content': 'HTTP recovered'},
      ],
    }, aad);
    return OpaqueFrame(
      deviceId: 'd',
      sessionId: mismatch == 'frame_session' ? 'wrong' : sessionId,
      requestId: requestId,
      aad: aad,
      envelope: envelope,
    );
  }
}
