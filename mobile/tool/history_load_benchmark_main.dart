// Run with scripts/diagnostics/history-load-benchmark.mjs. No production account.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/crypto/codec.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/network/realtime_client.dart';
import 'package:relayune_mobile/src/state/app_controller.dart' as current;
import 'package:relayune_mobile/src/state/device_connection.dart';
import 'package:relayune_mobile/src/ui/theme.dart';
import 'package:relayune_mobile/src/ui/workbench_screen.dart';
import 'history_baseline_controller.dart' as baseline;

const origin = 'http://127.0.0.1:18764';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const BenchmarkApp());
}

class BenchmarkApp extends StatefulWidget {
  const BenchmarkApp({super.key});
  @override
  State<BenchmarkApp> createState() => _BenchmarkState();
}

class _BenchmarkState extends State<BenchmarkApp> {
  current.AppController? bridge;
  String status = 'Preparing cold history benchmark';
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(run()));
  }

  Future<void> run() async {
    try {
      final plan =
          jsonDecode((await http.get(Uri.parse('$origin/plan'))).body) as Map;
      for (var round = 0; round < (plan['rounds'] as int); round++) {
        for (var sample = 0; sample < (plan['samples'] as int); sample++) {
          for (final mode
              in round.isEven ? ['before', 'after'] : ['after', 'before']) {
            setState(() {
              bridge = null;
              status = '$mode · sample ${sample + 1} · round ${round + 1}';
            });
            final response = await http.get(
              Uri.parse('$origin/setup?mode=$mode&sample=$sample'),
            );
            if (response.statusCode != 200) {
              throw StateError('Benchmark setup failed');
            }
            final setup = jsonDecode(response.body) as Map<String, dynamic>;
            final sessionId = setup['session_id'] as String;
            final api = BenchmarkApi();
            final cipher = MeasuredCipher(legacy: mode == 'before');
            final dynamic loader = mode == 'before'
                ? baseline.AppController(api: api, cipher: cipher)
                : current.AppController(api: api, cipher: cipher);
            loader.phase = mode == 'before'
                ? baseline.AppPhase.ready
                : current.AppPhase.ready;
            loader.bootstrap = ServerBootstrap.fromJson(
              Map<String, dynamic>.from(setup['bootstrap'] as Map),
            );
            loader.relayKey = RelayKey.import(setup['key'] as String);
            loader.activeSessionId = sessionId;
            loader.sessions = [
              RelaySession.fromJson({
                'id': sessionId,
                'name': 'History performance sample',
                'cwd': '/benchmark',
                'provider': 'codex',
                'status': 'idle',
              }),
            ];
            loader.connectionSnapshot = const DeviceConnectionSnapshot(
              online: true,
              lastSeenAt: null,
              revision: 1,
              transport: RealtimeTransportState.connected,
              realtimeConfirmed: true,
            );
            // Separate fresh rendering controller lets both versions use the same
            // production conversation widgets without sharing a history cache.
            final view = current.AppController(api: BenchmarkApi())
              ..phase = current.AppPhase.ready
              ..bootstrap = loader.bootstrap as ServerBootstrap
              ..sessions = loader.sessions as List<RelaySession>
              ..activeSessionId = sessionId;
            setState(() => bridge = view);
            await WidgetsBinding.instance.endOfFrame;
            final invalidations = <Future<void>>[];
            final socket = await WebSocket.connect('ws://127.0.0.1:18764');
            final subscription = socket.listen((data) {
              final signal = RealtimeSignal.fromJson(
                Map<String, dynamic>.from(jsonDecode(data as String) as Map),
              );
              invalidations.add(
                loader.applyRealtimeSignalForTesting(signal) as Future<void>,
              );
            });
            final watch = Stopwatch()..start();
            await loader.loadHistory(sessionId);
            final loadUs = watch.elapsedMicroseconds;
            if (loader.historyErrorFor(sessionId) != null) {
              throw StateError('History failed');
            }
            final messages = List<RelayMessage>.from(
              loader.messages[sessionId] as List,
            );
            if (messages.isEmpty) throw StateError('Sample is empty');
            view.messages[sessionId] = messages;
            view.agents = List<RelayAgent>.from(loader.agents as List);
            setState(() {});
            await WidgetsBinding.instance.endOfFrame;
            final frameUs = watch.elapsedMicroseconds;
            // Include downloads caused by notifications, even if they finish
            // just after the first history frame.
            await Future.wait(invalidations.toList());
            await http.post(
              Uri.parse('$origin/result'),
              headers: {'content-type': 'application/json'},
              body: jsonEncode({
                'round': round,
                'load_ms': loadUs / 1000,
                'first_frame_ms': frameUs / 1000,
                'decrypt_ms': cipher.decryptUs / 1000,
                'http_decode_ms': api.decodeUs / 1000,
                'rendered_messages': messages.length,
                'history_cache_initial_entries': 0,
              }),
            );
            await subscription.cancel();
            await socket.close();
            loader.dispose();
            setState(() => bridge = null);
            await WidgetsBinding.instance.endOfFrame;
            view.dispose();
          }
        }
      }
      setState(() => status = 'BENCHMARK COMPLETE');
      debugPrint('HISTORY_BENCHMARK_COMPLETE');
    } catch (error) {
      setState(() {
        bridge = null;
        status = 'Benchmark failed: $error';
      });
      debugPrint('HISTORY_BENCHMARK_FAILED: $error');
    }
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    locale: const Locale('zh', 'CN'),
    supportedLocales: relayuneSupportedLocales,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    theme: RelayTheme.webFor(),
    home: bridge == null
        ? Scaffold(body: Center(child: Text(status)))
        : WorkbenchScreen(controller: bridge!),
  );
}

