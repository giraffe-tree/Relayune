import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/notifications/notification_coordinator.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/computer_connections.dart';
import 'package:relayune_mobile/src/storage/history_store.dart';
import 'package:relayune_mobile/src/storage/image_cache_store.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';
import 'package:relayune_mobile/src/widgets/incremental_markdown_body.dart';

import '../test/support/workbench_fixture.dart';

// Explicit opt-in, existing authorized iOS simulator only. With a simulator
// lease, run from mobile/:
// flutter test integration_test/large_history_pipeline_benchmark_test.dart \
//   -d <leased-simulator> --dart-define=LARGE_HISTORY_PIPELINE_LIVE=true
//
// Three fresh controllers and temporary encrypted SQLite stores. The desktop
// and OS caches are left untouched; this excludes process/engine launch. WebRTC is
// disabled in an in-memory secure-storage overlay, never in user settings.
// Only read commands and existing encrypted delivery controls are permitted.
// No pairing activation, notification, session creation/send/interrupt or
// persistent secure-storage writes. Nothing emits names/IDs/paths/content.
//
// Production openJson retains its authenticated worker path. decrypt_ms is
// the combined base64/AAD/GCM/UTF-8/JSON/worker time; these are not separable
// through its public API. HTTP body timing is available only for the winning
// HTTP envelope. WSS parsing and individual network hops remain unmeasured.
// All mobile durations use local Stopwatches. Desktop durations are reported
// independently, never subtracted from mobile wall-clock timestamps.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'opt-in live large history pipeline',
    (tester) async {
      final previousPrint = debugPrint;
      final previousError = FlutterError.onError;
      var uiErrors = 0;
      debugPrint = (String? message, {int? wrapWidth}) {};
      FlutterError.onError = (_) {
        uiErrors++;
        previousError?.call(
          FlutterErrorDetails(
            exception: StateError('large_history_benchmark_ui_error'),
            stack: StackTrace.empty,
            library: 'large_history_benchmark',
          ),
        );
      };
      final samples = <Map<String, Object?>>[];
      String? targetDevice, targetSession;
      var stage = 'initialize';
      try {
        for (var run = 0; run < 3; run++) {
          final directory = await Directory.systemTemp.createTemp(
            'large-history-benchmark-',
          );
          final notifications = RelayNotificationCoordinator(gateway: _Quiet());
          final histories = <HistoryStore>[];
          final images = <ImageCacheStore>[];
          final ciphers = <AppController, _MeasuredCipher>{};
          final overlay = _EphemeralStorage();
          final connections = ComputerConnections(
            notifications: notifications,
            store: SecureStore(storage: overlay),
            controllerFactory: (store, sink, manager, locale) {
              final index = histories.length;
              final image = ImageCacheStore(
                path: '${directory.path}/images-$index.sqlite',
              );
              final history = HistoryStore(
                path: '${directory.path}/history-$index.sqlite',
                imageCacheStore: image,
              );
              images.add(image);
              histories.add(history);
              final httpClient = _ReadOnlyHttp();
              final api = _MeasuredApi(httpClient);
              final cipher = _MeasuredCipher(api);
              final controller = AppController(
                api: api,
                secureStore: store,
                cipher: cipher,
                historyStore: history,
                imageCacheStore: image,
                eventNotifications: sink,
                notificationManager: manager,
                locale: locale,
              );
              ciphers[controller] = cipher;
              return controller;
            },
          );
          try {
            stage = 'initialize';
            final launch = Stopwatch()..start();
            await connections.initialize().timeout(const Duration(seconds: 60));
            await connections.restored.timeout(const Duration(seconds: 60));
            final discovery = Stopwatch()..start();
            bool matches(RelaySession session) =>
                !session.isSubagent &&
                session.provider == 'codex' &&
                (session.project == 'ernest-show' ||
                    session.cwd.endsWith('/ernest-show')) &&
                session.name.contains('构思个人趣味主题网站');
            while (!connections.readyComputers.any(
                  (c) => c.sessions.any(matches),
                ) &&
                discovery.elapsed < const Duration(seconds: 60)) {
              await tester.pump(const Duration(milliseconds: 20));
            }
            final candidates = [
              for (final c in connections.readyComputers)
                for (final s in c.sessions.where(matches)) (c, s),
            ];
            _require(candidates.length == 1, 'target_directory_unavailable');
            final (controller, session) = candidates.single;
            targetDevice ??= connections.deviceId(controller);
            targetSession ??= session.id;
            _require(
              targetDevice == connections.deviceId(controller) &&
                  targetSession == session.id,
              'target_changed',
            );
            _require(
              !controller.directReadsEnabled,
              'direct_transport_enabled',
            );
            _require(
              controller.messages[session.id]?.isNotEmpty != true,
              'unexpected_history_preload',
            );
            final directoryMs = _ms(launch);
            stage = 'history';
            final entry = Stopwatch()..start();
            await controller.selectSession(session.id, waitForHistory: false);
            final trace = controller.historyProgressFor(session.id)?.requestId;
            _require(trace != null, 'history_request_not_started');
            await pumpWorkbench(tester, controller);
            Map<String, Object?>? network;
            Map<String, Object?>? displayed;
            double? bodyFrameMs;
            final deadline = const Duration(seconds: 90);
            while (entry.elapsed < deadline) {
              await tester.pump(const Duration(milliseconds: 20));
              final sameRequest = controller.historyPerformance.where(
                (m) => m['trace_id'] == trace && m['source'] == 'network',
              );
              network = sameRequest
                  .where((m) => m['merged_ms'] is num)
                  .lastOrNull;
              displayed = sameRequest
                  .where((m) => m['display_ms'] is num)
                  .lastOrNull;
              if (bodyFrameMs == null && _bodyVisible(tester)) {
                bodyFrameMs = _ms(entry);
              }
              if (network != null && displayed != null && bodyFrameMs != null) {
                break;
              }
              _require(uiErrors == 0, 'ui_error');
              _require(
                controller.historyErrorFor(session.id) == null,
                'history_failed',
              );
            }
            _require(
              network != null && displayed != null && bodyFrameMs != null,
              'history_or_body_frame_timeout',
            );
            final crypto = ciphers[controller]!.measurements[trace];
            _require(crypto != null, 'history_decryption_unmeasured');
            _require(
              network!['cache_restored'] == false,
              'unexpected_cache_hit',
            );
            final desktop = network['desktop'];
            samples.add({
              'run': run + 1,
              'trace': trace,
              'directory_ready_ms': directoryMs,
              'command_posted_ms': network['command_posted_ms'],
              'response_received_ms': network['response_received_ms'],
              'merged_ms': network['merged_ms'],
              'display_ms': displayed!['display_ms'],
              'body_first_frame_ms': bodyFrameMs,
              'message_count': network['message_count'],
              'response_plaintext_bytes': network['response_plaintext_bytes'],
              'empty_phone_history_cache': true,
              'cache_restored': false,
              'desktop': desktop is Map
                  ? {
                      for (final key in const [
                        'command_wait_ms',
                        'history_read_ms',
                        'message_count',
                        'index_read_bytes',
                        'index_parse_ms',
                      ])
                        if (desktop[key] is num) key: desktop[key],
                    }
                  : null,
              ...crypto!,
            });
            _require(uiErrors == 0, 'ui_error');
          } finally {
            stage = 'cleanup';
            await tester.pumpWidget(const SizedBox());
            for (final controller in connections.controllers) {
              controller.pauseRealtime();
            }
            await Future.wait(
              connections.controllers.map((c) => c.flushHistoryCache()),
            );
            connections.dispose();
            notifications.dispose();
            await Future.wait(histories.map((h) => h.close()));
            await Future.wait(images.map((i) => i.close()));
            await directory.delete(recursive: true);
          }
        }
        _emit('completed', samples);
      } catch (_) {
        _emit('failed_$stage', samples);
        throw TestFailure('large_history_benchmark_failed_$stage');
      } finally {
        debugPrint = previousPrint;
        FlutterError.onError = previousError;
      }
    },
    skip: !const bool.fromEnvironment('LARGE_HISTORY_PIPELINE_LIVE'),
    timeout: const Timeout(Duration(minutes: 12)),
  );
}

