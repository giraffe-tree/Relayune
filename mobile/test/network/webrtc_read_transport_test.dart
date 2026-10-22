import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/network/webrtc_read_transport.dart';

void main() {
  test(
    'reassembles large response and rejects out-of-order or unbounded chunks',
    () {
      final wire = jsonEncode({'ciphertext': 'x' * 50000});
      final total = (wire.length / 12000).ceil();
      final assembly = ReadChunkAssembly();
      Map<String, dynamic>? result;
      for (var i = 0; i < total; i++) {
        result = assembly.add({
          'type': 'chunk',
          'index': i,
          'total': total,
          'length': wire.length,
          'data': wire.substring(
            i * 12000,
            ((i + 1) * 12000).clamp(0, wire.length),
          ),
        });
      }
      expect(result?['ciphertext'], 'x' * 50000);
      expect(
        () => ReadChunkAssembly().add({
          'type': 'chunk',
          'index': 1,
          'total': 1,
          'length': 2,
          'data': '{}',
        }),
        throwsFormatException,
      );
      expect(
        () => ReadChunkAssembly().add({
          'type': 'chunk',
          'index': 0,
          'total': 100000,
          'length': 999999999,
          'data': '{}',
        }),
        throwsFormatException,
      );
      expect(
        () => ReadChunkAssembly().add({
          'type': 'chunk',
          'index': 0,
          'total': 1,
          'length': 5,
          'data': '{}',
        }),
        throwsFormatException,
      );
    },
  );
  test('closed transport rejects direct requests', () async {
    final transport = WebRtcReadTransport(
      signal: (_) async => {},
      onChanged: () {},
    );
    expect(transport.connected, false);
    expect(transport.connecting, false);
    transport.close();
    await expectLater(
      transport.read({'command_type': 'approval.resolve'}),
      throwsStateError,
    );
  });
}
