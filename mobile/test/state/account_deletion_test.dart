import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';

class _Api extends RelayApi {
  int deletions = 0;
  @override
  Future<void> deleteAccount(String password) async {
    deletions++;
  }

  @override
  Future<void> logout() async {}
}

class _Store extends SecureStore {
  final cleanup = Completer<void>();
  int attempts = 0;
  @override
  Future<void> clearSession() async {}
  @override
  Future<void> clearHistoryKeys() async {}
  @override
  Future<void> clearDeletedAccount(String email) async {
    attempts++;
    if (attempts == 1) throw StateError('interrupted cleanup');
    await cleanup.future;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'local cleanup retry does not repeat confirmed backend deletion or expose sign-in early',
    () async {
      final api = _Api();
      final store = _Store();
      final controller = AppController(api: api, secureStore: store)
        ..email = 'delete@example.com'
        ..phase = AppPhase.ready;
      addTearDown(controller.dispose);
      await expectLater(controller.deleteAccount('password'), throwsStateError);
      expect(controller.phase, AppPhase.ready);
      final retry = controller.deleteAccount('password');
      await Future<void>.delayed(Duration.zero);
      expect(api.deletions, 1);
      expect(controller.phase, AppPhase.ready);
      store.cleanup.complete();
      await retry;
      expect(controller.phase, AppPhase.signedOut);
      expect(store.attempts, 2);
    },
  );
}
