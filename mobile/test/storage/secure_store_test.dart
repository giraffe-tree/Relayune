import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';

void main() {
  test(
    'maintenance enumerates cache keys from every computer without transport credentials',
    () async {
      final platform = _MemorySecureStorage();
      final store = SecureStore(storage: platform);
      await store.saveSession('transport-session');
      await store.saveHistoryKey('root', 'root-cache');
      await store.forComputer('other').saveHistoryKey('scoped', 'other-cache');
      expect(
        await store.allHistoryKeys(),
        unorderedEquals(['root-cache', 'other-cache']),
      );
      expect(await store.historyKeys(), {'root': 'root-cache'});
    },
  );

  test(
    'interrupted account cleanup resumes before credentials are read',
    () async {
      final platform = _MemorySecureStorage();
      final store = SecureStore(storage: platform);
      await store.saveSession('session');
      await store.savePairing(
        contentKey: 'key',
        deviceId: 'device',
        browserId: 'auth',
        browserToken: 'token',
      );
      platform.failDeletion = true;
      await expectLater(
        store.clearDeletedAccount('delete@example.com'),
        throwsStateError,
      );
      expect(
        platform.values['relayune.deleted-account-cleanup.v1'],
        'delete@example.com',
      );
      platform.failDeletion = false;
      final restored = await SecureStore(storage: platform).read();
      expect(restored.sessionToken, isNull);
      expect(restored.hasPairing, isFalse);
      expect(platform.values['relayune.deleted-account-cleanup.v1'], isNull);
    },
  );
  test(
    'account deletion removes all saved computer secrets and keeps another account isolated',
    () async {
      final platform = _MemorySecureStorage();
      final root = SecureStore(storage: platform);
      await root.saveAccountEmail('delete@example.com');
      await root.saveSession('session');
      for (final scope in ['primary', 'secondary', 'other']) {
        final store = root.forComputer(scope);
        await store.savePairing(
          contentKey: 'key-$scope',
          deviceId: scope,
          browserId: 'auth-$scope',
          browserToken: 'token-$scope',
        );
        await store.saveHistoryKey('cache', 'history-$scope');
        await root.rememberComputer(
          scope == 'other' ? 'other@example.com' : 'delete@example.com',
          scope,
        );
      }
      await root
          .forComputer('secondary')
          .clearDeletedAccount('delete@example.com');
      expect((await root.read()).sessionToken, isNull);
      expect(await root.lastAccountEmail(), isNull);
      expect(await root.computerScopes('delete@example.com'), isEmpty);
      for (final scope in ['primary', 'secondary']) {
        expect((await root.forComputer(scope).read()).hasPairing, isFalse);
        expect(await root.forComputer(scope).readHistoryKey('cache'), isNull);
      }
      expect((await root.forComputer('other').read()).hasPairing, isTrue);
      expect(
        await root.forComputer('other').readHistoryKey('cache'),
        'history-other',
      );
    },
  );
  test(
    'concurrent local color writes preserve devices and account isolation',
    () async {
      final platform = _MemorySecureStorage();
      final store = SecureStore(storage: platform);
      await Future.wait([
        store.saveComputerColor('User@Example.com', 'a', 0xFFA6E3B9),
        store.saveComputerColor('user@example.com', 'b', 0xFF91BFFF),
      ]);
      final reopened = SecureStore(storage: platform);
      expect(await reopened.computerColors('user@example.com'), {
        'a': 0xFFA6E3B9,
        'b': 0xFF91BFFF,
      });
      expect(await reopened.computerColors('other@example.com'), isEmpty);
      await reopened.clearPairing();
      expect((await reopened.computerColors('user@example.com')).length, 2);
    },
  );

  test(
    'automatic routing is the default while an explicit server preference survives upgrades',
    () async {
      final store = SecureStore(storage: _MemorySecureStorage());
      expect((await store.read()).directReads, isTrue);
      await store.saveDirectReads(false);
      expect((await store.read()).directReads, isFalse);
    },
  );

  test(
    'logout and pairing revocation destroy persisted history keys before any history is opened',
    () async {
      final platform = _MemorySecureStorage();
      final before = SecureStore(storage: platform);
      await before.saveHistoryKey('scope', 'synthetic-cache-key');
      final reopened = SecureStore(storage: platform);
      expect(await reopened.readHistoryKey('scope'), 'synthetic-cache-key');
      await reopened.clearPairing();
      expect(await reopened.readHistoryKey('scope'), isNull);
      await reopened.saveHistoryKey('next', 'synthetic-next-key');
      await reopened.clearSession();
      expect(await reopened.readHistoryKey('next'), isNull);
    },
  );

  test(
    '[MOB-STA-007][flutter] login and pairing survive app recreation and credential schema upgrades',
    () async {
      final platformStore = _MemorySecureStorage();
      final beforeUpdate = SecureStore(storage: platformStore);
      await beforeUpdate.saveSession('session_secret');
      await beforeUpdate.savePreferredLocale('ar');
      await beforeUpdate.saveHapticsEnabled(false);
      await beforeUpdate.saveFontSize('medium');
      await beforeUpdate.saveDirectReads(true);
      await beforeUpdate.saveAgentOrder(['kimi', 'codex', 'claude']);
      await beforeUpdate.saveVisibleAgents(['claude', 'pi']);
      await beforeUpdate.saveOpenedSessionVersions(const {
        'session-opened': '2026-09-02T12:00:00.000Z',
      });
      await beforeUpdate.savePairing(
        contentKey: 'content_key_secret',
        deviceId: 'dev_study_mac',
        browserId: 'web_mobile',
        browserToken: 'browser_token_secret',
      );

      final afterUpdate = SecureStore(storage: platformStore);
      final restored = await afterUpdate.read();

      expect(restored.sessionToken, 'session_secret');
      expect(restored.contentKey, 'content_key_secret');
      expect(restored.deviceId, 'dev_study_mac');
      expect(restored.browserId, 'web_mobile');
      expect(restored.browserToken, 'browser_token_secret');
      expect(restored.preferredLocale, 'ar');
      expect(restored.hapticsEnabled, isFalse);
      expect(restored.fontSize, 'medium');
      expect(restored.directReads, isTrue);
      expect(restored.visibleAgents, ['claude', 'pi']);
      expect(restored.agentOrder, [
        'kimi',
        'codex',
        'claude',
        'mcode',
        'zcode',
        'opencode',
        'claude-cowork',
        'pi',
      ]);
      expect(restored.openedSessionVersions, const {
        'session-opened': '2026-09-02T12:00:00.000Z',
      });
      expect(restored.hasPairing, isTrue);
      expect(platformStore.readKeys, hasLength(14));
      expect(
        platformStore.readKeys,
        isNot(contains('relayune.content-key.v2')),
      );

      await afterUpdate.clearSession();
      final signedOut = await SecureStore(storage: platformStore).read();
      expect(signedOut.sessionToken, isNull);
      expect(signedOut.hasPairing, isTrue);
      expect(signedOut.preferredLocale, 'ar');
      expect(signedOut.hapticsEnabled, isFalse);
      expect(signedOut.fontSize, 'medium');
      expect(signedOut.directReads, isTrue);

      await afterUpdate.savePreferredLocale(null);
      expect(
        (await SecureStore(storage: platformStore).read()).preferredLocale,
        isNull,
      );
    },
  );

  test('legacy pairing keys migrate into the atomic secure bundle', () async {
    final platformStore = _MemorySecureStorage()
      ..values.addAll({
        'relayune.content-key.v2': 'legacy_content_key',
        'relayune.device-id.v2': 'dev_legacy',
        'relayune.browser-id.v2': 'web_legacy',
        'relayune.browser-token.v2': 'legacy_browser_token',
      });

    final restored = await SecureStore(storage: platformStore).read();

    expect(restored.hasPairing, isTrue);
    expect(platformStore.values['relayune.pairing.v3'], isNotNull);
    expect(platformStore.readKeys, hasLength(18));

    platformStore.values.remove('relayune.content-key.v2');
    platformStore.values.remove('relayune.device-id.v2');
    platformStore.values.remove('relayune.browser-id.v2');
    platformStore.values.remove('relayune.browser-token.v2');
    expect(
      (await SecureStore(storage: platformStore).read()).hasPairing,
      isTrue,
    );
  });

  test('invalid bundle still recovers complete legacy pairing', () async {
    final platformStore = _MemorySecureStorage()
      ..values.addAll({
        'relayune.pairing.v3': '{invalid',
        'relayune.content-key.v2': 'legacy_content_key',
        'relayune.device-id.v2': 'dev_legacy',
        'relayune.browser-id.v2': 'web_legacy',
        'relayune.browser-token.v2': 'legacy_browser_token',
      });
    final restored = await SecureStore(storage: platformStore).read();
    expect(restored.hasPairing, isTrue);
    expect(restored.deviceId, 'dev_legacy');
  });
  test(
    'computer credentials and caches remain isolated across add, restore and removal',
    () async {
      final platform = _MemorySecureStorage();
      final root = SecureStore(storage: platform);
      await root.saveSession('account-token');
      await root.savePairing(
        contentKey: 'primary-key',
        deviceId: 'a',
        browserId: 'auth-a',
        browserToken: 'token-a',
      );
      final second = root.forComputer('second');
      expect((await second.read()).hasPairing, isFalse);
      await second.savePairing(
        contentKey: 'second-key',
        deviceId: 'b',
        browserId: 'auth-b',
        browserToken: 'token-b',
      );
      await Future.wait([
        root.saveHistoryKey('a', 'cache-a'),
        second.saveHistoryKey('b', 'cache-b'),
      ]);
      await Future.wait([
        root.rememberComputer('user@example.com', 'second'),
        root.rememberComputer('user@example.com', 'third'),
      ]);
      expect(
        await root.computerScopes('USER@example.com'),
        containsAll(['second', 'third']),
      );
      expect(await root.computerScopes('someone-else@example.com'), isEmpty);
      expect((await SecureStore(storage: platform).read()).deviceId, 'a');
      expect(
        (await SecureStore(
          storage: platform,
          computerScope: 'second',
        ).read()).deviceId,
        'b',
      );
      expect((await second.read()).sessionToken, 'account-token');
      await second.clearPairing();
      expect(await second.readHistoryKey('b'), isNull);
      expect(await root.readHistoryKey('a'), 'cache-a');
      expect((await root.read()).browserToken, 'token-a');
      expect((await second.read()).hasPairing, isFalse);
    },
  );
}

class _MemorySecureStorage extends FlutterSecureStorage {
  @override
  Future<Map<String, String>> readAll({
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => Map.of(values);

  bool failDeletion = false;
  _MemorySecureStorage();

  final Map<String, String> values = {};
  final List<String> readKeys = [];

  @override
  Future<String?> read({
    required String key,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    readKeys.add(key);
    return values[key];
  }

  @override
  Future<void> write({
    required String key,
    required String? value,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }

  @override
  Future<void> delete({
    required String key,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (failDeletion) throw StateError('simulated storage interruption');
    values.remove(key);
  }

  @override
  Future<void> deleteAll({
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    values.clear();
  }
}
