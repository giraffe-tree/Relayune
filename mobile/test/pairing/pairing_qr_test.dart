import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/pairing/pairing_qr.dart';

void main() {
  final pairingId = 'pair_${List.filled(43, 'A').join()}';

  test('parses the desktop camera-only pairing envelope', () {
    final result = PairingQrData.tryParse(
      'relayune-pairing:v1:$pairingId:ABCD2345',
    );

    expect(result?.pairingId, pairingId);
    expect(result?.code, 'ABCD2345');
  });

  test(
    'rejects URLs, malformed identifiers, and invalid short-code symbols',
    () {
      expect(
        PairingQrData.tryParse(
          'https://relayune.giraffetree.cn/?pair=$pairingId&code=ABCD2345',
        ),
        isNull,
      );
      expect(
        PairingQrData.tryParse('relayune-pairing:v1:pair_short:ABCD2345'),
        isNull,
      );
      expect(
        PairingQrData.tryParse('relayune-pairing:v1:$pairingId:ABCD10IO'),
        isNull,
      );
      expect(
        PairingQrData.tryParse('relayune-pairing:v1:$pairingId:abcd2345'),
        isNull,
      );
      expect(
        PairingQrData.tryParse('relayune-pairing:v1:$pairingId:ABCD-2345'),
        isNull,
      );
      expect(
        PairingQrData.tryParse(
          'relayune-pairing:v1:${List.filled(120, 'A').join()}:ABCD2345',
        ),
        isNull,
      );
    },
  );
}
