import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/storage/image_cache_store.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  sqfliteFfiInit();
  late Directory directory;
  late ImageCacheStore store;
  final key = List<int>.generate(32, (i) => i);
  final otherKey = List<int>.filled(32, 99);
  final preview = Uint8List.fromList('private image preview'.codeUnits);
  final original = Uint8List.fromList('private full image'.codeUnits);
  const small = RelayAttachmentVariant.preview;
  const full = RelayAttachmentVariant.original;

  setUp(() async {
    directory = await Directory.systemTemp.createTemp('relayune-image-cache-');
    store = ImageCacheStore(
      factory: databaseFactoryFfi,
      path: '${directory.path}/images.sqlite',
    );
  });
  tearDown(() async {
    await store.close();
    await directory.delete(recursive: true);
  });

  test(
    'encrypted previews and originals survive reopening as one image',
    () async {
      await store.put(
        key,
        'private-session',
        'private-attachment',
        small,
        preview,
      );
      await store.put(
        key,
        'private-session',
        'private-attachment',
        full,
        original,
      );
      final rows = await (await store.database).query('image_cache');
      expect(rows, hasLength(1));
      expect(rows.single.toString(), isNot(contains('private-session')));
      expect(rows.single.toString(), isNot(contains('private-attachment')));
      for (final variant in [small, full]) {
        expect(
          String.fromCharCodes(rows.single[variant.name] as Uint8List),
          isNot(contains('private')),
        );
      }
      await store.close();
      store = ImageCacheStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/images.sqlite',
      );
      expect(
        await store.read(key, 'private-session', 'private-attachment', small),
        preview,
      );
      expect(
        await store.read(key, 'private-session', 'private-attachment', full),
        original,
      );
      expect(
        await store.read(
          otherKey,
          'private-session',
          'private-attachment',
          small,
        ),
        isNull,
      );
      expect(
        await store.read(key, 'other-session', 'private-attachment', small),
        isNull,
      );
    },
  );

  test(
    'large images round-trip and corrupted background decrypt falls back',
    () async {
      final bytes = Uint8List.fromList(
        List.generate(300 * 1024, (i) => i % 256),
      );
      await store.put(key, 'session', 'large', full, bytes);
      expect(await store.read(key, 'session', 'large', full), bytes);
      final db = await store.database;
      final sealed = Uint8List.fromList(
        (await db.query('image_cache')).single['original'] as Uint8List,
      );
      sealed[sealed.length - 1] ^= 1;
      await db.update('image_cache', {'original': sealed});
      expect(await store.read(key, 'session', 'large', full), isNull);
      expect(await db.query('image_cache'), isEmpty);
    },
  );

  test(
    '500-image limit is global and recent reads protect images from eviction',
    () async {
      for (var i = 0; i < 500; i++) {
        await store.put(
          i.isEven ? key : otherKey,
          'session',
          'image-$i',
          small,
          preview,
        );
      }
      await store.put(key, 'session', 'image-0', full, original);
      await store.read(otherKey, 'session', 'image-1', small);
      await store.put(key, 'session', 'image-500', small, preview);
      expect(await store.read(key, 'session', 'image-2', small), isNull);
      expect(await store.read(key, 'session', 'image-0', full), original);
      expect(await store.read(otherKey, 'session', 'image-1', small), preview);
      expect(
        (await (await store.database).query('image_cache')),
        hasLength(500),
      );
    },
  );

  test(
    'byte budget evicts the oldest complete image including both variants',
    () async {
      await store.close();
      store = ImageCacheStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/images.sqlite',
        maxBytes: 120,
      );
      final bytes = Uint8List(20); // Each encrypted variant occupies 48 bytes.
      await store.put(key, 'session', 'older', small, bytes);
      await store.put(key, 'session', 'newer', small, bytes);
      await store.put(key, 'session', 'newer', full, bytes);
      expect(await store.read(key, 'session', 'older', small), isNull);
      expect(await store.read(key, 'session', 'newer', small), bytes);
      expect(await store.read(key, 'session', 'newer', full), bytes);
      await store.put(key, 'session', 'oversized', small, Uint8List(121));
      expect((await (await store.database).query('image_cache')), hasLength(1));
    },
  );

  test(
    'authenticated cache rejects corruption and swapping variants',
    () async {
      await store.put(key, 'session', 'image', small, preview);
      final db = await store.database;
      final sealed = Uint8List.fromList(
        (await db.query('image_cache')).single['preview'] as Uint8List,
      );
      await db.update('image_cache', {'original': sealed});
      expect(await store.read(key, 'session', 'image', full), isNull);
      expect(await db.query('image_cache'), isEmpty);
      await store.put(key, 'session', 'image', small, preview);
      sealed[sealed.length - 1] ^= 1;
      await db.update('image_cache', {'preview': sealed});
      expect(await store.read(key, 'session', 'image', small), isNull);
      expect(await db.query('image_cache'), isEmpty);
      await store.put(key, 'session', 'image', small, preview);
      await db.update('image_cache', {'preview': Uint8List(1)});
      expect(await store.read(key, 'session', 'image', small), isNull);
    },
  );

  test(
    'namespace cleanup works before opening the database after restart',
    () async {
      await store.put(key, 'session', 'image', small, preview);
      await store.put(otherKey, 'session', 'image', small, original);
      await store.close();
      store = ImageCacheStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/images.sqlite',
      );
      await store.removeNamespace(key);
      expect(await store.read(key, 'session', 'image', small), isNull);
      expect(await store.read(otherKey, 'session', 'image', small), original);
    },
  );

  test(
    'concurrent writes cannot exceed capacity or lose the other variant',
    () async {
      await store.close();
      store = ImageCacheStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/images.sqlite',
        maxImages: 3,
      );
      await Future.wait([
        for (var i = 0; i < 20; i++)
          store.put(key, 'session', 'image-$i', small, preview),
      ]);
      expect((await (await store.database).query('image_cache')), hasLength(3));
      await Future.wait([
        store.put(key, 'session', 'shared', small, preview),
        store.put(key, 'session', 'shared', full, original),
      ]);
      expect(await store.read(key, 'session', 'shared', small), preview);
      expect(await store.read(key, 'session', 'shared', full), original);
      expect((await (await store.database).query('image_cache')), hasLength(3));
    },
  );
}
