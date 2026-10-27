import 'dart:io';
import 'dart:async';
import 'dart:convert';
import 'package:crypto/crypto.dart' as hashes;
import 'package:cryptography/cryptography.dart';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/storage/history_store.dart';
import 'package:relayune_mobile/src/storage/image_cache_store.dart';
import 'package:sqflite/sqflite.dart' as sqlite;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

RelayMessage message(
  String id, {
  String content = '私密会话内容',
  String? time,
  String kind = 'message',
  String? clientMessageId,
}) => RelayMessage(
  id: id,
  role: 'codex',
  content: content,
  createdAt: time ?? '2026-09-09T00:00:00Z',
  kind: kind,
  clientMessageId: clientMessageId,
);
HistoryPage page(List<RelayMessage> messages, {String? next}) => HistoryPage(
  messages: messages,
  nextCursor: next,
  hasMore: next != null,
  agents: [],
  sessions: [],
);

void main() {
  sqfliteFfiInit();
  late Directory directory;
  late HistoryStore store;
  final key = List<int>.generate(32, (i) => i);
  setUp(() async {
    directory = await Directory.systemTemp.createTemp('relayune-history-test-');
    store = HistoryStore(
      factory: databaseFactoryFfi,
      path: '${directory.path}/history.sqlite',
    );
  });
  tearDown(() async {
    await store.close();
    await store.imageCacheStore.close();
    await directory.delete(recursive: true);
  });

  test(
    'pending continuation survives reopen without counting its local marker as confirmation',
    () async {
      final action = RelayMessage(
        id: 'local_continue',
        role: 'system',
        content: '',
        createdAt: DateTime.now().toUtc().toIso8601String(),
        kind: 'local.user.action',
        turnId: 'stopped',
        clientMessageId: 'continue',
        deliveryState: MessageDeliveryState.sending,
      );
      final frame = {
        'request_id': 'same-request',
        'envelope': {'ciphertext': 'synthetic-only'},
      };
      await store.savePending(key, 'session', action, frame);
      await store.appendMessages(key, 'session', [action]);
      await store.close();
      store = HistoryStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/history.sqlite',
      );
      final restored = (await store.readPendingMessages(key, 'session')).single;
      expect(restored.kind, 'local.user.action');
      expect(restored.deliveryState, MessageDeliveryState.unconfirmed);
      expect((await store.readPending(key, 'session')).single['frame'], frame);
      await store.confirmPending(key, 'session', 'continue');
      expect(await store.readPending(key, 'session'), isEmpty);
      final latest = await store.readLatest(key, 'session');
      expect(
        latest.recent?.messages.where((m) => m.kind == 'local.user.action') ??
            [],
        isEmpty,
      );
    },
  );

  test(
    'default controllers share one database without closing each other',
    () async {
      final original = sqlite.databaseFactoryOrNull;
      final originalPath = await databaseFactoryFfi.getDatabasesPath();
      sqlite.databaseFactory = databaseFactoryFfi;
      await databaseFactoryFfi.setDatabasesPath(directory.path);
      final first = HistoryStore(imageCacheStore: store.imageCacheStore);
      final second = HistoryStore(imageCacheStore: store.imageCacheStore);
      Database? shared;
      try {
        final opened = await Future.wait([first.database, second.database]);
        shared = opened.first;
        expect(identical(opened[0], opened[1]), isTrue);
        await first.close();
        await second.appendMessages(key, 'session', [message('a')]);
        expect(
          (await first.readRecent(key, 'session'))!.messages.single.id,
          'a',
        );
      } finally {
        await first.close();
        await second.close();
        await shared?.close();
        await databaseFactoryFfi.setDatabasesPath(originalPath);
        sqlite.databaseFactory = original;
      }
    },
  );

  for (final read in ['latest', 'page', 'recent']) {
    test(
      '$read legacy image extraction does not hold the history database',
      () async {
        final images = _BlockedImages(
          '${directory.path}/blocked-images.sqlite',
        );
        store.imageCacheStore = images;
        await store.appendPage(key, 'session', null, page([message('a')]));
        final db = await store.database;
        final row = (await db.query(
          'history_log',
          where: "kind='message'",
        )).single;
        final value = HistoryStore.encodeMessage(
          message('a').copyWith(
            attachments: [
              RelayAttachment(
                id: 'photo',
                type: 'image',
                name: 'photo',
                mimeType: 'image/png',
                url: '',
                localBytes: Uint8List.fromList([1, 2, 3]),
              ),
            ],
          ),
          includeBytes: true,
        );
        final text = jsonEncode(value);
        final digest = hashes.Hmac(
          hashes.sha256,
          key,
        ).convert(utf8.encode(text)).toString();
        final aad = utf8.encode(
          jsonEncode([
            row['namespace'],
            row['session'],
            row['kind'],
            row['identity'],
            0,
            digest,
            value['created_at'],
          ]),
        );
        final box = await AesGcm.with256bits().encrypt(
          utf8.encode(text),
          secretKey: SecretKey(key),
          aad: aad,
        );
        await db.update(
          'history_log',
          {
            'encoding': 1,
            'digest': digest,
            'payload': Uint8List.fromList([
              ...box.nonce,
              ...box.mac.bytes,
              ...box.cipherText,
            ]),
          },
          where: 'seq=?',
          whereArgs: [row['seq']],
        );
        final loading = switch (read) {
          'latest' => store.readLatest(key, 'session'),
          'page' => store.readPage(key, 'session'),
          _ => store.readRecent(key, 'session'),
        };
        try {
          await images.entered.future.timeout(const Duration(seconds: 3));
          await store
              .savePending(
                key,
                'session',
                message(
                  'pending',
                  kind: 'local.user.message',
                  clientMessageId: 'pending',
                ),
                {'request_id': 'pending'},
              )
              .timeout(const Duration(milliseconds: 500));
          expect(await store.readPending(key, 'session'), hasLength(1));
        } finally {
          images.release.complete();
          await loading;
        }
      },
    );
  }

  test(
    'latest snapshot preserves checkpoint, newer revisions, pending input and tombstones',
    () async {
      await store.appendPage(
        key,
        'session',
        null,
        page([
          message('a', time: '2026-09-09T00:00:00Z'),
          message('b', time: '2026-09-09T00:01:00Z'),
        ], next: 'older'),
      );
      await store.appendMessages(key, 'session', [
        message(
          'b',
          content: 'new revision ${'x' * 40000}',
          time: '2026-09-09T00:01:00Z',
        ),
        message('c', time: '2026-09-09T00:02:00Z'),
      ]);
      await store.markDeleted(key, 'session', 'a');
      await store.savePending(
        key,
        'session',
        message(
          'input',
          kind: 'local.user.message',
          clientMessageId: 'pending',
          time: '2026-09-09T00:03:00Z',
        ),
        {'request_id': 'fixture'},
      );
      await store.close();
      final snapshot = await store.readLatest(key, 'session');
      expect(snapshot.page!.messages.map((m) => m.id), ['b']);
      expect(snapshot.page!.nextCursor, 'older');
      expect(snapshot.recent!.messages.map((m) => m.id), ['b', 'c', 'input']);
      expect(
        snapshot.recent!.messages.first.content,
        startsWith('new revision'),
      );
      expect(
        snapshot.recent!.messages.last.deliveryState,
        MessageDeliveryState.unconfirmed,
      );
      expect(await store.readLatest(List.filled(32, 99), 'session'), (
        page: null,
        recent: null,
      ));
      // Even overlapping tombstones are authenticated before publishing a page.
      await (await store.database).rawUpdate(
        "UPDATE history_log SET source=source+1 WHERE kind='message' AND deleted=1",
      );
      await expectLater(
        store.readLatest(key, 'session'),
        throwsA(isA<SecretBoxAuthenticationError>()),
      );
    },
  );

  test(
    'modern body decoding releases SQLite while retaining one captured snapshot',
    () async {
      final rows = List.generate(
        100,
        (i) => message(
          'm-$i',
          content: i < 80 ? 'synthetic large body ' * 4000 : 'small preview',
          time: DateTime.utc(
            2026,
            1,
            1,
          ).add(Duration(seconds: i)).toIso8601String(),
        ),
      );
      await store.appendPage(key, 'session', null, page(rows, next: 'older'));
      var deletionCommitted = false;
      Future<void>? deletion;
      final snapshot = await store.readLatest(
        key,
        'session',
        onPreview: (_) {
          deletion = store.markDeleted(key, 'session', 'm-0').then((_) {
            deletionCommitted = true;
          });
        },
      );
      expect(
        deletionCommitted,
        isTrue,
        reason: 'other writes must not wait for full body authentication',
      );
      await deletion;
      expect(
        snapshot.page!.messages.map((m) => m.id),
        contains('m-0'),
        reason: 'the already captured page retains its own consistent rows',
      );
      expect(
        (await store.withoutDeleted(
          key,
          'session',
          snapshot.page!.messages,
        )).map((m) => m.id),
        isNot(contains('m-0')),
        reason: 'publication authenticates the current durable tombstone',
      );
    },
  );

  test(
    'bounded preview precedes a reopened 500-message checkpoint and preserves pending input',
    () async {
      final rows = List.generate(
        500,
        (i) => message(
          'm-$i',
          time: DateTime.utc(
            2026,
            1,
            1,
          ).add(Duration(seconds: i)).toIso8601String(),
        ),
      );
      await store.appendPage(key, 'session', null, page(rows, next: 'older'));
      await store.markDeleted(key, 'session', 'm-498');
      await store.savePending(
        key,
        'session',
        message(
          'input',
          kind: 'local.user.message',
          clientMessageId: 'pending',
          time: '2026-10-02T00:00:00Z',
        ),
        {'request_id': 'fixture'},
      );
      await store.close();
      HistoryPage? preview;
      var finished = false;
      final snapshot = await store.readLatest(
        key,
        'session',
        onPreview: (value) {
          expect(finished, isFalse);
          preview = value;
          expect(value.messages, hasLength(21));
          expect(value.messages.map((m) => m.id), isNot(contains('m-498')));
          expect(
            value.messages.last.deliveryState,
            MessageDeliveryState.unconfirmed,
          );
          expect(value.nextCursor, isNull);
          expect(value.hasMore, isTrue);
        },
      );
      finished = true;
      expect(preview, isNotNull);
      expect(snapshot.page!.messages, hasLength(499));
      expect(snapshot.page!.messages.first.id, 'm-0');
      expect(snapshot.page!.messages.last.id, 'm-499');
      expect(snapshot.page!.nextCursor, 'older');
      expect(snapshot.recent!.messages, hasLength(101));
      expect(snapshot.recent!.messages.last.id, 'input');
      var crossKeyPreview = false;
      expect(
        await store.readLatest(
          List.filled(32, 99),
          'session',
          onPreview: (_) => crossKeyPreview = true,
        ),
        (page: null, recent: null),
      );
      expect(crossKeyPreview, isFalse);
    },
  );

  test(
    'latest snapshot without a complete checkpoint remains a preview',
    () async {
      await store.appendPage(
        key,
        'session',
        null,
        page([message('a'), message('b')], next: 'older'),
      );
      await (await store.database).delete(
        'history_log',
        where: "kind='message' AND identity=?",
        whereArgs: [
          hashes.Hmac(
            hashes.sha256,
            key,
          ).convert(utf8.encode('message:a')).toString(),
        ],
      );
      final snapshot = await store.readLatest(key, 'session');
      expect(snapshot.page, isNull);
      expect(snapshot.recent!.messages.single.id, 'b');
      expect(snapshot.recent!.hasMore, isTrue);
      expect(snapshot.recent!.nextCursor, isNull);
    },
  );

  test(
    'directory checkpoint survives reopening, encrypts metadata and isolates keys',
    () async {
      final preview = <String, dynamic>{
        'sessions': [
          {
            'id': 'private-session',
            'name': 'Secret project title',
            'cwd': '/private-project',
          },
        ],
        'next_cursor': 'private-cursor',
      };
      await store.appendSessionDirectory(key, preview);
      await store.appendSessionDirectory(key, preview);
      final rows = await (await store.database).query('history_log');
      expect(rows.length, 1);
      expect(rows.single.toString(), isNot(contains('private-project')));
      final bytes = rows.single['payload'] as Uint8List;
      expect(
        String.fromCharCodes(bytes),
        isNot(contains('Secret project title')),
      );
      await store.close();
      store = HistoryStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/history.sqlite',
      );
      expect(await store.readSessionDirectory(key), preview);
      expect(await store.readSessionDirectory(List.filled(32, 99)), isNull);
      await store.appendSessionDirectory(key, {
        'sessions': [],
        'next_cursor': null,
      });
      expect((await store.readSessionDirectory(key))!['sessions'], isEmpty);
      expect((await (await store.database).query('history_log')).length, 1);
    },
  );

  test(
    'replace revisions, deduplicate replay, retain authenticated terminal tombstones',
    () async {
      await store.appendPage(key, 'session', null, page([message('a')]));
      await store.appendMessages(key, 'session', [
        message('a', content: 'updated'),
      ]);
      await store.appendMessages(key, 'session', [
        message('a', content: 'updated'),
      ]);
      expect(
        (await store.readPage(key, 'session'))!.messages.single.content,
        'updated',
      );
      await store.markDeleted(key, 'session', 'a');
      await store.appendPage(key, 'session', null, page([message('a')]));
      expect((await store.readPage(key, 'session'))!.messages, isEmpty);
      final db = await store.database;
      final rows = await db.query('history_log', where: "kind='message'");
      expect(rows.length, 1);
      expect(rows.last['deleted'], 1);
      // Tampering with the terminal marker cannot resurrect a removed message.
      await db.rawUpdate(
        "UPDATE history_log SET deleted=0 WHERE kind='message'",
      );
      await expectLater(
        store.readPage(key, 'session'),
        throwsA(isA<SecretBoxAuthenticationError>()),
      );
    },
  );

  test(
    'reopen restores exact page chain, missing page remains unknown, sessions and keys isolate',
    () async {
      await store.appendPage(
        key,
        'session',
        null,
        page([message('c')], next: 'older'),
      );
      await store.appendPage(
        key,
        'session',
        'older',
        page([message('b')], next: 'oldest'),
      );
      await store.close();
      expect((await store.readPage(key, 'session'))!.nextCursor, 'older');
      expect(
        (await store.readPage(
          key,
          'session',
          before: 'older',
        ))!.messages.single.id,
        'b',
      );
      expect(await store.readPage(key, 'session', before: 'oldest'), isNull);
      expect(await store.readPage(key, 'another-session'), isNull);
      expect(await store.readPage(List.filled(32, 99), 'session'), isNull);
    },
  );

  test(
    'transaction failure leaves neither a partial page nor partial revisions',
    () async {
      final db = await store.database;
      await db.execute(
        "CREATE TRIGGER fail_page BEFORE INSERT ON history_log WHEN NEW.kind='page' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
      );
      await expectLater(
        store.appendPage(key, 'session', null, page([message('a')])),
        throwsA(isA<DatabaseException>()),
      );
      expect(await db.query('history_log'), isEmpty);
    },
  );

  test(
    'database contains no message text, cursor, session id or attachment bytes',
    () async {
      await store.appendPage(
        key,
        'private-session-unique',
        null,
        page([
          message('private-message-id').copyWith(
            attachments: [
              RelayAttachment(
                id: 'attachment',
                type: 'image',
                name: 'private-image',
                mimeType: 'image/png',
                url: '/private/image',
                localBytes: Uint8List.fromList([1, 2, 3, 4]),
              ),
            ],
          ),
        ], next: 'private-cursor-unique'),
      );
      final restored = (await store.readPage(
        key,
        'private-session-unique',
      ))!.messages.single;
      expect(restored.attachments.single.localBytes, isNull);
      expect(
        await store.imageCacheStore.read(
          key,
          'private-session-unique',
          'attachment',
          RelayAttachmentVariant.original,
        ),
        [1, 2, 3, 4],
      );
      final rows = await (await store.database).query('history_log');
      expect(rows.toString(), isNot(contains('private-')));
      await store.close();
      final bytes = await File(
        '${directory.path}/history.sqlite',
      ).readAsBytes();
      final raw = String.fromCharCodes(bytes);
      expect(raw, isNot(contains('private-')));
      expect(raw, isNot(contains('私密')));
    },
  );

  test(
    'event-only preview uses message chronology, never claims complete coverage',
    () async {
      await store.appendMessages(key, 'session', [
        message('new', time: '2026-09-10T00:00:00Z'),
        message('old', time: '2026-09-01T00:00:00Z'),
      ]);
      await store.appendMessages(key, 'session', [
        message('old', content: 'edited', time: '2026-09-01T00:00:00Z'),
      ]);
      final recent = await store.readRecent(key, 'session');
      expect(recent!.messages.map((m) => m.id), ['old', 'new']);
      expect(recent.hasMore, isTrue);
      expect(recent.nextCursor, isNull);
      await store.markDeleted(key, 'session', 'new');
      expect(
        (await store.readRecent(key, 'session'))!.messages.single.id,
        'old',
      );
      expect(
        await store.withoutDeleted(key, 'session', [
          message('new'),
          message('old'),
        ]),
        hasLength(1),
      );
    },
  );

  test(
    'source revisions resist stale snapshots and authenticate the ordering index',
    () async {
      await store.appendPage(
        key,
        'session',
        null,
        page([message('a').copyWith(sourceSequence: 20)]),
      );
      await store.appendMessages(key, 'session', [
        message('a', content: 'stale').copyWith(sourceSequence: 10),
      ]);
      expect(
        (await store.readPage(key, 'session'))!.messages.single.content,
        '私密会话内容',
      );
      await store.appendMessages(key, 'session', [
        message('a', content: 'final').copyWith(sourceSequence: 21),
      ]);
      expect(
        (await store.readPage(key, 'session'))!.messages.single.content,
        'final',
      );
      await (await store.database).rawUpdate(
        "UPDATE history_log SET source=0 WHERE kind='message'",
      );
      await expectLater(
        store.readPage(key, 'session'),
        throwsA(isA<SecretBoxAuthenticationError>()),
      );
    },
  );

  test(
    'global LRU retains 100 bodies across computers, respects access and current pin',
    () async {
      final other = List<int>.filled(32, 99);
      for (var i = 0; i < 100; i++) {
        await store.appendPage(
          i.isEven ? key : other,
          'session-$i',
          null,
          page([message('a')]),
        );
      }
      store.pinSession(key, 'session-0');
      await store.readPage(other, 'session-1');
      await store.appendPage(other, 'session-100', null, page([message('a')]));
      expect((await store.statistics())['sessions'], 100);
      expect(await store.readPage(key, 'session-2'), isNull);
      expect(await store.readPage(key, 'session-0'), isNotNull);
      expect(await store.readPage(other, 'session-1'), isNotNull);
    },
  );

  test(
    'pending input and image bytes survive body eviction, reopen and image LRU pressure',
    () async {
      await store.close();
      store = HistoryStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/history.sqlite',
        maxSessions: 1,
      );
      final pending =
          message(
            'local-msg',
            clientMessageId: 'client-msg',
            kind: 'local.user.message',
          ).copyWith(
            attachments: [
              RelayAttachment(
                id: 'photo',
                type: 'image',
                name: 'photo',
                mimeType: 'image/png',
                url: '',
                localBytes: Uint8List.fromList([1, 2, 3]),
              ),
            ],
          );
      await store.savePending(key, 'old', pending, {
        'request_id': 'frozen',
        'expires_at': 'unchanged',
      });
      await store.appendPage(key, 'old', null, page([pending]));
      await store.appendPage(key, 'new', null, page([message('new')]));
      expect(await store.readPage(key, 'old'), isNull);
      await store.imageCacheStore.removeNamespace(key);
      await store.close();
      final restored = await store.readRecent(key, 'old');
      expect(restored!.messages.single.attachments.single.localBytes, [
        1,
        2,
        3,
      ]);
      expect((await store.readPending(key, 'old')).single['frame'], {
        'request_id': 'frozen',
        'expires_at': 'unchanged',
      });
      await store.confirmPending(key, 'old', 'client-msg');
      expect(await store.readPending(key, 'old'), isEmpty);
      expect(await store.readRecent(key, 'old'), isNull);
      await store.removeNamespace(key);
      expect((await store.statistics())['messages'], 0);
      expect((await store.statistics())['pending'], 0);
      expect((await store.statistics())['sessions'], 0);
    },
  );

  test(
    'eviction retains tombstones and cannot replay a deleted body',
    () async {
      await store.close();
      store = HistoryStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/history.sqlite',
        maxSessions: 1,
      );
      await store.appendPage(key, 'old', null, page([message('a')]));
      await store.markDeleted(key, 'old', 'a');
      await store.appendPage(key, 'new', null, page([message('b')]));
      await store.appendPage(key, 'old', null, page([message('a')]));
      expect((await store.readPage(key, 'old'))!.messages, isEmpty);
    },
  );

  test(
    'large history round-trips and retains one revision rather than all snapshots',
    () async {
      final text = List.filled(10000, '长会话🙂').join();
      for (var i = 0; i < 3; i++) {
        await store.appendMessages(key, 'large', [
          message('a', content: '$text$i'),
        ]);
      }
      expect(
        (await store.readRecent(key, 'large'))!.messages.single.content,
        '${text}2',
      );
      expect((await store.statistics())['messages'], 1);
    },
  );

  test(
    'v1 migration compacts versions, extracts images, preserves cursor/deletion and pending input',
    () async {
      await store.close();
      final path = '${directory.path}/history.sqlite';
      final db = await databaseFactoryFfi.openDatabase(
        path,
        options: OpenDatabaseOptions(
          version: 1,
          onCreate: (db, _) async {
            await db.execute(
              '''CREATE TABLE history_log(seq INTEGER PRIMARY KEY AUTOINCREMENT,
        namespace TEXT NOT NULL,session TEXT NOT NULL,kind TEXT NOT NULL,identity TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,position TEXT NOT NULL,digest TEXT NOT NULL,payload BLOB NOT NULL)''',
            );
            for (final operation in ['UPDATE', 'DELETE']) {
              await db.execute(
                "CREATE TRIGGER history_no_${operation.toLowerCase()} BEFORE $operation ON history_log BEGIN SELECT RAISE(ABORT,'append-only'); END",
              );
            }
          },
        ),
      );
      Future<void> legacy(
        String kind,
        String id,
        Map<String, dynamic> value, {
        bool deleted = false,
      }) async {
        String h(String value) => hashes.Hmac(
          hashes.sha256,
          key,
        ).convert(utf8.encode(value)).toString();
        final route = [
          h('history-v1'),
          h('session:legacy'),
          kind,
          h('$kind:$id'),
        ];
        final text = jsonEncode(value),
            digest = h(jsonEncode(value)),
            position = value['created_at'] ?? '';
        final box = await AesGcm.with256bits().encrypt(
          utf8.encode(text),
          secretKey: SecretKey(key),
          aad: utf8.encode(
            jsonEncode([...route, deleted ? 1 : 0, digest, position]),
          ),
        );
        await db.insert('history_log', {
          'namespace': route[0],
          'session': route[1],
          'kind': kind,
          'identity': route[3],
          'deleted': deleted ? 1 : 0,
          'position': position,
          'digest': digest,
          'payload': Uint8List.fromList([
            ...box.nonce,
            ...box.mac.bytes,
            ...box.cipherText,
          ]),
        });
      }

      await legacy(
        'message',
        'a',
        HistoryStore.encodeMessage(message('a', content: 'old')),
      );
      await legacy(
        'message',
        'a',
        HistoryStore.encodeMessage(
          message('a', content: 'latest').copyWith(
            attachments: [
              RelayAttachment(
                id: 'photo',
                type: 'image',
                name: 'photo',
                mimeType: 'image/png',
                url: '',
                localBytes: Uint8List.fromList([9, 8, 7]),
              ),
            ],
          ),
          includeBytes: true,
        ),
      );
      await legacy('message', 'deleted', {'id': 'deleted'}, deleted: true);
      await legacy(
        'message',
        'draft',
        HistoryStore.encodeMessage(
          message(
            'draft',
            kind: 'local.user.message',
            clientMessageId: 'pending',
          ),
          includeBytes: true,
        ),
      );
      await legacy('page', '', {
        'ids': ['a', 'deleted'],
        'next_cursor': 'older',
        'has_more': true,
      });
      await legacy('page', 'unopened', {
        'ids': [],
        'next_cursor': null,
        'has_more': false,
      });
      await db.close();
      final restored = await store.readPage(key, 'legacy');
      expect(restored!.messages.single.content, 'latest');
      expect(restored.nextCursor, 'older');
      expect(restored.messages.single.attachments.single.localBytes, isNull);
      expect(
        await store.imageCacheStore.read(
          key,
          'legacy',
          'photo',
          RelayAttachmentVariant.original,
        ),
        [9, 8, 7],
      );
      await store.readRecent(key, 'legacy');
      expect(await store.readPending(key, 'legacy'), hasLength(1));
      final rows = await (await store.database).query('history_log');
      expect(rows, hasLength(5));
      expect(
        rows.where((r) => r['encoding'] == 1),
        hasLength(1),
        reason: 'initial restore does not block on unrelated unopened pages',
      );
      await store.maintainNamespaces(await store.cachedNamespaces(), [
        key,
      ], shouldContinue: () => false);
      expect(
        (await (await store.database).query(
          'history_log',
        )).where((row) => row['encoding'] == 1),
        hasLength(1),
      );
      await store.maintainNamespaces(await store.cachedNamespaces(), [key]);
      expect(
        (await (await store.database).query(
          'history_log',
        )).every((r) => r['encoding'] == 2),
        isTrue,
      );
      await store.appendMessages(key, 'legacy', [
        message('a', content: 'after migration'),
      ]);
      expect(
        (await store.readPage(key, 'legacy'))!.messages.single.content,
        'after migration',
      );
    },
  );

  test(
    'maintenance removes destroyed-key namespaces while preserving valid pending input',
    () async {
      final orphan = List<int>.filled(32, 99);
      await store.appendPage(orphan, 'orphan', null, page([message('a')]));
      await store.savePending(
        orphan,
        'orphan',
        message('old', clientMessageId: 'old'),
        {},
      );
      await store.appendPage(key, 'valid', null, page([message('b')]));
      await store.savePending(
        key,
        'valid',
        message('draft', clientMessageId: 'draft'),
        {},
      );
      final candidates = await store.cachedNamespaces();
      await store.maintainNamespaces(candidates, [key]);
      expect(await store.readRecent(orphan, 'orphan'), isNull);
      expect(await store.readPending(orphan, 'orphan'), isEmpty);
      expect(await store.readPending(key, 'valid'), hasLength(1));
      expect((await store.statistics())['sessions'], 1);
    },
  );

  test(
    'concurrent page and live writes remain atomic and keep all versions',
    () async {
      await Future.wait([
        store.appendPage(key, 'session', null, page([message('a')])),
        store.appendMessages(key, 'session', [message('b')]),
      ]);
      expect((await store.readPage(key, 'session'))!.messages.single.id, 'a');
      expect(
        (await (await store.database).query(
          'history_log',
          where: "kind='message'",
        )).length,
        2,
      );
    },
  );
}

class _BlockedImages extends ImageCacheStore {
  _BlockedImages(String path) : super(factory: databaseFactoryFfi, path: path);
  final entered = Completer<void>(), release = Completer<void>();
  @override
  Future<void> putForSessionHash(
    List<int> key,
    String sessionHash,
    String attachment,
    RelayAttachmentVariant variant,
    Uint8List bytes,
  ) async {
    if (!entered.isCompleted) entered.complete();
    await release.future;
    await super.putForSessionHash(key, sessionHash, attachment, variant, bytes);
  }
}
