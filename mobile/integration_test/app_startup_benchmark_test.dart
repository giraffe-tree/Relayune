import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relayune_mobile/main.dart' as app;
import 'package:relayune_mobile/src/ui/relayune_ready_screen.dart';
import 'package:relayune_mobile/src/ui/auth_screen.dart';

// Explicit opt-in, existing authorization, production app and read-only traffic.
// Measures from Dart entry (not OS launch), including the actual startup overlay.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('startup without stored identity', (tester) async {
    if (!const bool.fromEnvironment('APP_STARTUP_BENCHMARK_SIGNED_OUT')) return;
    // In-memory platform mock only: never clear the simulator's real credentials
    // or revoke a server session to measure the first-install login experience.
    FlutterSecureStorage.setMockInitialValues({});
    final samples = <Map<String, Object?>>[];
    for (var run = 0; run < 5; run++) {
      await tester.pumpWidget(const SizedBox());
      final clock = Stopwatch()..start();
      app.main();
      final deadline = DateTime.now().add(const Duration(seconds: 10));
      bool ready() =>
          find.byType(AuthScreen).evaluate().isNotEmpty &&
          find
              .byKey(const ValueKey('startup-morph-overlay'))
              .evaluate()
              .isEmpty;
      while (!ready() && DateTime.now().isBefore(deadline)) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(ready(), isTrue);
      samples.add({
        'run': run,
        'dart_to_login_frame_ms': clock.elapsedMicroseconds / 1000,
      });
      await tester.pumpWidget(const SizedBox());
    }
    // ignore: avoid_print
    print(
      'SIGNED_OUT_STARTUP_BENCHMARK ${jsonEncode({'scope': 'iOS simulator Debug, production app UI; generated missing credentials via in-memory secure-store mock; excludes native launch and real secure-store latency', 'samples': samples})}',
    );
  });
  testWidgets('full app startup, home list and real session navigation', (
    tester,
  ) async {
    if (!const bool.fromEnvironment('APP_STARTUP_BENCHMARK_LIVE')) return;
    const offline = bool.fromEnvironment('APP_STARTUP_BENCHMARK_OFFLINE');
    final previous = HttpOverrides.current;
    addTearDown(() => HttpOverrides.global = previous);
    final samples = <Map<String, Object?>>[];
    // Flutter integration_test removes the app after the test process ends.
    // Warm the real encrypted cache in this process before disabling transport.
    for (var run = offline ? -1 : 0; run < 5; run++) {
      final offlineRun = offline && run >= 0;
      if (offlineRun) HttpOverrides.global = _Offline();
      await tester.pumpWidget(const SizedBox());
      final clock = Stopwatch()..start();
      app.main();
      await tester.pump();
      final firstFrame = clock.elapsedMicroseconds / 1000;
      final deadline = DateTime.now().add(const Duration(seconds: 60));
      Future<void> until(bool Function() ready) async {
        while (!ready() && DateTime.now().isBefore(deadline)) {
          await tester.pump(const Duration(milliseconds: 10));
        }
        expect(ready(), isTrue);
      }

      final home = find.byType(RelayuneReadyScreen);
      await until(() => home.evaluate().isNotEmpty);
      final homeMounted = clock.elapsedMicroseconds / 1000;
      final connections = tester.widget<RelayuneReadyScreen>(home).connections!;
      final overlay = find.byKey(const ValueKey('startup-morph-overlay'));
      await until(() => overlay.evaluate().isEmpty);
      final interactive = clock.elapsedMicroseconds / 1000;
      final cards = find.byWidgetPredicate(
        (w) =>
            w.key is ValueKey<String> &&
            (w.key! as ValueKey<String>).value.startsWith(
              'home-recent-session-',
            ),
      );
      if (offlineRun) {
        await connections.restored;
        // ignore: avoid_print
        print(
          'OFFLINE_STARTUP_DIAGNOSTIC ${jsonEncode(connections.controllers.map((c) => {'phase': c.phase.name, 'sessions': c.sessions.length, 'readonly': c.localReadOnly, 'paired': c.relayKey != null, 'cache_events': c.historyPerformance.map((s) => s['stage']).whereType<String>().toList()}).toList())}',
        );
      }
      await until(() => cards.hitTestable().evaluate().isNotEmpty);
      final listVisible = clock.elapsedMicroseconds / 1000;
      final card = cards.hitTestable().first;
      final activeBefore = {
        for (final c in connections.controllers) c: c.activeSessionId,
      };
      for (final c in connections.controllers) {
        c.historyPerformance.clear();
      }
      final entry = Stopwatch()..start();
      final tappedAt = DateTime.now().millisecondsSinceEpoch;
      await tester.tap(card);
      await tester.pump();
      await until(() => connections.visibleSession != null);
      final target = connections.resolve(connections.visibleSession!)!;
      await until(
        () => target.controller.messages[target.sessionId]?.isNotEmpty == true,
      );
      await tester.pump();
      final body = entry.elapsedMicroseconds / 1000;
      if (!offlineRun) {
        await until(
          () => target.controller.historyPerformance.any(
            (s) =>
                s['source'] == 'network' &&
                (s['request_visible'] == true ||
                    activeBefore[target.controller] == target.sessionId) &&
                (s['request_started_at_ms'] as int? ?? 0) +
                        (s['merged_ms'] as num? ?? 0) >=
                    tappedAt &&
                s['merged_ms'] != null,
          ),
        );
      }
      final latest = offlineRun ? null : entry.elapsedMicroseconds / 1000;
      if (run >= 0) {
        samples.add({
          'run': run,
          'transport_disabled_in_process': offlineRun,
          'dart_first_frame_ms': firstFrame,
          'home_mounted_ms': homeMounted,
          'home_interactive_ms': interactive,
          'recent_list_visible_ms': listVisible,
          'tap_to_body_frame_ms': body,
          'tap_to_latest_history_ms': latest,
          'message_count':
              target.controller.messages[target.sessionId]?.length ?? 0,
          'provider': target.controller.sessions
              .firstWhere((s) => s.id == target.sessionId)
              .provider,
        });
      }
      for (final c in connections.controllers) {
        c.pauseRealtime();
      }
      await Future.wait(
        connections.controllers.map((c) => c.flushHistoryCache()),
      );
      await tester.pumpWidget(const SizedBox());
    }
    // ignore: avoid_print
    print(
      'APP_STARTUP_BENCHMARK ${jsonEncode({'scope': 'iOS simulator Debug; full production app, existing pairing and live network; new app state, warm OS cache; Dart entry excludes native process/engine launch', 'samples': samples})}',
    );
  });
}

// Only this benchmark process is offline; host networking and real saved
// credentials remain unchanged. Cached directory/body still use native SQLite.
class _Offline extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) => _OfflineClient();
}

class _OfflineClient implements HttpClient {
  @override
  bool autoUncompress = true;
  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async =>
      throw const SocketException('Benchmark transport disabled');
  @override
  void close({bool force = false}) {}
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
