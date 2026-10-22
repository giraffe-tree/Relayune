import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter/foundation.dart' show compute;

import 'codec.dart';

class RelayAad {
  const RelayAad({
    required this.direction,
    required this.type,
    required this.deviceId,
    required this.sessionId,
    required this.requestId,
    required this.eventSeq,
    required this.createdAt,
    required this.expiresAt,
  });

  final String direction;
  final String type;
  final String deviceId;
  final String? sessionId;
  final String? requestId;
  final int? eventSeq;
  final String createdAt;
  final String? expiresAt;

  factory RelayAad.fromJson(Map<String, dynamic> json) => RelayAad(
    direction: json['direction'] as String,
    type: json['type'] as String,
    deviceId: json['device_id'] as String,
    sessionId: json['session_id'] as String?,
    requestId: json['request_id'] as String?,
    eventSeq: (json['event_seq'] as num?)?.toInt(),
    createdAt: json['created_at'] as String,
    expiresAt: json['expires_at'] as String?,
  );

  Map<String, dynamic> toJson() => {
    'direction': direction,
    'type': type,
    'device_id': deviceId,
    'session_id': sessionId,
    'request_id': requestId,
    'event_seq': eventSeq,
    'created_at': createdAt,
    'expires_at': expiresAt,
  };

  void validate() {
    if (!const {'web_to_relay', 'relay_to_web'}.contains(direction) ||
        type.isEmpty ||
        deviceId.isEmpty ||
        createdAt.isEmpty) {
      throw const FormatException('密文 AAD 路由字段无效。');
    }
  }
}

class SealedEnvelope {
  const SealedEnvelope({
    required this.version,
    required this.algorithm,
    required this.keyId,
    required this.iv,
    required this.aad,
    required this.ciphertext,
  });

  final int version;
  final String algorithm;
  final String keyId;
  final String iv;
  final String aad;
  final String ciphertext;

  factory SealedEnvelope.fromJson(Map<String, dynamic> json) => SealedEnvelope(
    version: (json['v'] as num).toInt(),
    algorithm: json['alg'] as String,
    keyId: json['kid'] as String,
    iv: json['iv'] as String,
    aad: json['aad'] as String,
    ciphertext: json['ciphertext'] as String,
  );

  Map<String, dynamic> toJson() => {
    'v': version,
    'alg': algorithm,
    'kid': keyId,
    'iv': iv,
    'aad': aad,
    'ciphertext': ciphertext,
  };
}

class RelayKey {
  RelayKey._(this.bytes, this.keyId);

  final Uint8List bytes;
  final String keyId;

  static RelayKey import(String encoded) {
    final raw = decodeBase64Url(encoded.trim());
    if (raw.length != 32) {
      throw const FormatException('配对密钥必须是 32 字节的 base64url 字符串。');
    }
    final digest = sha256.convert(raw).bytes;
    return RelayKey._(
      Uint8List.fromList(raw),
      'sha256:${base64UrlNoPadding(digest)}',
    );
  }

  String exportForSecureStorage() => base64UrlNoPadding(bytes);

  void dispose() => bytes.fillRange(0, bytes.length, 0);
}

class RelayCipher {
  RelayCipher({Random? random}) : _random = random ?? Random.secure();

  final Random _random;
  final AesGcm _aes = AesGcm.with256bits();

  Future<SealedEnvelope> sealJson(
    RelayKey key,
    Object? value,
    RelayAad aad,
  ) async {
    aad.validate();
    final iv = Uint8List.fromList(
      List<int>.generate(12, (_) => _random.nextInt(256)),
    );
    final aadBytes = utf8.encode(canonicalJson(aad.toJson()));
    final box = await _aes.encrypt(
      utf8.encode(jsonEncode(value)),
      secretKey: SecretKey(key.bytes),
      nonce: iv,
      aad: aadBytes,
    );
    final ciphertext = concatBytes([box.cipherText, box.mac.bytes]);
    return SealedEnvelope(
      version: 2,
      algorithm: 'A256GCM',
      keyId: key.keyId,
      iv: base64UrlNoPadding(iv),
      aad: base64UrlNoPadding(aadBytes),
      ciphertext: base64UrlNoPadding(ciphertext),
    );
  }

  Future<T> openJson<T>(
    RelayKey key,
    SealedEnvelope envelope,
    RelayAad expectedAad,
  ) async {
    // Large startup catalogs / history must not decode base64, decrypt and
    // parse JSON on the animation's UI isolate. Small live deltas avoid the
    // isolate startup cost. The worker retains all existing AAD / GCM checks.
    if (envelope.ciphertext.length >= 44 * 1024) {
      final bytes = Uint8List.fromList(key.bytes);
      try {
        return await compute(_openRelayJson, (
              bytes,
              key.keyId,
              envelope,
              expectedAad,
            ), debugLabel: 'relay-decrypt-json')
            as T;
      } finally {
        bytes.fillRange(0, bytes.length, 0);
      }
    }
    return _openJsonInline<T>(key, envelope, expectedAad);
  }

  Future<T> _openJsonInline<T>(
    RelayKey key,
    SealedEnvelope envelope,
    RelayAad expectedAad,
  ) async {
    final packed = _validateEnvelope(envelope);
    expectedAad.validate();
    final expected = canonicalJson(expectedAad.toJson());
    final actual = utf8.decode(decodeBase64Url(envelope.aad));
    if (actual != expected) {
      throw const FormatException('密文路由信息与当前请求不匹配。');
    }
    if (envelope.keyId != key.keyId) {
      throw const FormatException('密文使用了另一个配对密钥。');
    }
    final macOffset = packed.length - 16;
    try {
      final cleartext = await _aes.decrypt(
        SecretBox(
          packed.sublist(0, macOffset),
          nonce: decodeBase64Url(envelope.iv),
          mac: Mac(packed.sublist(macOffset)),
        ),
        secretKey: SecretKey(key.bytes),
        aad: utf8.encode(expected),
      );
      return jsonDecode(utf8.decode(cleartext)) as T;
    } on SecretBoxAuthenticationError {
      throw const FormatException('密文校验失败；内容或路由信息可能已被篡改。');
    }
  }

  Uint8List _validateEnvelope(SealedEnvelope envelope) {
    if (envelope.version != 2 || envelope.algorithm != 'A256GCM') {
      throw const FormatException('不支持的端到端加密协议版本。');
    }
    final packed = decodeBase64Url(envelope.ciphertext);
    if (!RegExp(r'^sha256:[A-Za-z0-9_-]{43}$').hasMatch(envelope.keyId) ||
        decodeBase64Url(envelope.iv).length != 12 ||
        packed.length < 17) {
      throw const FormatException('密文 envelope 无效。');
    }
    decodeBase64Url(envelope.aad);
    return packed;
  }
}

Future<Object?> _openRelayJson(
  (Uint8List, String, SealedEnvelope, RelayAad) input,
) async {
  final key = RelayKey._(input.$1, input.$2);
  try {
    return await RelayCipher()._openJsonInline<Object?>(
      key,
      input.$3,
      input.$4,
    );
  } finally {
    key.dispose();
  }
}
