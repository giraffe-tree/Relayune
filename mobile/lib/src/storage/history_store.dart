import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as hashes;
import 'package:sqflite/sqflite.dart';
import 'package:flutter/foundation.dart' show compute, listEquals, mapEquals;

import '../models.dart';
import 'history_codec.dart';
import 'image_cache_store.dart';

/// Encrypted materialized messages and atomic page checkpoints. Only one
/// authenticated revision is retained per identity; deletions remain terminal.
class HistoryStore {
  HistoryStore({
    DatabaseFactory? factory,
    String? path,
    ImageCacheStore? imageCacheStore,
    this.maxSessions = 100,
  }) : _factory = factory,
       _path = path,
       imageCacheStore =
           imageCacheStore ??
           (factory == null
               ? ImageCacheStore.shared
               : ImageCacheStore(
                   factory: factory,
                   path: path == null ? null : '$path.images',
                 ));

  final DatabaseFactory? _factory;
  final String? _path;
  final int maxSessions;
  ImageCacheStore imageCacheStore;
  Future<Database>? _database;
  final Map<String, Future<void>> _migrations = {};
  int evictedSessions = 0;
  static final Map<String, int> _visibleSessions = {};
  String? _visibleSession;
  void pinSession(List<int> key, String? session) {
    unpinSession();
    if (session == null) return;
    _visibleSession = '${namespace(key)}:${_hash(key, "session:$session")}';
    _visibleSessions.update(
      _visibleSession!,
      (count) => count + 1,
      ifAbsent: () => 1,
    );
  }

  void unpinSession() {
    final id = _visibleSession;
    _visibleSession = null;
    if (id == null) return;
    final count = (_visibleSessions[id] ?? 1) - 1;
    if (count == 0) {
      _visibleSessions.remove(id);
    } else {
      _visibleSessions[id] = count;
    }
  }

  Future<Database> get database =>
      _database ??= _open().catchError((Object error) {
        _database = null;
        throw error;
      });

  Future<Database> _open() async {
    final factory = _factory ?? databaseFactory;
    return factory.openDatabase(
      _path ?? '${await factory.getDatabasesPath()}/history-v1.sqlite',
      options: OpenDatabaseOptions(
        singleInstance: _factory == null && _path == null,
        version: 2,
        onCreate: (db, _) async {
          await db.execute(
            '''CREATE TABLE history_log (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, namespace TEXT NOT NULL,
            session TEXT NOT NULL, kind TEXT NOT NULL, identity TEXT NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0, position TEXT NOT NULL,
            digest TEXT NOT NULL, payload BLOB NOT NULL,
            source INTEGER NOT NULL DEFAULT 0, encoding INTEGER NOT NULL DEFAULT 2)''',
          );
          await _indexes(db);
        },
        onUpgrade: (db, old, _) async {
          await db.execute('DROP TRIGGER IF EXISTS history_no_update');
          await db.execute('DROP TRIGGER IF EXISTS history_no_delete');
          await db.execute(
            'ALTER TABLE history_log ADD COLUMN source INTEGER NOT NULL DEFAULT 0',
          );
          await db.execute(
            'ALTER TABLE history_log ADD COLUMN encoding INTEGER NOT NULL DEFAULT 1',
          );
          await db.execute(
            '''DELETE FROM history_log WHERE seq NOT IN
            (SELECT MAX(seq) FROM history_log GROUP BY namespace,session,kind,identity)''',
          );
          await _indexes(db);
          // Access was not tracked in v1. Initially retain the newest bodies.
          await db.execute(
            '''INSERT OR IGNORE INTO history_sessions(namespace,session,accessed)
            SELECT namespace,session,MAX(seq) FROM history_log
            WHERE kind IN ('message','page') AND deleted=0 GROUP BY namespace,session''',
          );
        },
      ),
    );
  }

  static Future<void> _indexes(DatabaseExecutor db) async {
    await db.execute(
      'CREATE UNIQUE INDEX history_identity ON history_log(namespace,session,kind,identity)',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS history_recent ON history_log(namespace,session,kind,position DESC,seq DESC)',
    );
    await db.execute(
      '''CREATE TABLE history_sessions(namespace TEXT NOT NULL,session TEXT NOT NULL,
      accessed INTEGER NOT NULL, PRIMARY KEY(namespace,session))''',
    );
    await db.execute(
      'CREATE INDEX history_session_lru ON history_sessions(accessed)',
    );
    await db.execute(
      '''CREATE TABLE history_pending(namespace TEXT NOT NULL,session TEXT NOT NULL,
      kind TEXT NOT NULL,identity TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,
      position TEXT NOT NULL,digest TEXT NOT NULL,payload BLOB NOT NULL,
      source INTEGER NOT NULL DEFAULT 0,encoding INTEGER NOT NULL DEFAULT 2,
      PRIMARY KEY(namespace,session,kind,identity))''',
    );
  }

