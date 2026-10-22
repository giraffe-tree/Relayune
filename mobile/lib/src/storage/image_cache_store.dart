import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as hashes;
import 'package:cryptography/cryptography.dart';
import 'package:flutter/foundation.dart' show compute;
import 'package:sqflite/sqflite.dart';

import '../models.dart';

/// Disposable encrypted image cache, separate from message checkpoints.
/// One shared database bounds all accounts/computers to 500 logical images.
class ImageCacheStore {
  ImageCacheStore({
    DatabaseFactory? factory,
    String? path,
    this.maxImages = 500,
    this.maxBytes = 256 * 1024 * 1024,
  }) : _factory = factory,
       _path = path;

  static final shared = ImageCacheStore();
  final int maxImages, maxBytes;
  final DatabaseFactory? _factory;
  final String? _path;
  Future<Database>? _database;

  // Keep large-image encryption/decryption and buffer packing off the UI isolate.
  static const _backgroundThreshold = 256 * 1024;

  Future<Database> get database =>
      _database ??= _open().catchError((Object error) {
        _database = null;
        throw error;
      });
  Future<Database> _open() async {
    final factory = _factory ?? databaseFactory;
    return factory.openDatabase(
      _path ?? '${await factory.getDatabasesPath()}/image-cache-v1.sqlite',
      options: OpenDatabaseOptions(
        version: 1,
        singleInstance: false,
        onCreate: (db, _) async {
          await db.execute('''CREATE TABLE image_cache (
            namespace TEXT NOT NULL, identity TEXT NOT NULL,
            accessed INTEGER NOT NULL, preview BLOB, original BLOB,
            PRIMARY KEY (namespace, identity))''');
          await db.execute(
            'CREATE INDEX image_cache_lru ON image_cache(accessed)',
          );
        },
      ),
    );
  }

  String _hash(List<int> key, String text) =>
      hashes.Hmac(hashes.sha256, key).convert(utf8.encode(text)).toString();
  String namespace(List<int> key) => _hash(key, 'image-cache-v1');
  List<String> _legacyRoute(List<int> key, String session, String attachment) =>
      [
        namespace(key),
        _hash(key, jsonEncode(['image-cache-v1', session, attachment])),
      ];
  List<String> _route(List<int> key, String session, String attachment) =>
      _hashedRoute(key, _hash(key, 'session:$session'), attachment);
  List<String> _hashedRoute(
    List<int> key,
    String sessionHash,
    String attachment,
  ) => [
    namespace(key),
    _hash(key, jsonEncode(['image-cache-v2', sessionHash, attachment])),
  ];
  List<int> _aad(List<String> route, RelayAttachmentVariant variant) =>
      utf8.encode(jsonEncode(['image-cache-v1', ...route, variant.name]));

  Future<int> _nextAccess(DatabaseExecutor db) async => (Sqflite.firstIntValue(
    await db.rawQuery('SELECT COALESCE(MAX(accessed), 0) + 1 FROM image_cache'),
  ))!;

  Future<Uint8List?> read(
    List<int> key,
    String session,
    String attachment,
    RelayAttachmentVariant variant,
  ) async {
    final db = await database;
    var route = _route(key, session, attachment);
    var rows = await db.query(
      'image_cache',
      columns: [variant.name],
      where: 'namespace=? AND identity=?',
      whereArgs: route,
      limit: 1,
    );
    if (rows.firstOrNull?[variant.name] == null) {
      route = _legacyRoute(key, session, attachment);
      rows = await db.query(
        'image_cache',
        columns: [variant.name],
        where: 'namespace=? AND identity=?',
        whereArgs: route,
        limit: 1,
      );
    }
    final sealed = rows.firstOrNull?[variant.name] as Uint8List?;
    if (sealed == null) return null;
    try {
      final input = (key, sealed, _aad(route, variant));
      final bytes = await (sealed.length >= _backgroundThreshold
          ? compute(_openImage, input)
          : _openImage(input));
      await touch(key, session, attachment);
      return bytes;
    } on SecretBoxAuthenticationError {
      await db.delete(
        'image_cache',
        where: 'namespace=? AND identity=?',
        whereArgs: route,
      );
      return null;
    } on FormatException {
      await db.delete(
        'image_cache',
        where: 'namespace=? AND identity=?',
        whereArgs: route,
      );
      return null;
    }
  }

  Future<void> touch(List<int> key, String session, String attachment) async {
    final db = await database;
    await db.transaction((txn) async {
      await txn.update(
        'image_cache',
        {'accessed': await _nextAccess(txn)},
        where: 'namespace=? AND identity IN (?,?)',
        whereArgs: [
          namespace(key),
          _route(key, session, attachment)[1],
          _legacyRoute(key, session, attachment)[1],
        ],
      );
    });
  }

