import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/pairing_pake.dart';
import 'package:relayune_mobile/src/crypto/spake2_p256.dart';

void main() {
  group('RFC 9382 SPAKE2 compatibility', () {
    test('matches the official P256-SHA256-HKDF-HMAC vector', () {
      final w = _hex(
        '2ee57912099d31560b3a44b1184b9b4866e904c49d12ac5042c97dca461b1a5f',
      );
      final scalarA = _hex(
        '43dd0fd7215bdcb482879fca3220c6a968e66d70b1356cac18bb26c84a78d729',
      );
      final scalarB = _hex(
        'dcb60106f276b02606d8ef0a328c02e4b629f84f89786af5befb0bc75b6e66be',
      );
      final shareA = Spake2P256.createShare(
        role: Spake2Role.partyA,
        passwordScalar: w,
        ephemeralScalar: scalarA,
      );
      final shareB = Spake2P256.createShare(
        role: Spake2Role.partyB,
        passwordScalar: w,
        ephemeralScalar: scalarB,
      );
      final output = Spake2P256.finish(
        role: Spake2Role.partyA,
        passwordScalar: w,
        ephemeralScalar: scalarA,
        ownShare: shareA,
        peerShare: shareB,
        identityA: Uint8List.fromList(utf8.encode('server')),
        identityB: Uint8List.fromList(utf8.encode('client')),
      );

      expect(
        _hexString(shareA),
        '04a56fa807caaa53a4d28dbb9853b9815c61a411118a6fe516a8798434751470'
        'f9010153ac33d0d5f2047ffdb1a3e42c9b4e6be662766e1eeb4116988ede5f912c',
      );
      expect(
        _hexString(shareB),
        '0406557e482bd03097ad0cbaa5df82115460d951e3451962f1eaf4367a420676'
        'd09857ccbc522686c83d1852abfa8ed6e4a1155cf8f1543ceca528afb591a1e0b7',
      );
      expect(_hexString(output.sessionKey), '0e0672dc86f8e45565d338b0540abe69');
      expect(
        _hexString(output.ownConfirmation),
        '58ad4aa88e0b60d5061eb6b5dd93e80d9c4f00d127c65b3b35b1b5281fee38f0',
      );
      expect(
        _hexString(output.expectedPeerConfirmation),
        'd3e2e547f1ae04f2dbdbf0fc4b79f8ecff2dff314b5d32fe9fcef2fb26dc459b',
      );
    });

    test('matches the Node responder profile byte for byte', () {
      final result = PairingPake().respondWithScalar(
        pairingId: 'pair_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        code: 'ABCD-2345',
        initiatorShare:
            'BE_mFfds1LWHuztAumR9_IGyaiwzr-31NSx6H9UayAgT61F6z_PJY4ofzusabVF9lKTCmpVksM8BRHZ2EcmnEI4',
        scalarBytes: Uint8List.fromList([
          ...List<int>.filled(31, 0),
          7,
        ]),
      );

      expect(
        result.responderShare,
        'BNk5dwmut9rI4RmcE-Df9_Qrxoq2MZkwP1RAjMvkI-d0B6IYXEePQdIRqKxg9xtI5thRQEjuhqvCuA4b5mJnmbc',
      );
      expect(
        result.responderConfirm,
        'jnDJpUs03kWnHx3nrmsn3o0HT68i11m9k5oa_9Zos8Q',
      );
      expect(
        result.expectedDesktopConfirm,
        '3QhECB-zE4zpEwuGl8zjKKT25XsBh8GhAMLuEGZRss4',
      );
      expect(result.contentKey, 'qTKm7keiYCyhyAJmSf_4GZrBXpKOO1HHypXleBc2Fsc');
    });

    test('normalizes a formatted short code without broadening its alphabet', () {
      expect(normalizePairingCode('abcd-2345'), 'ABCD2345');
      expect(() => normalizePairingCode('ABCD-10IO'), throwsFormatException);
    });
  });
}

Uint8List _hex(String value) => Uint8List.fromList([
  for (var index = 0; index < value.length; index += 2)
    int.parse(value.substring(index, index + 2), radix: 16),
]);

String _hexString(List<int> bytes) => bytes
    .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
    .join();
