import '../crypto/pairing_pake.dart';

const pairingQrPrefix = 'relayune-pairing:v1:';
final _pairingQrCodePattern = RegExp(
  r'^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$',
);

class PairingQrData {
  const PairingQrData({required this.pairingId, required this.code});

  final String pairingId;
  final String code;

  static PairingQrData? tryParse(String value) {
    if (value.length > 96 ||
        !value.startsWith(pairingQrPrefix) ||
        value.contains('://')) {
      return null;
    }
    final body = value.substring(pairingQrPrefix.length);
    final separator = body.lastIndexOf(':');
    if (separator <= 0 || separator == body.length - 1) return null;
    final pairingId = body.substring(0, separator);
    final rawCode = body.substring(separator + 1);
    if (!pairingIdPattern.hasMatch(pairingId) ||
        !_pairingQrCodePattern.hasMatch(rawCode)) {
      return null;
    }
    return PairingQrData(pairingId: pairingId, code: rawCode);
  }
}