double _ms(Stopwatch watch) => watch.elapsedMicroseconds / 1000;

void _require(bool condition, String fixedCode) {
  if (!condition) throw TestFailure(fixedCode);
}

// A mounted production Markdown body must intersect the actual list viewport;
// a nonempty controller list or a loading/header frame is not a readable frame.
bool _bodyVisible(WidgetTester tester) {
  final list = find.byKey(const ValueKey('conversation-message-list'));
  if (list.evaluate().isEmpty) return false;
  final viewport = tester.getRect(list);
  for (final element in find.byType(IncrementalMarkdownBody).evaluate()) {
    final render = element.renderObject;
    if (render is RenderBox && render.hasSize && render.size.isEmpty == false) {
      final bounds = render.localToGlobal(Offset.zero) & render.size;
      if (bounds.overlaps(viewport)) return true;
    }
  }
  return false;
}

void _emit(String status, List<Map<String, Object?>> samples) {
  // ignore: avoid_print
  print(
    'LARGE_HISTORY_PIPELINE_BENCHMARK ${jsonEncode({'status': status, 'scope': 'ios_simulator_debug_live_server_new_phone_cache_desktop_cache_untouched', 'transport_policy': 'production_wss_with_original_response_http_hedge', 'decrypt_scope': 'production_authentication_base64_utf8_json_worker_combined', 'individual_network_hops_ms': null, 'wss_frame_parse_ms': null, 'memory_reopen_measured': false, 'sqlite_restore_measured': false, 'samples': samples})}',
  );
}