class MeasuredCipher extends RelayCipher {
  MeasuredCipher({required this.legacy});
  final bool legacy;
  int decryptUs = 0;
  @override
  Future<T> openJson<T>(
    RelayKey key,
    SealedEnvelope envelope,
    RelayAad aad,
  ) async {
    final watch = Stopwatch()..start();
    // Baseline's validation decoded the ciphertext before decrypting it again.
    if (legacy) decodeBase64Url(envelope.ciphertext);
    try {
      return await super.openJson<T>(key, envelope, aad);
    } finally {
      decryptUs += watch.elapsedMicroseconds;
    }
  }
}

class BenchmarkApi extends RelayApi {
  BenchmarkApi() : super(origin: origin);
  int decodeUs = 0;
  final http.Client client = http.Client();
  Future<Map<String, dynamic>> get(String path) async {
    final response = await client.get(Uri.parse('$origin$path'));
    final watch = Stopwatch()..start();
    final body = Map<String, dynamic>.from(
      jsonDecode(utf8.decode(response.bodyBytes)) as Map,
    );
    decodeUs += watch.elapsedMicroseconds;
    if (response.statusCode != 200) {
      throw RelayApiException(
        'Benchmark pending',
        response.statusCode,
        'response_pending',
      );
    }
    return body;
  }

  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) async =>
      ServerBootstrap.fromJson(await get('/bootstrap'));
  @override
  Future<ServerBootstrap> queueStatus({required String deviceId}) async =>
      ServerBootstrap.fromJson(await get('/bootstrap?summary_only=1'));
  @override
  Future<OpaqueFrame> encryptedResponse(
    String requestId, {
    bool preserveCompression = false,
    DownloadProgressCallback? onProgress,
    Future<void>? abortTrigger,
    Duration? maxWait,
  }) async => OpaqueFrame.fromJson(await get('/responses/$requestId'));
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
    final response = await client.post(
      Uri.parse('$origin/command'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'aad': aad.toJson(), 'envelope': envelope.toJson()}),
    );
    if (response.statusCode != 200) {
      throw StateError('Benchmark command failed');
    }
    return CommandResult(requestId: requestId, delivery: 'delivered');
  }

  @override
  void close() {
    client.close();
    super.close();
  }
}