  String _hash(List<int> key, String text) =>
      hashes.Hmac(hashes.sha256, key).convert(utf8.encode(text)).toString();
  String namespace(List<int> key) => _hash(key, 'history-v1');
  List<Object?> _route(List<int> key, String session, String kind, String id) =>
      [
        namespace(key),
        _hash(key, 'session:$session'),
        kind,
        _hash(key, '$kind:$id'),
      ];

  Future<Map<String, Object?>?> _latest(
    DatabaseExecutor db,
    List<Object?> route,
  ) async => (await db.query(
    'history_log',
    where: 'namespace=? AND session=? AND kind=? AND identity=?',
    whereArgs: route,
    limit: 1,
  )).firstOrNull;
  Future<Map<String, Map<String, Object?>>> _latestMessages(
    DatabaseExecutor db,
    List<int> key,
    String session,
    List<String> ids,
  ) async {
    final result = <String, Map<String, Object?>>{};
    for (var start = 0; start < ids.length; start += 100) {
      final batch = ids
          .skip(start)
          .take(100)
          .map((id) => _hash(key, 'message:$id'))
          .toList();
      final rows = await db.query(
        'history_log',
        where:
            "namespace=? AND session=? AND kind='message' AND identity IN (${List.filled(batch.length, '?').join(',')})",
        whereArgs: [..._route(key, session, 'message', '').take(2), ...batch],
      );
      for (final row in rows) {
        result[row['identity'] as String] = row;
      }
    }
    return result;
  }

