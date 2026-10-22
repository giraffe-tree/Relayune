import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const officialOrigin = 'https://official.example',
      customOrigin = 'https://custom.example';
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  test(
    'legacy official credentials never enter a same-name custom account',
    () async {
      final raw = SecureStore();
      await raw.saveSession('legacy');
      final official = raw.forInstance(officialOrigin, official: true),
          custom = raw.forInstance(customOrigin, official: false);
      await official.saveAccountEmail('admin');
      await custom.saveAccountEmail('admin');
      expect((await official.read()).sessionToken, 'legacy');
      expect((await custom.read()).sessionToken, isNull);
      await custom.forComputer('secondary').saveHistoryKey('scope', 'cache');
      expect(await official.allHistoryKeys(), isEmpty);
      expect(await custom.allHistoryKeys(), ['cache']);
    },
  );
  test(
    'retirement erases all scoped credentials and blocks delayed stale writes',
    () async {
      final raw = SecureStore(),
          official = SecureStore().forInstance(officialOrigin, official: true);
      final custom = raw.forInstance(customOrigin, official: false);
      await raw.saveSelectedInstance(customOrigin, null);
      await official.saveSession('official');
      await custom.saveSession('custom');
      await custom
          .forComputer('second')
          .savePairing(
            contentKey: 'key',
            deviceId: 'device',
            browserId: 'auth',
            browserToken: 'token',
          );
      await custom.forComputer('second').saveHistoryKey('scope', 'cache');
      await custom.retireInstance();
      await custom.saveSession('late');
      await custom.forComputer('second').saveHistoryKey('scope', 'late-cache');
      final restart = raw.forInstance(customOrigin, official: false);
      expect((await restart.read()).sessionToken, isNull);
      expect((await restart.forComputer('second').read()).hasPairing, isFalse);
      expect(await restart.allHistoryKeys(), isEmpty);
      expect((await official.read()).sessionToken, 'official');
      expect((await raw.selectedInstance())!.origin, customOrigin);
    },
  );
  test(
    'interrupted retirement is recovered before startup can read old credentials',
    () async {
      final raw = SecureStore(),
          custom = SecureStore().forInstance(customOrigin, official: false);
      await custom.saveSession('old');
      await custom.markInstanceRetirement(customOrigin);
      await expectLater(custom.read(), throwsStateError);
      await raw.resumeInstanceRetirement(officialOrigin);
      expect(
        (await raw.forInstance(customOrigin, official: false).read())
            .sessionToken,
        isNull,
      );
    },
  );
}