const _readCommands = {
  'session.read_history',
  'session.read_attachment',
  'session.read_agents',
  'project.locations',
  'project.check',
  'project.sessions',
  'project.browse',
};

class _MeasuredCipher extends RelayCipher {
  _MeasuredCipher(this.api);
  final _MeasuredApi api;
  final _logicalRequests = <String, String>{};
  final measurements = <String, Map<String, Object?>>{};

  @override
  Future<SealedEnvelope> sealJson(RelayKey key, Object? value, RelayAad aad) {
    _require(
      _readCommands.contains(aad.type) ||
          const {'transport.resume', 'transport.event_ack'}.contains(aad.type),
      'non_read_command_blocked',
    );
    if (aad.type == 'session.read_history' && value is Map) {
      final payload = value['payload'];
      final trace = payload is Map ? payload['performance_trace_id'] : null;
      if (trace is String && aad.requestId != null) {
        _logicalRequests[aad.requestId!] = trace;
      }
    }
    return super.sealJson(key, value, aad);
  }

  @override
  Future<T> openJson<T>(
    RelayKey key,
    SealedEnvelope envelope,
    RelayAad expectedAad,
  ) async {
    final watch = Stopwatch()..start();
    final value = await super.openJson<T>(key, envelope, expectedAad);
    final elapsed = _ms(watch);
    final trace = _logicalRequests[expectedAad.requestId];
    if (expectedAad.type == 'session.history' && trace != null) {
      final measurement = Stopwatch()..start();
      final envelopeBytes = utf8.encode(jsonEncode(envelope.toJson())).length;
      // The online hedge can authenticate a late losing envelope too. Retain
      // the first authenticated result rather than overwrite its timings.
      measurements.putIfAbsent(
        trace,
        () => {
          'decrypt_ms': elapsed,
          'envelope_bytes': envelopeBytes,
          'ciphertext_base64_chars': envelope.ciphertext.length,
          'winning_response_transport': api.httpEnvelopes[envelope] == true
              ? 'http'
              : 'wss',
          'http': api.httpEnvelopes[envelope] == true
              ? api.client.completed[expectedAad.requestId]
              : null,
          'measurement_overhead_ms': _ms(measurement),
        },
      );
    }
    return value;
  }
}

class _MeasuredApi extends RelayApi {
  _MeasuredApi(this.client) : super(client: client);
  final _ReadOnlyHttp client;
  final httpEnvelopes = Expando<bool>();

