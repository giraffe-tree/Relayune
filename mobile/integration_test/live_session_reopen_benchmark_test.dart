import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relayune_mobile/src/notifications/notification_coordinator.dart';
import 'package:relayune_mobile/src/state/computer_connections.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/storage/history_store.dart';
import 'package:relayune_mobile/src/storage/image_cache_store.dart';

import '../test/support/workbench_fixture.dart';

// Explicit opt-in: uses the simulator's existing authorization and live Relay.
// Read-only traffic; reports only timings/counts, never names, IDs or contents.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('live authorized session reopen', (tester) async {
    if (!const bool.fromEnvironment('REOPEN_BENCHMARK_LIVE')) return;
    String? device, session;
    final samples = <Map<String, Object?>>[];
    const noCache = bool.fromEnvironment('REOPEN_BENCHMARK_NO_CACHE');
    for (var run = 0; run < 5; run++) {
      final notifications = RelayNotificationCoordinator(gateway: _Quiet());
      final directory = noCache
          ? await Directory.systemTemp.createTemp('live-cache-miss-')
          : null;
      final images = noCache
          ? ImageCacheStore(path: '${directory!.path}/images.sqlite')
          : null;
      final history = noCache
          ? HistoryStore(
              path: '${directory!.path}/history.sqlite',
              imageCacheStore: images,
            )
          : null;
      final connections = ComputerConnections(
        notifications: notifications,
        controllerFactory: noCache
            ? (store, sink, manager, locale) => AppController(
                secureStore: store,
                eventNotifications: sink,
                notificationManager: manager,
                locale: locale,
                historyStore: history,
                imageCacheStore: images,
              )
            : null,
      );
      final launch = Stopwatch()..start();
      final initializing = connections.initialize().catchError((Object _) {});
      final deadline = DateTime.now().add(const Duration(seconds: 45));
      while (!connections.readyComputers.any(
            (c) => c.sessions.any((s) => !s.isSubagent),
          ) &&
          DateTime.now().isBefore(deadline)) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(
        connections.readyComputers.where(
          (c) => c.sessions.any((s) => !s.isSubagent),
        ),
        isNotEmpty,
      );
      final c = connections.readyComputers.firstWhere(
        (c) =>
            c.sessions.any((s) => !s.isSubagent) &&
            (device == null || connections.deviceId(c) == device),
      );
      device ??= connections.deviceId(c);
      final sorted = c.sessions.where((s) => !s.isSubagent).toList()
        ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      session ??= sorted[sorted.length > 2 ? 2 : 0].id;
      final directoryMs = launch.elapsedMicroseconds / 1000;
      final entry = Stopwatch()..start();
      final tappedAt = DateTime.now().millisecondsSinceEpoch;
      unawaited(c.selectSession(session, waitForHistory: false));
      await pumpWorkbench(tester, c);
      while ((c.messages[session]?.isEmpty ?? true) &&
          DateTime.now().isBefore(deadline)) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      await tester.pump();
      final readableMs = entry.elapsedMicroseconds / 1000;
      final readable = c.messages[session]?.isNotEmpty == true;
      await initializing;
      await connections.restored;
      while (!c.historyPerformance.any(
            (s) =>
                s['source'] == 'network' &&
                s['merged_ms'] != null &&
                (!noCache ||
                    (s['request_visible'] == true &&
                        (s['request_started_at_ms'] as int? ?? 0) +
                                (s['merged_ms'] as num? ?? 0) >=
                            tappedAt)),
          ) &&
          c.historyLoading.isNotEmpty &&
          DateTime.now().isBefore(deadline)) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      await tester.pump();
      final network = c.historyPerformance
          .where((s) => s['source'] == 'network' && s['merged_ms'] != null)
          .lastOrNull;
      final sample = <String, Object?>{
        'run': run,
        'directory_ready_ms': directoryMs,
        'tap_to_readable_frame_ms': readableMs,
        'readable': readable,
        'initialized_ms': launch.elapsedMicroseconds / 1000,
        'message_count': c.messages[session]?.length ?? 0,
        'empty_disk_cache': noCache,
        'cached_body_restored': c.historyPerformance.any(
          (s) =>
              s['source'] == 'sqlite' && (s['message_count'] as num? ?? 0) > 0,
        ),
        'network_response_ms': network?['response_received_ms'],
        'network_merge_ms': network?['merged_ms'],
        'desktop': network?['desktop'],
      };
      expect(readable, isTrue);
      if (noCache) expect(sample['cached_body_restored'], isFalse);
      // Additional post-fix lifecycle measurements can be enabled without
      // changing the original before/after cold-controller workload.
      if (const bool.fromEnvironment('REOPEN_BENCHMARK_LIFECYCLE')) {
        await tester.pumpWidget(const SizedBox());
        final warm = Stopwatch()..start();
        unawaited(c.selectSession(session, waitForHistory: false));
        await pumpWorkbench(tester, c);
        sample['memory_entry_frame_ms'] = warm.elapsedMicroseconds / 1000;
        expect(c.messages[session], isNotEmpty);
        c.setPresentationForeground(false);
        c.setPresentationForeground(true, resumeTransport: false);
        final resumedAt = DateTime.now().millisecondsSinceEpoch;
        final resume = Stopwatch()..start();
        final resumed = c.resumeRealtime();
        await tester.pump();
        sample['short_resume_frame_ms'] = resume.elapsedMicroseconds / 1000;
        expect(c.messages[session], isNotEmpty);
        await resumed;
        final latestDeadline = DateTime.now().add(const Duration(seconds: 30));
        bool freshHistory() => c.historyPerformance.any(
          (s) =>
              s['source'] == 'network' &&
              s['merged_ms'] != null &&
              (s['request_started_at_ms'] as int? ?? 0) >= resumedAt,
        );
        while (!freshHistory() && DateTime.now().isBefore(latestDeadline)) {
          await tester.pump(const Duration(milliseconds: 10));
        }
        expect(freshHistory(), isTrue);
        sample['short_resume_latest_history_ms'] =
            resume.elapsedMicroseconds / 1000;

        c.setPresentationForeground(false);
        await c.flushHistoryCache();
        while (c.historyLoading.isNotEmpty &&
            DateTime.now().isBefore(latestDeadline)) {
          await tester.pump(const Duration(milliseconds: 10));
        }
        await c.flushHistoryCache();
        c.releaseBackgroundMemory();
        expect(c.messages[session], isNull);
        c.setPresentationForeground(true, resumeTransport: false);
        final deepResume = Stopwatch()..start();
        final deepResumed = c.resumeRealtime();
        while ((c.messages[session]?.isEmpty ?? true) &&
            DateTime.now().isBefore(latestDeadline)) {
          await tester.pump(const Duration(milliseconds: 10));
        }
        await tester.pump();
        sample['released_memory_resume_frame_ms'] =
            deepResume.elapsedMicroseconds / 1000;
        expect(c.messages[session], isNotEmpty);
        await deepResumed;
      }
      samples.add(sample);
      await tester.pumpWidget(const SizedBox());
      final controllers = connections.controllers;
      for (final controller in controllers) {
        controller.pauseRealtime();
      }
      await Future.wait(controllers.map((c) => c.flushHistoryCache()));
      connections.dispose();
      notifications.dispose();
      if (noCache) {
        await history!.close();
        await images!.close();
        await directory!.delete(recursive: true);
      }
    }
    // ignore: avoid_print
    print(
      'LIVE_SESSION_REOPEN_BENCHMARK ${jsonEncode({'scope': 'iOS simulator Debug; existing pairing + live production network '
          'and Desktop; new controllers, warm OS disk cache; excludes engine/process launch', 'samples': samples})}',
    );
  });
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
