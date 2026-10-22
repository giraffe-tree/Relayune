import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/device/client_identity.dart';

void main() {
  test('system identity yields the same digest after reconstruction', () {
    final first = deriveClientIdentity('android', 'ABCDEF1234567890');
    expect(first, deriveClientIdentity('android', 'abcdef1234567890'));
    expect(first, matches(RegExp(r'^android:[a-f0-9]{64}$')));
    expect(first, isNot(contains('abcdef1234567890')));
    expect(first, isNot(deriveClientIdentity('android', 'abcdef1234567891')));
    expect(first, isNot(deriveClientIdentity('ios', 'ABCDEF1234567890')));
  });
  test('missing and known unusable identifiers never merge devices', () {
    for (final value in [
      null,
      '',
      'unknown',
      '00000000-0000-0000-0000-000000000000',
      '9774d56d682e549c',
    ]) {
      expect(deriveClientIdentity('android', value), isNull);
    }
    expect(deriveClientIdentity('web', 'example'), isNull);
  });
}