  Future<void> put(
    List<int> key,
    String session,
    String attachment,
    RelayAttachmentVariant variant,
    Uint8List bytes,
  ) async {
    await _putRoute(key, _route(key, session, attachment), variant, bytes);
  }

  Future<void> putForSessionHash(
    List<int> key,
    String sessionHash,
    String attachment,
    RelayAttachmentVariant variant,
    Uint8List bytes,
  ) => _putRoute(
    key,
    _hashedRoute(key, sessionHash, attachment),
    variant,
    bytes,
  );

  Future<void> _putRoute(
    List<int> key,
    List<String> route,
    RelayAttachmentVariant variant,
    Uint8List bytes,
  ) async {
    if (bytes.isEmpty || bytes.length + 28 > maxBytes) return;
    final input = (key, bytes, _aad(route, variant));
    final sealed = await (bytes.length >= _backgroundThreshold
        ? compute(_sealImage, input)
        : _sealImage(input));
    final db = await database;
    await db.transaction((txn) async {
      await txn.rawInsert(
        '''INSERT INTO image_cache(namespace, identity, accessed, ${variant.name})
        VALUES (?, ?, ?, ?) ON CONFLICT(namespace, identity) DO UPDATE SET
        accessed=excluded.accessed, ${variant.name}=excluded.${variant.name}''',
        [...route, await _nextAccess(txn), sealed],
      );
      final rows = await txn.rawQuery('''SELECT namespace, identity,
        COALESCE(length(preview), 0) + COALESCE(length(original), 0) AS bytes
        FROM image_cache ORDER BY accessed ASC''');
      var retainedBytes = rows.fold<int>(
        0,
        (sum, row) => sum + (row['bytes'] as int),
      );
      var retainedImages = rows.length;
      for (final row in rows) {
        if (retainedImages <= maxImages && retainedBytes <= maxBytes) break;
        await txn.delete(
          'image_cache',
          where: 'namespace=? AND identity=?',
          whereArgs: [row['namespace'], row['identity']],
        );
        retainedImages--;
        retainedBytes -= row['bytes'] as int;
      }
    });
  }

  Future<Set<String>> cachedNamespaces() async =>
      (await (await database).rawQuery(
        'SELECT DISTINCT namespace FROM image_cache',
      )).map((row) => row['namespace'] as String).toSet();
  Future<void> removeOrphanNamespaces(
    Set<String> candidates,
    List<List<int>> keys,
  ) async {
    final valid = {for (final key in keys) namespace(key)};
    final db = await database;
    await db.transaction((txn) async {
      for (final ns in candidates.difference(valid)) {
        await txn.delete('image_cache', where: 'namespace=?', whereArgs: [ns]);
      }
    });
  }

  Future<void> removeNamespace(List<int> key) async {
    final db = await database;
    await db.delete(
      'image_cache',
      where: 'namespace=?',
      whereArgs: [namespace(key)],
    );
  }

  Future<void> close() async {
    final pending = _database;
    _database = null;
    if (pending != null) await (await pending).close();
  }
}

typedef _ImageCipherInput = (List<int>, Uint8List, List<int>);

Future<Uint8List> _sealImage(_ImageCipherInput input) async {
  final key = List<int>.of(input.$1);
  try {
    final random = Random.secure();
    final box = await AesGcm.with256bits().encrypt(
      input.$2,
      secretKey: SecretKey(key),
      nonce: List.generate(12, (_) => random.nextInt(256)),
      aad: input.$3,
    );
    return Uint8List(28 + box.cipherText.length)
      ..setRange(0, 12, box.nonce)
      ..setRange(12, 28, box.mac.bytes)
      ..setRange(28, 28 + box.cipherText.length, box.cipherText);
  } finally {
    key.fillRange(0, key.length, 0);
  }
}

Future<Uint8List> _openImage(_ImageCipherInput input) async {
  final sealed = input.$2;
  if (sealed.length < 28) throw const FormatException('Invalid image cache');
  final key = List<int>.of(input.$1);
  try {
    final bytes = await AesGcm.with256bits().decrypt(
      SecretBox(
        Uint8List.sublistView(sealed, 28),
        nonce: Uint8List.sublistView(sealed, 0, 12),
        mac: Mac(Uint8List.sublistView(sealed, 12, 28)),
      ),
      secretKey: SecretKey(key),
      aad: input.$3,
    );
    return bytes is Uint8List ? bytes : Uint8List.fromList(bytes);
  } finally {
    key.fillRange(0, key.length, 0);
  }
}