  Future<void> _append(
    DatabaseExecutor db,
    List<int> key,
    String session,
    String kind,
    String id,
    Map<String, dynamic> value, {
    bool deleted = false,
  }) async {
    final route = _route(key, session, kind, id);
    final previous = await _latest(db, route);
    final source = (value['source_sequence'] as num?)?.toInt() ?? 0;
    if (previous != null) {
      // Authenticate the revision/terminal marker before trusting indexed flags.
      await HistoryCodec.open(key, previous);
      if (previous['deleted'] == 1 ||
          (!deleted && (previous['source'] as int) > source)) {
        return;
      }
    }
    final row = await HistoryCodec.seal(key, route, value, deleted, source);
    if (previous?['digest'] == row['digest'] &&
        previous?['source'] == source &&
        !deleted) {
      return;
    }
    await db.insert(
      'history_log',
      row,
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  String _rowIdentity(Map<String, Object?> row) =>
      '${row['namespace']}:${row['session']}:${row['kind']}:${row['identity']}';

  Future<Map<String, Map<String, Object?>>> _rowVersions(
    DatabaseExecutor db,
    List<Map<String, Object?>> rows,
  ) async {
    final groups = <(Object?, Object?, Object?), List<Object?>>{};
    for (final row in rows) {
      (groups[(row['namespace'], row['session'], row['kind'])] ??= []).add(
        row['identity'],
      );
    }
    final result = <String, Map<String, Object?>>{};
    for (final entry in groups.entries) {
      for (var start = 0; start < entry.value.length; start += 100) {
        final ids = entry.value.skip(start).take(100).toList();
        final values = await db.query(
          'history_log',
          where:
              'namespace=? AND session=? AND kind=? AND identity IN (${List.filled(ids.length, '?').join(',')})',
          whereArgs: [entry.key.$1, entry.key.$2, entry.key.$3, ...ids],
        );
        for (final row in values) {
          result[_rowIdentity(row)] = row;
        }
      }
    }
    return result;
  }

  bool _sameRow(Map<String, Object?>? left, Map<String, Object?>? right) {
    if (left == null || right == null) return left == right;
    return listEquals(
          left['payload'] as List<int>,
          right['payload'] as List<int>,
        ) &&
        mapEquals({...left}..remove('payload'), {...right}..remove('payload'));
  }

  /// Authenticate and encrypt outside SQLite. Commit only if the authenticated
  /// snapshot is still current, including concurrent terminal deletion markers.
  /// Protected input is free to use the database while these bodies decode.
  Future<void> _writeRows(
    List<int> key,
    List<(List<Object?>, Map<String, dynamic>, bool, int)> values, {
    bool touch = true,
  }) async {
    if (values.isEmpty) return;
    final db = await database;
    final rows = await HistoryCodec.sealMany(key, values);
    while (true) {
      final previous = await _rowVersions(db, rows);
      await HistoryCodec.openMany(key, previous.values.toList());
      final committed = await db.transaction((txn) async {
        final latest = await _rowVersions(txn, rows);
        for (final row in rows) {
          final id = _rowIdentity(row);
          if (!_sameRow(previous[id], latest[id])) return false;
        }
        final batch = txn.batch();
        for (final row in rows) {
          final prior = previous[_rowIdentity(row)];
          if (prior != null &&
              (prior['deleted'] == 1 ||
                  (prior['source'] as int) > (row['source'] as int) ||
                  (prior['digest'] == row['digest'] &&
                      prior['source'] == row['source']))) {
            continue;
          }
          batch.insert(
            'history_log',
            row,
            conflictAlgorithm: ConflictAlgorithm.replace,
          );
        }
        await batch.commit(noResult: true);
        if (touch) await _touch(txn, values.first.$1, access: false);
        return true;
      });
      if (committed) return;
    }
  }

  (List<Object?>, Map<String, dynamic>, bool, int) _messageRow(
    List<int> key,
    String session,
    RelayMessage message,
  ) => (
    _route(key, session, 'message', message.id),
    encodeMessage(message),
    false,
    message.sourceSequence,
  );

  Future<Map<String, dynamic>> _decode(
    List<int> key,
    Map<String, Object?> row,
  ) => HistoryCodec.open(key, row);

  Future<void> _touch(
    DatabaseExecutor db,
    List<Object?> route, {
    bool access = true,
  }) async {
    final clock = Sqflite.firstIntValue(
      await db.rawQuery(
        'SELECT COALESCE(MAX(accessed),0)+1 FROM history_sessions',
      ),
    )!;
    await db.rawInsert(
      '''INSERT INTO history_sessions(namespace,session,accessed) VALUES(?,?,?)
      ON CONFLICT(namespace,session) DO UPDATE SET accessed=${access ? "excluded.accessed" : "history_sessions.accessed"}''',
      [...route.take(2), clock],
    );
    await _prune(db, keep: route.take(2).toList());
  }

  Future<void> _prune(DatabaseExecutor db, {List<Object?>? keep}) async {
    final rows = await db.rawQuery(
      '''SELECT s.*, EXISTS(SELECT 1 FROM history_pending p
      WHERE p.namespace=s.namespace AND p.session=s.session) AS pending
      FROM history_sessions s ORDER BY pending ASC,accessed ASC''',
    );
    var excess = rows.length - maxSessions;
    for (final row in rows) {
      if (excess <= 0) break;
      if (Sqflite.firstIntValue(
            await db.rawQuery(
              "SELECT COUNT(*) FROM history_log WHERE namespace=? AND session=? AND encoding=1",
              [row['namespace'], row['session']],
            ),
          )! >
          0) {
        continue;
      }
      if (keep != null &&
          row['namespace'] == keep[0] &&
          row['session'] == keep[1]) {
        continue;
      }
      if (_visibleSessions.containsKey(
        "${row['namespace']}:${row['session']}",
      )) {
        continue;
      }
      final route = [row['namespace'], row['session']];
      // Terminal markers are small and intentionally survive body eviction.
      await db.delete(
        'history_log',
        where: 'namespace=? AND session=? AND deleted=0 AND kind IN (?,?)',
        whereArgs: [...route, 'message', 'page'],
      );
      await db.delete(
        'history_sessions',
        where: 'namespace=? AND session=?',
        whereArgs: route,
      );
      excess--;
      evictedSessions++;
    }
  }

  Future<void> touchSession(List<int> key, String session) async {
    final db = await database;
    await db.transaction(
      (txn) => _touch(txn, _route(key, session, 'message', '')),
    );
  }

  Future<void> _extractImages(
    List<int> key,
    String sessionHash,
    Map<String, dynamic> value,
  ) async {
    for (final item in value['attachments'] as List? ?? const []) {
      final a = item as Map;
      for (final entry in [
        ('local_bytes', RelayAttachmentVariant.original),
        ('thumbnail_bytes', RelayAttachmentVariant.preview),
      ]) {
        final encoded = a[entry.$1];
        if (encoded is String) {
          await imageCacheStore.putForSessionHash(
            key,
            sessionHash,
            a['id'] as String,
            entry.$2,
            encoded.length >= 32 * 1024
                ? await compute(_decodeAttachment, encoded)
                : base64Decode(encoded),
          );
          a.remove(entry.$1);
        }
      }
    }
  }

  Future<void> _prepare(
    List<int> key,
    String session,
    List<RelayMessage> messages,
  ) async {
    final db = await database;
    final existing = await _latestMessages(
      db,
      key,
      session,
      messages.map((m) => m.id).toList(),
    );
    for (final row in existing.values) {
      if (row['encoding'] == 1) await _migrateRow(db, key, row);
    }
    final sessionHash = _hash(key, 'session:$session');
    for (final message in messages) {
      for (final a in message.attachments) {
        if (a.localBytes != null) {
          await imageCacheStore.putForSessionHash(
            key,
            sessionHash,
            a.id,
            RelayAttachmentVariant.original,
            a.localBytes!,
          );
        }
        if (a.thumbnailBytes != null) {
          await imageCacheStore.putForSessionHash(
            key,
            sessionHash,
            a.id,
            RelayAttachmentVariant.preview,
            a.thumbnailBytes!,
          );
        }
      }
    }
  }

  Future<Map<String, dynamic>> _migrateRow(
    DatabaseExecutor db,
    List<int> key,
    Map<String, Object?> row,
  ) async {
    final value = await _decode(key, row);
    Map<String, Object?>? pending;
    if (value['kind'] == 'local.user.message' &&
        value['client_message_id'] != null) {
      pending = await HistoryCodec.seal(
        key,
        [
          row['namespace'],
          row['session'],
          'pending',
          _hash(key, "pending:${value['client_message_id']}"),
        ],
        {'message': value},
        false,
        0,
      );
    }
    await _extractImages(key, row['session'] as String, value);
    final sealed = await HistoryCodec.seal(
      key,
      [row['namespace'], row['session'], row['kind'], row['identity']],
      value,
      row['deleted'] == 1,
      0,
    );
    Future<void> commit(DatabaseExecutor txn) async {
      final changed = await txn.update(
        'history_log',
        sealed,
        where: 'seq=? AND digest=? AND encoding=1',
        whereArgs: [row['seq'], row['digest']],
      );
      // Pending preservation and removing inline bytes are atomic. A stale
      // migration cannot recreate input already confirmed by a newer writer.
      if (changed > 0 && pending != null) {
        await txn.insert(
          'history_pending',
          pending,
          conflictAlgorithm: ConflictAlgorithm.ignore,
        );
      }
    }

    if (db is Database) {
      await db.transaction(commit);
    } else {
      await commit(db);
    }
    return value;
  }

  Future<void> _migrate(
    List<int> key, {
    bool Function()? shouldContinue,
  }) => _migrations
      .putIfAbsent(namespace(key), () async {
        final db = await database;
        var after = 0;
        while (true) {
          if (shouldContinue?.call() == false) {
            _migrations.remove(namespace(key));
            return;
          }
          final rows = await db.query(
            'history_log',
            where: 'namespace=? AND encoding=1 AND seq>?',
            whereArgs: [namespace(key), after],
            orderBy: 'seq',
            limit: 4,
          );
          if (rows.isEmpty) break;
          for (final row in rows) {
            after = row['seq'] as int;
            await _migrateRow(db, key, row);
          }
          // Background upgrade yields between batches so foreground reads and
          // realtime/render work are not starved by a large legacy database.
          await Future<void>.delayed(const Duration(milliseconds: 8));
        }
        if (shouldContinue?.call() != false) {
          await db.transaction((txn) => _prune(txn));
        } else {
          _migrations.remove(namespace(key));
        }
      })
      .catchError((Object error) {
        _migrations.remove(namespace(key));
        throw error;
      });

  Future<void> appendSessionDirectory(
    List<int> key,
    Map<String, dynamic> value,
  ) async {
    await _writeRows(key, [
      (
        _route(key, 'directory', 'session-directory', 'checkpoint'),
        value,
        false,
        0,
      ),
    ], touch: false);
  }

  Future<Map<String, dynamic>?> readSessionDirectory(List<int> key) async {
    final row = await _latest(
      await database,
      _route(key, 'directory', 'session-directory', 'checkpoint'),
    );
    return row == null ? null : _decode(key, row);
  }

  Future<void> appendMessages(
    List<int> key,
    String session,
    List<RelayMessage> messages,
  ) async {
    await _prepare(key, session, messages);
    await _writeRows(key, [
      for (final m in messages) _messageRow(key, session, m),
    ]);
  }

  Future<void> appendPage(
    List<int> key,
    String session,
    String? before,
    HistoryPage page,
  ) async {
    await _prepare(key, session, page.messages);
    await _writeRows(key, [
      for (final m in page.messages) _messageRow(key, session, m),
      (
        _route(key, session, 'page', before ?? ''),
        {
          'ids': page.messages.map((m) => m.id).toList(),
          'next_cursor': page.nextCursor,
          'has_more': page.hasMore,
          'source_sequence': page.messages.fold<int>(
            0,
            (seq, m) => seq > m.sourceSequence ? seq : m.sourceSequence,
          ),
        },
        false,
        page.messages.fold<int>(
          0,
          (seq, m) => seq > m.sourceSequence ? seq : m.sourceSequence,
        ),
      ),
    ]);
  }

  // A cache exists only for this SQLite snapshot. Reusing authenticated rows
  // across separate transactions could hide newer revisions or deletions.
  Future<List<Map<String, dynamic>>> _openRows(
    DatabaseExecutor db,
    List<int> key,
    List<Map<String, Object?>> rows,
    Map<String, Map<String, dynamic>> decoded,
  ) async {
    final modern = rows
        .where(
          (row) =>
              row['encoding'] != 1 && !decoded.containsKey(row['identity']),
        )
        .toList();
    final values = await HistoryCodec.openMany(key, modern);
    for (var i = 0; i < modern.length; i++) {
      decoded[modern[i]['identity'] as String] = values[i];
    }
    final result = <Map<String, dynamic>>[];
    for (final row in rows) {
      final id = row['identity'] as String;
      decoded[id] ??= await _migrateRow(db, key, row);
      result.add(decoded[id]!);
    }
    return result;
  }

  Future<
    ({
      Map<String, dynamic> value,
      Map<String, Object?> row,
      List<Map<String, Object?>> messages,
    })?
  >
  _capturePage(
    DatabaseExecutor db,
    List<int> key,
    String session,
    String? before,
  ) async {
    final row = await _latest(db, _route(key, session, 'page', before ?? ''));
    if (row == null) return null;
    // Only the small checkpoint is authenticated while holding the snapshot.
    final value = await _decode(key, row);
    final ids = (value['ids'] as List).cast<String>();
    final latest = await _latestMessages(db, key, session, ids);
    final rows = <Map<String, Object?>>[];
    for (final id in ids) {
      final body = latest[_hash(key, 'message:$id')];
      if (body == null) return null;
      rows.add(body);
    }
    return (value: value, row: row, messages: rows);
  }

  Future<HistoryPage?> readPage(
    List<int> key,
    String session, {
    String? before,
  }) async {
    final db = await database;
    final snapshot = await db.transaction((txn) async {
      final captured = await _capturePage(txn, key, session, before);
      if (captured != null) await _touch(txn, _route(key, session, 'page', ''));
      return captured;
    });
    if (snapshot == null) return null;
    if (snapshot.row['encoding'] == 1) {
      await _migrateRow(db, key, snapshot.row);
    }
    final values = await _openRows(db, key, snapshot.messages, {});
    return HistoryPage(
      messages: [
        for (var i = 0; i < snapshot.messages.length; i++)
          if (snapshot.messages[i]['deleted'] != 1) decodeMessage(values[i]),
      ],
      nextCursor: snapshot.value['next_cursor'] as String?,
      hasMore: snapshot.value['has_more'] == true,
      agents: const [],
      sessions: const [],
    );
  }

  /// Capture one SQLite snapshot, then authenticate bodies outside its lock.
  /// Network deletion checks and protected input writes can proceed while a
  /// large page is decoding. Overlapping rows still authenticate only once.
  Future<({HistoryPage? page, HistoryPage? recent})> readLatest(
    List<int> key,
    String session, {
    void Function(HistoryPage preview)? onPreview,
  }) async {
    final db = await database;
    Map<String, dynamic>? checkpoint;
    Map<String, Object?>? checkpointRow;
    List<Map<String, Object?>> pageRows = [], recentRows = [], pendingRows = [];
    await db.transaction((txn) async {
      final route = _route(key, session, 'page', '');
      final captured = await _capturePage(txn, key, session, null);
      checkpoint = captured?.value;
      checkpointRow = captured?.row;
      pageRows = captured?.messages ?? [];
      recentRows = await txn.query(
        'history_log',
        where: "namespace=? AND session=? AND kind='message' AND deleted=0",
        whereArgs: route.take(2).toList(),
        orderBy: 'position DESC,seq DESC',
        limit: 100,
      );
      pendingRows = await txn.query(
        'history_pending',
        where: 'namespace=? AND session=?',
        whereArgs: route.take(2).toList(),
      );
      if (checkpoint != null ||
          recentRows.isNotEmpty ||
          pendingRows.isNotEmpty) {
        await _touch(txn, route);
      }
    });
    final pending = await HistoryCodec.openMany(key, pendingRows);
    final decoded = <String, Map<String, dynamic>>{};
    Future<HistoryPage?> recentPage(List<Map<String, Object?>> rows) async =>
        _recentPage(
          (await _openRows(db, key, rows, decoded)).map(decodeMessage).toList(),
          pending,
        );
    if (onPreview != null) {
      final preview = await recentPage(recentRows.take(20).toList());
      if (preview != null) onPreview(preview);
    }
    HistoryPage? page;
    if (checkpoint != null) {
      if (checkpointRow!['encoding'] == 1) {
        await _migrateRow(db, key, checkpointRow!);
      }
      final values = await _openRows(db, key, pageRows, decoded);
      page = HistoryPage(
        messages: [
          for (var i = 0; i < pageRows.length; i++)
            if (pageRows[i]['deleted'] != 1) decodeMessage(values[i]),
        ],
        nextCursor: checkpoint!['next_cursor'] as String?,
        hasMore: checkpoint!['has_more'] == true,
        agents: const [],
        sessions: const [],
      );
    }
    return (page: page, recent: await recentPage(recentRows));
  }

  Future<List<RelayMessage>> withoutDeleted(
    List<int> key,
    String session,
    List<RelayMessage> messages,
  ) async {
    final latest = await _latestMessages(
      await database,
      key,
      session,
      messages.map((m) => m.id).toList(),
    );
    final visible = <RelayMessage>[];
    for (final m in messages) {
      final row = latest[_hash(key, 'message:${m.id}')];
      if (row?['deleted'] == 1) {
        await _decode(key, row!);
      } else {
        visible.add(m);
      }
    }
    return visible;
  }

  /// A preview preserves recently unfolded text but cannot establish coverage.
  Future<HistoryPage?> readRecent(List<int> key, String session) async {
    final db = await database;
    final captured = await db.transaction((txn) async {
      final route = _route(key, session, 'message', '');
      final rows = await txn.query(
        'history_log',
        where: "namespace=? AND session=? AND kind='message' AND deleted=0",
        whereArgs: route.take(2).toList(),
        orderBy: 'position DESC,seq DESC',
        limit: 100,
      );
      final pending = await txn.query(
        'history_pending',
        where: 'namespace=? AND session=?',
        whereArgs: route.take(2).toList(),
      );
      if (rows.isNotEmpty || pending.isNotEmpty) await _touch(txn, route);
      return (rows: rows, pending: pending);
    });
    return _recentPage(
      (await _openRows(db, key, captured.rows, {})).map(decodeMessage).toList(),
      await HistoryCodec.openMany(key, captured.pending),
    );
  }

  Future<HistoryPage?> _recentPage(
    List<RelayMessage> messages,
    List<Map<String, dynamic>> pending,
  ) async {
    for (final value in pending) {
      final json = Map<String, dynamic>.from(value['message'] as Map);
      final hasLargeBytes = (json['attachments'] as List? ?? []).any(
        (a) => ((a as Map)['local_bytes'] as String? ?? '').length >= 32 * 1024,
      );
      final message =
          (hasLargeBytes
                  ? await compute(_decodePendingMessage, json)
                  : decodeMessage(json))
              .copyWith(deliveryState: MessageDeliveryState.unconfirmed);
      if (!messages.any(
        (m) =>
            m.clientMessageId == message.clientMessageId &&
            m.kind != 'local.user.message' &&
            m.kind != 'local.user.action',
      )) {
        messages.removeWhere((m) => m.id == message.id);
        messages.add(message);
      }
    }
    if (messages.isEmpty) return null;
    messages.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    return HistoryPage(
      messages: messages,
      nextCursor: null,
      hasMore: true,
      agents: const [],
      sessions: const [],
    );
  }

  Future<void> markDeleted(
    List<int> key,
    String session,
    String messageId,
  ) async {
    final db = await database;
    await db.transaction(
      (txn) => _append(txn, key, session, 'message', messageId, {
        'id': messageId,
      }, deleted: true),
    );
  }

  /// Pending input is protected user data, independent of disposable body/image LRU.
  /// Exact sealed frames are stored before transport; uncertain writes never auto-replay.
  Future<void> savePending(
    List<int> key,
    String session,
    RelayMessage message,
    Map<String, dynamic> frame,
  ) async {
    final large = message.attachments.any(
      (a) =>
          (a.localBytes?.length ?? 0) + (a.thumbnailBytes?.length ?? 0) >=
          32 * 1024,
    );
    final encoded = large
        ? await compute(_encodePendingMessage, message)
        : encodeMessage(message, includeBytes: true);
    final row = await HistoryCodec.seal(
      key,
      _route(key, session, 'pending', message.clientMessageId!),
      {'message': encoded, 'frame': frame},
      false,
      0,
    );
    await (await database).insert(
      'history_pending',
      row,
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<Map<String, dynamic>>> readPending(
    List<int> key,
    String session,
  ) async => _readPending(await database, key, session);

  Future<List<RelayMessage>> readPendingMessages(
    List<int> key,
    String session,
  ) async =>
      (await _recentPage([], await readPending(key, session)))?.messages ?? [];

  Future<List<Map<String, dynamic>>> _readPending(
    DatabaseExecutor db,
    List<int> key,
    String session,
  ) async {
    final rows = await db.query(
      'history_pending',
      where: 'namespace=? AND session=?',
      whereArgs: _route(key, session, 'pending', '').take(2).toList(),
    );
    return HistoryCodec.openMany(key, rows);
  }

  Future<void> confirmPending(
    List<int> key,
    String session,
    String clientId,
  ) async {
    final db = await database;
    await db.transaction((txn) async {
      final route = _route(key, session, 'pending', clientId);
      final pending = (await txn.query(
        'history_pending',
        where: 'namespace=? AND session=? AND kind=? AND identity=?',
        whereArgs: route,
        limit: 1,
      )).firstOrNull;
      String optimisticId = 'local_$clientId';
      if (pending != null) {
        final value = await _decode(key, pending);
        optimisticId = (value['message'] as Map)['id'] as String;
      }
      final messageRoute = _route(key, session, 'message', optimisticId);
      final optimistic = await _latest(txn, messageRoute);
      if (optimistic != null && optimistic['deleted'] == 0) {
        final value = await _decode(key, optimistic);
        if (const {
              'local.user.message',
              'local.user.action',
            }.contains(value['kind']) &&
            value['client_message_id'] == clientId) {
          await txn.delete(
            'history_log',
            where: 'namespace=? AND session=? AND kind=? AND identity=?',
            whereArgs: messageRoute,
          );
        }
      }
      await txn.delete(
        'history_pending',
        where: 'namespace=? AND session=? AND kind=? AND identity=?',
        whereArgs: route,
      );
    });
  }

  static Future<void>? _maintenance;
  static Future<void>? get maintenance => _maintenance;
  Future<Set<String>>
  cachedNamespaces() async => (await (await database).rawQuery(
    'SELECT DISTINCT namespace FROM history_log UNION SELECT namespace FROM history_pending',
  )).map((row) => row['namespace'] as String).toSet();
  Future<void> maintainNamespaces(
    Set<String> candidates,
    List<List<int>> keys, {
    bool Function()? shouldContinue,
  }) {
    final task = (_maintenance ?? Future<void>.value()).catchError((_) {}).then(
      (_) async {
        final valid = {for (final key in keys) namespace(key)};
        final db = await database;
        if (shouldContinue?.call() == false) return;
        await db.transaction((txn) async {
          for (final ns in candidates.difference(valid)) {
            for (final table in [
              'history_log',
              'history_sessions',
              'history_pending',
            ]) {
              await txn.delete(table, where: 'namespace=?', whereArgs: [ns]);
            }
          }
        });
        for (final key in keys) {
          if (shouldContinue?.call() == false) return;
          if (candidates.contains(namespace(key))) {
            await _migrate(key, shouldContinue: shouldContinue);
          }
        }
        if (shouldContinue?.call() != false) {
          await db.transaction((txn) => _prune(txn));
        }
      },
    );
    final idle = task.catchError((_) {});
    _maintenance = idle;
    unawaited(
      idle.whenComplete(() {
        if (identical(_maintenance, idle)) _maintenance = null;
      }),
    );
    return task;
  }

  Future<void> removeNamespace(List<int> key) async {
    final db = await database;
    await db.transaction((txn) async {
      for (final table in [
        'history_log',
        'history_pending',
        'history_sessions',
      ]) {
        await txn.delete(
          table,
          where: 'namespace=?',
          whereArgs: [namespace(key)],
        );
      }
    });
    _migrations.remove(namespace(key));
  }

  Future<Map<String, int>> statistics() async {
    final db = await database;
    return {
      'sessions': Sqflite.firstIntValue(
        await db.rawQuery('SELECT COUNT(*) FROM history_sessions'),
      )!,
      'messages': Sqflite.firstIntValue(
        await db.rawQuery(
          "SELECT COUNT(*) FROM history_log WHERE kind='message' AND deleted=0",
        ),
      )!,
      'pending': Sqflite.firstIntValue(
        await db.rawQuery('SELECT COUNT(*) FROM history_pending'),
      )!,
      'bytes': Sqflite.firstIntValue(
        await db.rawQuery(
          'SELECT COALESCE(SUM(length(payload)),0) FROM history_log',
        ),
      )!,
      'evictions': evictedSessions,
    };
  }

  Future<void> close() async {
    unpinSession();
    final future = _database;
    _database = null;
    _migrations.clear();
    // The default connection belongs to the app, shared by all computers.
    // Closing one controller must not close another controller's cache.
    if (future != null && (_factory != null || _path != null)) {
      await (await future).close();
    }
  }

  static Map<String, dynamic> encodeMessage(
    RelayMessage m, {
    bool includeBytes = false,
  }) => {
    'id': m.id,
    'source_sequence': m.sourceSequence,
    'role': m.role,
    'content': m.content,
    'created_at': m.createdAt,
    'kind': m.kind,
    'turn_id': m.turnId,
    'message_phase': m.messagePhase,
    'turn_status': m.turnStatus,
    'client_message_id': m.clientMessageId,
    'delivery_state': m.deliveryState.name,
    'tool_activity_label': m.toolActivityLabel,
    'tool_activity_detail': m.toolActivityDetail,
    'tool_activity_status': m.toolActivityStatus,
    'tool_activity_type': m.toolActivityType,
    'tool_activity_name': m.toolActivityName,
    'tool_activity_subject': m.toolActivitySubject,
    'tool_activity_command': m.toolActivityCommand,
    'tool_activity_count': m.toolActivityCount,
    'attachments': m.attachments
        .map(
          (a) => {
            'id': a.id,
            'type': a.type,
            'name': a.name,
            'mime_type': a.mimeType,
            'url': a.url,
            'preview_supported': a.previewSupported,
            if (includeBytes && a.localBytes != null)
              'local_bytes': base64Encode(a.localBytes!),
            if (includeBytes && a.thumbnailBytes != null)
              'thumbnail_bytes': base64Encode(a.thumbnailBytes!),
          },
        )
        .toList(),
  };

  static RelayMessage decodeMessage(Map<String, dynamic> json) =>
      RelayMessage.fromHistory(json).copyWith(
        deliveryState: MessageDeliveryState.values
            .where((v) => v.name == json['delivery_state'])
            .firstOrNull,
        attachments: (json['attachments'] as List? ?? []).map((value) {
          final a = Map<String, dynamic>.from(value as Map);
          return RelayAttachment(
            id: a['id'] as String,
            type: a['type'] as String,
            name: a['name'] as String,
            mimeType: a['mime_type'] as String,
            url: a['url'] as String,
            previewSupported: a['preview_supported'] == true,
            localBytes: a['local_bytes'] == null
                ? null
                : base64Decode(a['local_bytes'] as String),
            thumbnailBytes: a['thumbnail_bytes'] == null
                ? null
                : base64Decode(a['thumbnail_bytes'] as String),
          );
        }).toList(),
      );
}

Map<String, dynamic> _encodePendingMessage(RelayMessage message) =>
    HistoryStore.encodeMessage(message, includeBytes: true);
Uint8List _decodeAttachment(String encoded) => base64Decode(encoded);

RelayMessage _decodePendingMessage(Map<String, dynamic> json) =>
    HistoryStore.decodeMessage(json);
