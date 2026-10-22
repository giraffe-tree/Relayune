import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:elliptic/elliptic.dart';

import 'codec.dart';

final p256Order = BigInt.parse(
  'ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551',
  radix: 16,
);

final _curve = getP256();
final _rfc9382M = PublicKey.fromHex(
  _curve,
  '02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f',
);
final _rfc9382N = PublicKey.fromHex(
  _curve,
  '03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49',
);
final _confirmationLabel = Uint8List.fromList(
  utf8.encode('ConfirmationKeys'),
);

enum Spake2Role { partyA, partyB }

class Spake2P256Output {
  Spake2P256Output({
    required this.sessionKey,
    required this.ownConfirmation,
    required this.expectedPeerConfirmation,
    required this.transcript,
  });

  final Uint8List sessionKey;
  final Uint8List ownConfirmation;
  final Uint8List expectedPeerConfirmation;
  final Uint8List transcript;
}

class Spake2P256 {
  static Uint8List createShare({
    required Spake2Role role,
    required Uint8List passwordScalar,
    required Uint8List ephemeralScalar,
  }) {
    final w = _requireScalar(passwordScalar, 'password scalar');
    _requireScalar(ephemeralScalar, 'ephemeral scalar');
    final mask = role == Spake2Role.partyA ? _rfc9382M : _rfc9382N;
    final ephemeralPoint = _curve.scalarBaseMul(ephemeralScalar);
    final passwordPoint = _curve.scalarMul(mask, _bigIntToBytes(w, 32));
    final share = _curve.add(ephemeralPoint, passwordPoint);
    if (_isIdentity(share) || !_curve.isOnCurve(share)) {
      throw const FormatException('SPAKE2 公开 share 不能是单位元。');
    }
    return _encodePoint(share);
  }

  static Spake2P256Output finish({
    required Spake2Role role,
    required Uint8List passwordScalar,
    required Uint8List ephemeralScalar,
    required Uint8List ownShare,
    required Uint8List peerShare,
    required Uint8List identityA,
    required Uint8List identityB,
    Uint8List? aad,
  }) {
    final w = _requireScalar(passwordScalar, 'password scalar');
    _requireScalar(ephemeralScalar, 'ephemeral scalar');
    final ownPoint = _decodePoint(ownShare);
    final peerPoint = _decodePoint(peerShare);
    final expectedOwnShare = createShare(
      role: role,
      passwordScalar: passwordScalar,
      ephemeralScalar: ephemeralScalar,
    );
    if (!constantTimeEquals(expectedOwnShare, ownShare)) {
      throw const FormatException('SPAKE2 本地状态与公开 share 不一致。');
    }

    final peerMask = role == Spake2Role.partyA ? _rfc9382N : _rfc9382M;
    final passwordPoint = _curve.scalarMul(
      peerMask,
      _bigIntToBytes(w, 32),
    );
    final unmaskedPeer = _curve.add(
      peerPoint,
      AffinePoint.fromXY(
        passwordPoint.X,
        (_curve.p - passwordPoint.Y) % _curve.p,
      ),
    );
    final sharedPoint = _curve.scalarMul(unmaskedPeer, ephemeralScalar);
    if (_isIdentity(sharedPoint) || !_curve.isOnCurve(sharedPoint)) {
      throw const FormatException('SPAKE2 共享点不能是单位元。');
    }

    final pA = role == Spake2Role.partyA ? ownPoint : peerPoint;
    final pB = role == Spake2Role.partyB ? ownPoint : peerPoint;
    final transcript = concatBytes([
      _lengthValue(identityA),
      _lengthValue(identityB),
      _lengthValue(_encodePoint(pA)),
      _lengthValue(_encodePoint(pB)),
      _lengthValue(_encodePoint(sharedPoint)),
      _lengthValue(passwordScalar),
    ]);
    final transcriptHash = Uint8List.fromList(
      sha256.convert(transcript).bytes,
    );
    final sessionKey = Uint8List.fromList(transcriptHash.sublist(0, 16));
    final authenticationKey = Uint8List.fromList(
      transcriptHash.sublist(16, 32),
    );
    final confirmationKeys = _hkdfSha256(
      inputKeyMaterial: authenticationKey,
      salt: Uint8List(0),
      info: concatBytes([_confirmationLabel, aad ?? Uint8List(0)]),
      length: 32,
    );
    final confirmationA = Uint8List.fromList(
      Hmac(
        sha256,
        confirmationKeys.sublist(0, 16),
      ).convert(transcript).bytes,
    );
    final confirmationB = Uint8List.fromList(
      Hmac(
        sha256,
        confirmationKeys.sublist(16, 32),
      ).convert(transcript).bytes,
    );
    try {
      return Spake2P256Output(
        sessionKey: sessionKey,
        ownConfirmation: role == Spake2Role.partyA
            ? confirmationA
            : confirmationB,
        expectedPeerConfirmation: role == Spake2Role.partyA
            ? confirmationB
            : confirmationA,
        transcript: transcript,
      );
    } finally {
      expectedOwnShare.fillRange(0, expectedOwnShare.length, 0);
      authenticationKey.fillRange(0, authenticationKey.length, 0);
      confirmationKeys.fillRange(0, confirmationKeys.length, 0);
      transcriptHash.fillRange(0, transcriptHash.length, 0);
    }
  }

