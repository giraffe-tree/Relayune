import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/storage/history_store.dart';
import 'package:relayune_mobile/src/storage/image_cache_store.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';

import '../test/support/workbench_fixture.dart';

// Native SQLite, authenticated cache and the production conversation widget.
// All input is generated; no account, pairing or user history is touched.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('cached session reopen to first readable frame', (tester) async {
    final directory = await Directory.systemTemp.createTemp(
      'reopen-benchmark-',
    );
    final key = List<int>.generate(32, (i) => i);
    final images = ImageCacheStore(path: '${directory.path}/images.sqlite');
    final samples = <Map<String, Object?>>[];
    const matrix = bool.fromEnvironment('REOPEN_BENCHMARK_CONTENT');
    final cases = [
      for (final bytes in [512, 2048, 40 * 1024])
        (kind: 'text', provider: 'codex', bytes: bytes),
      if (matrix) ...[
        (kind: 'markdown', provider: 'codex', bytes: 2048),
        (kind: 'code', provider: 'codex', bytes: 40 * 1024),
        (kind: 'tool', provider: 'codex', bytes: 2048),
        (kind: 'image', provider: 'codex', bytes: 512),
        (kind: 'text', provider: 'claude', bytes: 2048),
        (kind: 'text', provider: 'kimi', bytes: 2048),
      ],
    ];
    for (final scenario in cases) {
      final bytes = scenario.bytes;
      final path =
          '${directory.path}/${scenario.kind}-${scenario.provider}-$bytes.sqlite';
      var store = HistoryStore(path: path, imageCacheStore: images);
      final fixture = List.generate(
        100,
        (i) => RelayMessage(
          id: 'fixture-$i',
          role: i.isEven ? 'user' : scenario.provider,
          content: switch (scenario.kind) {
            'markdown' =>
              '## Fixture $i\n\n${'- **bold** and [link](https://example.com)\n' * (bytes ~/ 45)}',
            'code' =>
              'Fixture $i\n\n```dart\n${'final value = 42;\n' * (bytes ~/ 18)}\n```',
            _ => 'Fixture $i\n\n${'abcdefghij ' * (bytes ~/ 11)}',
          },
          createdAt: DateTime.utc(
            2026,
            1,
            1,
          ).add(Duration(seconds: i)).toIso8601String(),
          kind: scenario.kind == 'tool' ? 'tool_activity' : 'message',
          toolActivityLabel: scenario.kind == 'tool' ? 'Run command' : null,
          toolActivityType: scenario.kind == 'tool' ? 'command' : null,
          toolActivityStatus: scenario.kind == 'tool' ? 'completed' : null,
          toolActivityCommand: scenario.kind == 'tool'
              ? 'printf fixture'
              : null,
          attachments: scenario.kind == 'image'
              ? [
                  RelayAttachment(
                    id: 'image-$i',
                    type: 'image',
                    name: 'fixture.png',
                    mimeType: 'image/png',
                    url: '',
                    thumbnailBytes: base64Decode(
                      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
                    ),
                  ),
                ]
              : const [],
        ),
      );
      await tester.runAsync(
        () => store.appendPage(
          key,
          'root',
          null,
          HistoryPage(
            messages: fixture,
            nextCursor: 'older',
            hasMore: true,
            agents: const [],
            sessions: const [],
          ),
        ),
      );
      for (var run = 0; run < (matrix ? 5 : 10); run++) {
        await tester.pumpWidget(const SizedBox());
        await tester.runAsync(store.close);
        store = HistoryStore(path: path, imageCacheStore: images);
        final controller =
            workbenchController(
                online: false,
                sessions: [relaySession(provider: scenario.provider)],
                baseController: AppController(
                  api: RelayApi(),
                  secureStore: _Keys(key),
                  historyStore: store,
                  imageCacheStore: images,
                ),
              )
              ..relayKey = RelayKey.import(
                base64Url.encode(List.filled(32, 7)).replaceAll('=', ''),
              );
        final watch = Stopwatch()..start();
        final loading = controller.selectSession('root', waitForHistory: false);
        await pumpWorkbench(tester, controller);
        await loading;
        final deadline = DateTime.now().add(const Duration(seconds: 60));
        while (!controller.historyPerformance.any(
              (s) => s['display_ms'] != null,
            ) &&
            DateTime.now().isBefore(deadline)) {
          await tester.pump(const Duration(milliseconds: 1));
        }
        final displayed = controller.historyPerformance.lastWhere(
          (s) => s['display_ms'] != null,
        );
        final firstFrameMessages = controller.messages['root']?.length ?? 0;
        while (controller.historyLoading.isNotEmpty &&
            DateTime.now().isBefore(deadline)) {
          await tester.pump(const Duration(milliseconds: 1));
        }
        expect(controller.messages['root'], hasLength(100));
        expect(controller.historyCursors['root'], 'older');
        samples.add({
          'run': run,
          'content_type': scenario.kind,
          'provider': scenario.provider,
          'message_bytes_approx': bytes,
          'message_count': 100,
          'first_frame_message_count': firstFrameMessages,
          'full_cache_journey_ms': watch.elapsedMicroseconds / 1000,
          'cache_read_ms': displayed['cache_read_ms'],
          'first_readable_frame_ms': displayed['display_ms'],
          'journey_ms': watch.elapsedMicroseconds / 1000,
        });
        await tester.pumpWidget(const SizedBox());
        controller.dispose();
        await tester.runAsync(controller.flushHistoryCache);
      }
      await tester.runAsync(store.close);
    }
    await images.close();
    await directory.delete(recursive: true);
    // ignore: avoid_print
    print(
      'SESSION_REOPEN_BENCHMARK ${jsonEncode({'scope': 'iOS simulator Debug; native SQLite + AES-GCM + production UI; '
          'new controller and DB connection, warm OS disk cache; generated data; '
          'network disabled; excludes process launch', 'samples': samples})}',
    );
  });
}

class _Keys extends SecureStore {
  _Keys(this.key);
  final List<int> key;
  @override
  Future<String?> readHistoryKey(String scope) async => base64Encode(key);
  @override
  Future<List<String>> allHistoryKeys() async => [base64Encode(key)];
  @override
  Future<void> saveOpenedSessionVersions(Map<String, String> versions) async {}
}
