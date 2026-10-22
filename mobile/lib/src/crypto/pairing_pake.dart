import 'dart:convert';
import 'dart:isolate';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:pointycastle/export.dart' show Scrypt, ScryptParameters;

import 'codec.dart';
import 'spake2_p256.dart';

const pairingProtocol = 'SPAKE2-P256-SHA256-HKDF-HMAC';
final pairingIdPattern = RegExp(r'^pair_[A-Za-z0-9_-]{43}$');
final _pairingCodePattern = RegExp(r'^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$');
final _sharePattern = RegExp(r'^[A-Za-z0-9_-]{87}$');
final _pakeAad = Uint8List.fromList(utf8.encode(pairingProtocol));
final _contentKeyInfo = Uint8List.fromList(
  utf8.encode('relayune/a256gcm-content-key/v2'),
);

class PairingResult {
  PairingResult({
    required this.responderShare,
    required this.responderConfirm,
    required this.expectedDesktopConfirm,
    required this.contentKey,
  });

  final String responderShare;
  final String responderConfirm;
  final String expectedDesktopConfirm;
  final String contentKey;
}

class PairingPake {
  PairingPake({Random? random}) : _random = random ?? Random.secure();

  final Random _random;

  Future<PairingResult> respond({
    required String pairingId,
    required String code,
    required String initiatorShare,
  }) async {
    final scalarBytes = _sampleScalarBytes();
    try {
      return await Isolate.run(
        () => respondWithScalar(
          pairingId: pairingId,
          code: code,
          initiatorShare: initiatorShare,
          scalarBytes: scalarBytes,
        ),
      );
    } finally {
      scalarBytes.fillRange(0, scalarBytes.length, 0);
    }
  }

  PairingResult respondWithScalar({
    required String pairingId,
    required String code,
    required String initiatorShare,
    required Uint8List scalarBytes,
  }) {
    if (!pairingIdPattern.hasMatch(pairingId)) {
      throw const FormatException('安全连接会话无效，请在桌面端重新开始。');
    }
    if (!_sharePattern.hasMatch(initiatorShare)) {
      throw const FormatException('桌面端公开 share 无效。');
    }
    _requireValidScalar(scalarBytes);
    final initiatorBytes = decodeBase64Url(initiatorShare);
    final passwordScalar = _derivePasswordScalar(pairingId, code);
    Uint8List? sessionKey;
    Uint8List? responderBytes;
    Spake2P256Output? output;
    try {
      responderBytes = Spake2P256.createShare(
        role: Spake2Role.partyB,
        passwordScalar: passwordScalar,
        ephemeralScalar: scalarBytes,
      );
      output = Spake2P256.finish(
        role: Spake2Role.partyB,
        passwordScalar: passwordScalar,
        ephemeralScalar: scalarBytes,
        ownShare: responderBytes,
        peerShare: initiatorBytes,
        identityA: Uint8List.fromList(
          utf8.encode('relayune/desktop\u0000$pairingId'),
        ),
        identityB: Uint8List.fromList(
          utf8.encode('relayune/client\u0000$pairingId'),
        ),
        aad: _pakeAad,
      );
      sessionKey = output.sessionKey;
      final contentKey = Spake2P256.deriveApplicationKey(
        sessionKey: sessionKey,
        info: _contentKeyInfo,
      );
      try {
        return PairingResult(
          responderShare: base64UrlNoPadding(responderBytes),
          responderConfirm: base64UrlNoPadding(output.ownConfirmation),
          expectedDesktopConfirm: base64UrlNoPadding(
            output.expectedPeerConfirmation,
          ),
          contentKey: base64UrlNoPadding(contentKey),
        );
      } finally {
        contentKey.fillRange(0, contentKey.length, 0);
      }
    } finally {
      initiatorBytes.fillRange(0, initiatorBytes.length, 0);
      passwordScalar.fillRange(0, passwordScalar.length, 0);
      responderBytes?.fillRange(0, responderBytes.length, 0);
      sessionKey?.fillRange(0, sessionKey.length, 0);
      output?.ownConfirmation.fillRange(
        0,
        output.ownConfirmation.length,
        0,
      );
      output?.expectedPeerConfirmation.fillRange(
        0,
        output.expectedPeerConfirmation.length,
        0,
      );
      output?.transcript.fillRange(0, output.transcript.length, 0);
    }
  }

