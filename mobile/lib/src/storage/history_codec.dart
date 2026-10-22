import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as hashes;
import 'package:cryptography/cryptography.dart';
import 'package:flutter/foundation.dart' show compute;

/// Large JSON, digests, encryption and buffer packing run outside the UI isolate.
class HistoryCodec {
  static Future<Map<String, Object?>> seal(
    List<int> key,
    List<Object?> route,
    Map<String, dynamic> value,
    bool deleted,
    int source,
  ) {
    final input = (key, route, value, deleted, source);
    return _size(value) >= 32 * 1024 ? compute(_seal, input) : _seal(input);
  }

  static Future<Map<String, dynamic>> open(
    List<int> key,
    Map<String, Object?> row,
  ) {
    final input = (key, row);
    return (row['payload'] as Uint8List).length >= 32 * 1024
        ? compute(_open, input)
        : _open(input);
  }

  /// One bounded page per isolate, including batches of individually small rows.
  /// Spawning an isolate for every large message dominates cache restoration.
  static Future<List<Map<String, dynamic>>> openMany(
    List<int> key,
    List<Map<String, Object?>> rows,
  ) {
    final input = (key, rows);
    final bytes = rows.fold<int>(
      0,
      (sum, row) => sum + (row['payload'] as Uint8List).length,
    );
    return bytes >= 32 * 1024 ? compute(_openMany, input) : _openMany(input);
  }

  static Future<List<Map<String, Object?>>> sealMany(
    List<int> key,
    List<(List<Object?>, Map<String, dynamic>, bool, int)> rows,
  ) {
    final input = (key, rows);
    final bytes = rows.fold<int>(0, (sum, row) => sum + _size(row.$2));
    return bytes >= 32 * 1024 ? compute(_sealMany, input) : _sealMany(input);
  }

  static int _size(Object? value) {
    if (value is String) return value.length;
    if (value is List) return value.fold(0, (sum, item) => sum + _size(item));
    if (value is Map) {
      return value.values.fold(0, (sum, item) => sum + _size(item));
    }
    return 8;
  }
}

Future<List<Map<String, dynamic>>> _openMany(
  (List<int>, List<Map<String, Object?>>) input,
) async {
  final result = <Map<String, dynamic>>[];
  for (final row in input.$2) {
    result.add(await _open((input.$1, row)));
  }
  return result;
}

Future<Map<String, Object?>> _seal(
  (List<int>, List<Object?>, Map<String, dynamic>, bool, int) input,
) async {
  final key = List<int>.of(input.$1);
  try {
    final text = jsonEncode(input.$3);
    final digest = hashes.Hmac(
      hashes.sha256,
      key,
    ).convert(utf8.encode(text)).toString();
    final position = input.$3['created_at'] as String? ?? '';
    final aad = utf8.encode(
      jsonEncode([...input.$2, input.$4 ? 1 : 0, digest, position, input.$5]),
    );
    final random = Random.secure();
    final box = await AesGcm.with256bits().encrypt(
      utf8.encode(text),
      secretKey: SecretKey(key),
      nonce: List.generate(12, (_) => random.nextInt(256)),
      aad: aad,
    );
    return {
      'namespace': input.$2[0],
      'session': input.$2[1],
      'kind': input.$2[2],
      'identity': input.$2[3],
      'deleted': input.$4 ? 1 : 0,
      'position': position,
      'digest': digest,
      'source': input.$5,
      'encoding': 2,
      'payload': Uint8List(28 + box.cipherText.length)
        ..setRange(0, 12, box.nonce)
        ..setRange(12, 28, box.mac.bytes)
        ..setRange(28, 28 + box.cipherText.length, box.cipherText),
    };
  } finally {
    key.fillRange(0, key.length, 0);
  }
}

Future<Map<String, dynamic>> _open(
  (List<int>, Map<String, Object?>) input,
) async {
  final key = List<int>.of(input.$1);
  try {
    final row = input.$2;
    final bytes = row['payload'] as Uint8List;
    if (bytes.length < 28) throw const FormatException('Invalid history cache');
    final aad = utf8.encode(
      jsonEncode([
        row['namespace'],
        row['session'],
        row['kind'],
        row['identity'],
        row['deleted'],
        row['digest'],
        row['position'],
        if (row['encoding'] == 2) row['source'],
      ]),
    );
    final plain = await AesGcm.with256bits().decrypt(
      SecretBox(
        Uint8List.sublistView(bytes, 28),
        nonce: Uint8List.sublistView(bytes, 0, 12),
        mac: Mac(Uint8List.sublistView(bytes, 12, 28)),
      ),
      secretKey: SecretKey(key),
      aad: aad,
    );
    return Map<String, dynamic>.from(jsonDecode(utf8.decode(plain)) as Map);
  } finally {
    key.fillRange(0, key.length, 0);
  }
}

Future<List<Map<String, Object?>>> _sealMany(
  (List<int>, List<(List<Object?>, Map<String, dynamic>, bool, int)>) input,
) async {
  final result = <Map<String, Object?>>[];
  for (final row in input.$2) {
    result.add(await _seal((input.$1, row.$1, row.$2, row.$3, row.$4)));
  }
  return result;
}
