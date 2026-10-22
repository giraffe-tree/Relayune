import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/storage/history_store.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('native SQLite append-only history benchmark', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: Text('SQLite history benchmark'))),
    );
    final result = await tester.runAsync(() async {
      final directory = await Directory.systemTemp.createTemp(
        'relayune-benchmark-',
      );
      final path = '${directory.path}/history.sqlite';
      final key = List<int>.generate(32, (i) => i);
      var store = HistoryStore(path: path);
      final messages = List.generate(
        5000,
        (i) => RelayMessage(
          id: 'fixture-$i',
          role: i.isEven ? 'user' : 'codex',
          content: 'Synthetic fixture $i ${'x' * 2048}',
          createdAt: DateTime.utc(
            2026,
            1,
            1,
          ).add(Duration(seconds: i)).toIso8601String(),
          kind: 'message',
        ),
      );
      final write = Stopwatch()..start();
      // A chain of actual 100-message pages, latest page is the normal 20.
      await store.appendPage(
        key,
        'fixture',
        null,
        HistoryPage(
          messages: messages.sublist(4980),
          nextCursor: '4980',
          hasMore: true,
          agents: [],
          sessions: [],
        ),
      );
      for (var end = 4980; end > 0; end -= 100) {
        final start = (end - 100).clamp(0, end);
        await store.appendPage(
          key,
          'fixture',
          '$end',
          HistoryPage(
            messages: messages.sublist(start, end),
            nextCursor: start == 0 ? null : '$start',
            hasMore: start > 0,
            agents: [],
            sessions: [],
          ),
        );
      }
      final initialWriteMs = write.elapsedMicroseconds / 1000;
      final revisionWatch = Stopwatch()..start();
      for (var revision = 0; revision < 20; revision++) {
        await store.appendMessages(key, 'fixture', [
          messages.last.copyWith(content: 'Revision $revision ${'y' * 2048}'),
        ]);
      }
      final revisionsMs = revisionWatch.elapsedMicroseconds / 1000;
      final samples = <Map<String, Object?>>[];
      for (var run = 0; run < 20; run++) {
        await store.close();
        store = HistoryStore(path: path);
        final timer = Stopwatch()..start();
        final latest = await store.readPage(key, 'fixture');
        final latestMs = timer.elapsedMicroseconds / 1000;
        expect(latest!.messages.length, 20);
        expect(latest.messages.last.content, startsWith('Revision 19'));
        timer.reset();
        final older = await store.readPage(
          key,
          'fixture',
          before: latest.nextCursor,
        );
        final olderMs = timer.elapsedMicroseconds / 1000;
        expect(older!.messages.length, 100);
        samples.add({
          'run': run,
          'reopened_latest20_ms': latestMs,
          'older100_ms': olderMs,
        });
      }
      final rows = await (await store.database).rawQuery(
        'SELECT COUNT(*) AS count FROM history_log',
      );
      await store.close();
      final bytes = await File(path).length();
      await directory.delete(recursive: true);
      return {
        'scenario': 'native_sqlite_reopen',
        'fixture_messages': 5000,
        'message_content_bytes_approx': 2048,
        'revisions': 20,
        'rows': rows.single['count'],
        'database_bytes': bytes,
        'initial_write_ms': initialWriteMs,
        'revision_write_ms': revisionsMs,
        'samples': samples,
        'network_used': false,
        'scope':
            'Debug native SQLite + AES-GCM + decoding; reopen is not an OS disk-cache cold start; no UI frame/network timing',
      };
    });
    // Generated fixture metrics only, never user history or credentials.
    // ignore: avoid_print
    print('HISTORY_CACHE_BENCHMARK ${jsonEncode(result)}');
  });
}