  Uint8List _sampleScalarBytes() {
    for (var attempts = 0; attempts < 128; attempts++) {
      final bytes = Uint8List.fromList(
        List<int>.generate(32, (_) => _random.nextInt(256)),
      );
      final scalar = _bytesToBigInt(bytes);
      if (scalar > BigInt.zero && scalar < p256Order) return bytes;
      bytes.fillRange(0, bytes.length, 0);
    }
    throw StateError('无法生成有效的 P-256 随机标量。');
  }
}

String normalizePairingCode(String value) {
  final normalized = value.toUpperCase().replaceAll(RegExp(r'[\s-]'), '');
  if (!_pairingCodePattern.hasMatch(normalized)) {
    throw const FormatException('请输入桌面端显示的 8 位连接码。');
  }
  return normalized;
}

String pairingCodeInput(String value) {
  final filtered = value.toUpperCase().replaceAll(RegExp(r'[^A-Z2-9]'), '');
  final normalized = filtered.substring(0, min(8, filtered.length));
  return normalized.length > 4
      ? '${normalized.substring(0, 4)}-${normalized.substring(4)}'
      : normalized;
}

String randomRelayToken([Random? source]) {
  final random = source ?? Random.secure();
  return base64UrlNoPadding(List<int>.generate(32, (_) => random.nextInt(256)));
}

String sha256Hex(String value) => sha256
    .convert(utf8.encode(value))
    .bytes
    .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
    .join();

Uint8List _derivePasswordScalar(String pairingId, String code) {
  final normalizedCode = normalizePairingCode(code);
  final password = Uint8List.fromList(utf8.encode(normalizedCode));
  final salt = Uint8List.fromList(
    utf8.encode('relayune/spake2-p256/scrypt/v1\u0000$pairingId'),
  );
  final stretched = Uint8List(40);
  final scrypt = Scrypt()
    ..init(ScryptParameters(1 << 15, 8, 1, stretched.length, salt));
  try {
    scrypt.deriveKey(password, 0, stretched, 0);
    final scalar = _bytesToBigInt(stretched) % p256Order;
    if (scalar == BigInt.zero) {
      throw const FormatException('SPAKE2 口令标量不能为零。');
    }
    return _bigIntToBytes(scalar, 32);
  } finally {
    password.fillRange(0, password.length, 0);
    salt.fillRange(0, salt.length, 0);
    stretched.fillRange(0, stretched.length, 0);
  }
}

void _requireValidScalar(Uint8List bytes) {
  if (bytes.length != 32) {
    throw const FormatException('SPAKE2 ephemeral scalar 必须是 32 字节。');
  }
  final scalar = _bytesToBigInt(bytes);
  if (scalar <= BigInt.zero || scalar >= p256Order) {
    throw const FormatException('SPAKE2 ephemeral scalar 超出 P-256 范围。');
  }
}

BigInt _bytesToBigInt(List<int> bytes) {
  var result = BigInt.zero;
  for (final byte in bytes) {
    result = (result << 8) | BigInt.from(byte);
  }
  return result;
}

Uint8List _bigIntToBytes(BigInt value, int length) {
  final result = Uint8List(length);
  var remaining = value;
  for (var index = length - 1; index >= 0; index--) {
    result[index] = (remaining & BigInt.from(0xff)).toInt();
    remaining >>= 8;
  }
  if (remaining != BigInt.zero) {
    throw const FormatException('整数无法编码到指定长度。');
  }
  return result;
}
