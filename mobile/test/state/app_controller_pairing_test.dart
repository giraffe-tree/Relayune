import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/pairing_pake.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';

final _confirmation = base64UrlEncode(Uint8List(32)).replaceAll('=', '');

void main() {
  for (final online in [true, false]) {
    testWidgets(
      'missing first catalog reports ${online ? 'encrypted response timeout' : 'offline'} and never saves unverified pairing',
      (tester) async {
        FlutterSecureStorage.setMockInitialValues({});
        final api = _PairingApi(online);
        final store = SecureStore();
        final controller =
            AppController(api: api, secureStore: store, pairingPake: _Pake())
              ..phase = AppPhase.needsPairing
              ..pendingPairingId = 'pair_${'A' * 43}';
        addTearDown(controller.dispose);
        var finished = false;
        final operation = controller
            .pair('ABCD2345')
            .then((_) => finished = true);
        for (var i = 0; i < 80 && !finished; i++) {
          await tester.pump(const Duration(milliseconds: 500));
        }
        expect(finished, isTrue);
        await operation;
        expect(api.bootstraps, 60);
        expect(
          controller.error,
          online ? '等待电脑端加密响应超时。' : '电脑端尚未上线，请保持 Relayune 打开后重试。',
        );
        expect(controller.pairingPhase, PairingPhase.idle);
        expect(controller.phase, AppPhase.needsPairing);
        expect((await store.read()).hasPairing, isFalse);
      },
    );
  }
}

class _Pake extends PairingPake {
  @override
  Future<PairingResult> respond({
    required String pairingId,
    required String code,
    required String initiatorShare,
  }) async => PairingResult(
    responderShare: '',
    responderConfirm: _confirmation,
    expectedDesktopConfirm: _confirmation,
    contentKey: base64UrlEncode(List.filled(32, 7)).replaceAll('=', ''),
  );
}

class _PairingApi extends RelayApi {
  _PairingApi(this.online);
  final bool online;
  var states = 0;
  var bootstraps = 0;
  @override
  Future<PairingPublicState> pairingState(String pairingId) async =>
      PairingPublicState(
        pairingId: pairingId,
        protocol: pairingProtocol,
        mode: 'browser',
        initiatorShare: '',
        status: states++ == 0 ? 'waiting' : 'paired',
        expiresAt: '2099-01-01T00:00:00Z',
        deviceId: 'synthetic-device',
        browserId: 'synthetic-browser',
        desktopConfirm: _confirmation,
      );
  @override
  Future<String> respondToPairing({
    required String pairingId,
    required String responderShare,
    required String responderConfirm,
    required String browserTokenHash,
    required String browserKeyId,
    required String browserName,
    String? clientIdentity,
  }) async => 'synthetic-browser';
  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) async {
    bootstraps++;
    return ServerBootstrap(
      email: 'fixture@example.test',
      device: RelayDevice(
        id: 'synthetic-device',
        name: 'Synthetic Mac',
        online: online,
        agentConnected: online,
        lastSeenAt: null,
      ),
      catalog: null,
      events: const [],
      cursor: 0,
      ackSequence: 0,
      queuedCommands: 0,
    );
  }
}
