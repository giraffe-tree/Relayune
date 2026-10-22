import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/network/webrtc_read_transport.dart';

void main() {
  List<Map<String, dynamic>> reports(
    String local,
    String remote, {
    bool ipv6 = false,
  }) => [
    {
      'id': 'transport',
      'type': 'transport',
      'selectedCandidatePairId': 'chosen',
    },
    {
      'id': 'unused',
      'type': 'candidate-pair',
      'state': 'succeeded',
      'nominated': true,
      'localCandidateId': 'x',
      'remoteCandidateId': 'x',
    },
    {
      'id': 'chosen',
      'type': 'candidate-pair',
      'localCandidateId': 'l',
      'remoteCandidateId': 'r',
    },
    {
      'id': 'l',
      'candidateType': local,
      'address': ipv6 ? '2001:db8::1' : '192.0.2.1',
    },
    {
      'id': 'r',
      'candidateType': remote,
      'address': ipv6 ? '2001:db8::2' : '192.0.2.2',
    },
  ];
  test('uses selected pair and does not guess LAN or VPN', () {
    expect(selectedIcePath(reports('host', 'host')), 'HOST');
    expect(selectedIcePath(reports('host', 'host', ipv6: true)), 'V6');
    expect(selectedIcePath(reports('host', 'srflx')), 'NAT');
    expect(selectedIcePath(reports('prflx', 'host')), 'NAT');
    expect(selectedIcePath(reports('relay', 'host')), 'TURN');
    expect(selectedIcePath([]), isNull);
    expect(selectedIcePath(reports('unknown', 'host')), isNull);
  });
}
