import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/codec.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';

void main() {
  const aad = RelayAad(
    direction: 'web_to_relay',
    type: 'session.submit_message',
    deviceId: 'dev_0123456789abcdef0123456789abcdef',
    sessionId: 'thr_test',
    requestId: 'req_test',
    eventSeq: null,
    createdAt: '2026-08-09T00:00:00.000Z',
    expiresAt: '2026-08-09T00:05:00.000Z',
  );

  test('canonical JSON and AES-GCM match the Web Crypto vector', () async {
    final key = RelayKey.import('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
    final cipher = RelayCipher(random: _SequenceRandom());
    final envelope = await cipher.sealJson(key, {
      'type': 'session.submit_message',
      'payload': {'content': '你好，Relayune'},
    }, aad);

    expect(key.keyId, 'sha256:Yw3NKWbEM2aRElRIu7JbT_QSpJxzLbLIq8G4WBvXEN0');
    expect(envelope.iv, 'AAECAwQFBgcICQoL');
    expect(
      envelope.aad,
      'eyJjcmVhdGVkX2F0IjoiMjAyNi0wOC0wOVQwMDowMDowMC4wMDBaIiwiZGV2aWNlX2lkIjoiZGV2XzAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmIiwiZGlyZWN0aW9uIjoid2ViX3RvX3JlbGF5IiwiZXZlbnRfc2VxIjpudWxsLCJleHBpcmVzX2F0IjoiMjAyNi0wOC0wOVQwMDowNTowMC4wMDBaIiwicmVxdWVzdF9pZCI6InJlcV90ZXN0Iiwic2Vzc2lvbl9pZCI6InRocl90ZXN0IiwidHlwZSI6InNlc3Npb24uc3VibWl0X21lc3NhZ2UifQ',
    );
    expect(
      envelope.ciphertext,
      'PCCiYrWA4CGvMvL4woAXA62l8ladEisjVQKW9nwOZZAtMt6d1q19-RCGRZaq5EdWmjwO-XjsgT6CN8-8pQxJYqJZqhuqpEgEPinXKuaWVDMwX_fIPnIkVKQ35w',
    );

    final opened = await cipher.openJson<Map<String, dynamic>>(
      key,
      envelope,
      aad,
    );
    expect(opened['type'], 'session.submit_message');
    expect((opened['payload'] as Map)['content'], '你好，Relayune');
  });

  test('rejects authenticated routing metadata changes', () async {
    final key = RelayKey.import('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
    final cipher = RelayCipher(random: _SequenceRandom());
    final envelope = await cipher.sealJson(key, {'safe': true}, aad);
    const changed = RelayAad(
      direction: 'web_to_relay',
      type: 'session.interrupt_turn',
      deviceId: 'dev_0123456789abcdef0123456789abcdef',
      sessionId: 'thr_test',
      requestId: 'req_test',
      eventSeq: null,
      createdAt: '2026-08-09T00:00:00.000Z',
      expiresAt: '2026-08-09T00:05:00.000Z',
    );

    expect(
      () => cipher.openJson<Map<String, dynamic>>(key, envelope, changed),
      throwsFormatException,
    );
  });

  test('canonical JSON sorts every object recursively', () {
    expect(
      canonicalJson({
        'z': 1,
        'a': {'y': true, 'b': null},
      }),
      '{"a":{"b":null,"y":true},"z":1}',
    );
  });

  test(
    'large payload worker preserves JSON, routing and key ownership',
    () async {
      final key = RelayKey.import(
        'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
      );
      final originalKey = List<int>.of(key.bytes);
      final cipher = RelayCipher(random: _SequenceRandom());
      final value = {
        'sessions': [
          for (var i = 0; i < 300; i++)
            {'id': i, 'content': '你好 🌊 ${'message' * 60}', 'done': i.isEven},
        ],
        'cursor': 301,
      };
      final envelope = await cipher.sealJson(key, value, aad);
      expect(envelope.ciphertext.length, greaterThan(44 * 1024));
      expect(await cipher.openJson(key, envelope, aad), value);
      expect(key.bytes, originalKey);

      final changed = RelayAad.fromJson({
        ...aad.toJson(),
        'session_id': 'another-session',
      });
      await expectLater(
        cipher.openJson(key, envelope, changed),
        throwsFormatException,
      );
      final wrongKey = RelayKey.import(
        'AQECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
      );
      await expectLater(
        cipher.openJson(wrongKey, envelope, aad),
        throwsFormatException,
      );
      final packed = decodeBase64Url(envelope.ciphertext);
      packed[packed.length - 1] ^= 1;
      final corrupted = SealedEnvelope.fromJson({
        ...envelope.toJson(),
        'ciphertext': base64UrlNoPadding(packed),
      });
      await expectLater(
        cipher.openJson(key, corrupted, aad),
        throwsFormatException,
      );
      expect(key.bytes, originalKey);
    },
  );
}

class _SequenceRandom implements Random {
  int _next = 0;

  @override
  bool nextBool() => nextInt(2) == 1;

  @override
  double nextDouble() => nextInt(1 << 32) / (1 << 32);

  @override
  int nextInt(int max) => _next++ % max;
}