  // Restored authorization is sufficient for a read-only benchmark. Activation
  // would revoke older authorization generations and is intentionally omitted.
  @override
  Future<void> activateClientDevice() async {}

  @override
  Future<void> registerIosPush(
    String deviceId,
    Map<String, dynamic> body,
  ) async {}

  @override
  Future<OpaqueFrame> encryptedResponse(
    String requestId, {
    bool preserveCompression = false,
    DownloadProgressCallback? onProgress,
    Future<void>? abortTrigger,
    Duration? maxWait,
  }) async {
    final frame = await super.encryptedResponse(
      requestId,
      onProgress: onProgress,
      preserveCompression: preserveCompression,
      abortTrigger: abortTrigger,
      maxWait: maxWait,
    );
    httpEnvelopes[frame.envelope] = true;
    return frame;
  }
}

class _ReadOnlyHttp extends http.BaseClient {
  final _delegate = http.Client();
  final completed = <String, Map<String, Object?>>{};

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.method != 'GET') {
      _require(
        request.method == 'POST' &&
            request.url.path == '/api/commands' &&
            request is http.Request &&
            _readCommands.contains(
              (jsonDecode(request.body) as Map)['command_type'],
            ),
        'non_read_http_blocked',
      );
    }
    final watch = Stopwatch()..start();
    final response = await _delegate.send(request);
    final headersMs = _ms(watch);
    final segments = request.url.pathSegments;
    final isResponse =
        request.method == 'GET' &&
        segments.length == 3 &&
        segments[0] == 'api' &&
        segments[1] == 'responses';
    var bytes = 0;
    final stream = response.stream.transform(
      StreamTransformer<List<int>, List<int>>.fromHandlers(
        handleData: (chunk, sink) {
          bytes += chunk.length;
          sink.add(chunk);
        },
        handleDone: (sink) {
          if (isResponse && response.statusCode == 200) {
            completed[segments.last] = {
              'headers_ms': headersMs,
              'body_complete_ms': _ms(watch),
              'body_after_headers_ms': _ms(watch) - headersMs,
              'frame_bytes': bytes,
            };
          }
          sink.close();
        },
      ),
    );
    return http.StreamedResponse(
      stream,
      response.statusCode,
      contentLength: response.contentLength,
      request: response.request,
      headers: response.headers,
      isRedirect: response.isRedirect,
      persistentConnection: response.persistentConnection,
      reasonPhrase: response.reasonPhrase,
    );
  }

  @override
  void close() => _delegate.close();
}

// All writes and cache keys live only in this overlay. Only existing pairing
// and account metadata may be read from the simulator's native secure storage.
class _EphemeralStorage extends FlutterSecureStorage {
  final _values = <String, String?>{};
  final _delegate = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );

  @override
  Future<String?> read({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (_values.containsKey(key)) return _values[key];
    if (key == 'relayune.direct-reads.v1' ||
        key == 'relayune.haptics-enabled.v1') {
      return 'false';
    }
    if (key.startsWith('relayune.history-key') ||
        key.startsWith('relayune.opened-session-versions.v1')) {
      return null;
    }
    return _delegate.read(key: key);
  }

  @override
  Future<void> write({
    required String key,
    required String? value,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => _values[key] = value;

  @override
  Future<void> delete({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => _values[key] = null;

  @override
  Future<bool> containsKey({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => await read(key: key) != null;

  @override
  Future<Map<String, String>> readAll({
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => {
    for (final entry in _values.entries)
      if (entry.value != null) entry.key: entry.value!,
  };

  @override
  Future<void> deleteAll({
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    for (final key in _values.keys.toList()) {
      _values[key] = null;
    }
  }
}

class _Quiet extends RelayNotificationGateway {
  @override
  Future<String?> initialize({
    required RelayNotificationResponseCallback onResponse,
  }) async => null;
  @override
  Future<bool> requestAuthorization() async => false;
  @override
  Future<bool?> authorizationEnabled() async => false;
  @override
  Future<void> openSettings() async {}
  @override
  Future<void> show(RelayLocalNotification notification) async {}
  @override
  Future<void> cancel(int notificationId) async {}
}