  static Uint8List deriveApplicationKey({
    required Uint8List sessionKey,
    required Uint8List info,
    int length = 32,
  }) {
    if (sessionKey.length != 16) {
      throw const FormatException('SPAKE2 会话密钥长度无效。');
    }
    return _hkdfSha256(
      inputKeyMaterial: sessionKey,
      salt: Uint8List(0),
      info: info,
      length: length,
    );
  }
}

BigInt _requireScalar(Uint8List bytes, String label) {
  if (bytes.length != 32) {
    throw FormatException('SPAKE2 $label 必须是 32 字节。');
  }
  final scalar = _bytesToBigInt(bytes);
  if (scalar <= BigInt.zero || scalar >= p256Order) {
    throw FormatException('SPAKE2 $label 超出 P-256 标量范围。');
  }
  return scalar;
}

PublicKey _decodePoint(Uint8List encoded) {
  if (encoded.length != 65 || encoded.first != 0x04) {
    throw const FormatException(
      'SPAKE2 P-256 share 必须使用 65 字节 SEC1 非压缩编码。',
    );
  }
  try {
    final point = PublicKey.fromHex(_curve, _bytesToHex(encoded));
    if (_isIdentity(point) || !_curve.isOnCurve(point)) {
      throw const FormatException('identity point');
    }
    return point;
  } catch (_) {
    throw const FormatException('SPAKE2 P-256 share 不是有效曲线点。');
  }
}

Uint8List _encodePoint(AffinePoint point) => _hexToBytes(
  PublicKey.fromPoint(_curve, point).toHex(),
);

bool _isIdentity(AffinePoint point) =>
    point.X == BigInt.zero && point.Y == BigInt.zero;

Uint8List _lengthValue(Uint8List value) {
  final length = Uint8List(8);
  var remaining = value.length;
  for (var index = 0; index < length.length; index++) {
    length[index] = remaining & 0xff;
    remaining >>= 8;
  }
  return concatBytes([length, value]);
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

String _bytesToHex(List<int> bytes) => bytes
    .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
    .join();

Uint8List _hexToBytes(String value) {
  if (value.length.isOdd) throw const FormatException('十六进制长度无效。');
  return Uint8List.fromList([
    for (var index = 0; index < value.length; index += 2)
      int.parse(value.substring(index, index + 2), radix: 16),
  ]);
}

Uint8List _hkdfSha256({
  required Uint8List inputKeyMaterial,
  required Uint8List salt,
  required Uint8List info,
  required int length,
}) {
  final prk = Hmac(sha256, salt).convert(inputKeyMaterial).bytes;
  final output = <int>[];
  var block = <int>[];
  for (var counter = 1; output.length < length; counter++) {
    block = Hmac(sha256, prk)
        .convert(concatBytes([block, info, [counter]]))
        .bytes;
    output.addAll(block);
  }
  return Uint8List.fromList(output.sublist(0, length));
}
