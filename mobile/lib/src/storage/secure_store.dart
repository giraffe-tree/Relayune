import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../state/agent_order.dart';

class StoredCredentials {
  const StoredCredentials({
    this.sessionToken,
    this.contentKey,
    this.deviceId,
    this.browserId,
    this.browserToken,
    this.projectAliases = const {},
    this.notificationPrimerSeen = false,
    this.hapticsEnabled = true,
    this.notificationPermissionRequested = false,
    this.preferredLocale,
    this.fontSize,
    this.directReads = false,
    this.agentOrder = defaultAgentOrder,
    this.visibleAgents = defaultVisibleAgents,
    this.openedSessionVersions = const {},
  });

  final String? sessionToken;
  final String? contentKey;
  final String? deviceId;
  final String? browserId;
  final String? browserToken;
  final Map<String, String> projectAliases;
  final bool notificationPrimerSeen;
  final bool hapticsEnabled;
  final bool notificationPermissionRequested;
  final String? preferredLocale;
  final String? fontSize;
  final bool directReads;
  final List<String> agentOrder;
  final List<String> visibleAgents;
  final Map<String, String> openedSessionVersions;

  bool get hasPairing =>
      contentKey != null &&
      deviceId != null &&
      browserId != null &&
      browserToken != null;
}

class SecureStore {
  SecureStore({FlutterSecureStorage? storage, this.computerScope})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(encryptedSharedPreferences: true),
            iOptions: IOSOptions(
              accessibility: KeychainAccessibility.first_unlock_this_device,
            ),
          );

  static const _selectedOrigin = 'relayune.selected-origin.v1';
  FlutterSecureStorage get _baseStorage =>
      _storage is _InstanceStorage ? _storage.base : _storage;
  Future<({String origin, String? certificatePem})?> selectedInstance() async {
    final encoded = await _baseStorage.read(key: _selectedOrigin);
    if (encoded == null) return null;
    final value = jsonDecode(encoded) as Map<String, dynamic>;
    return (
      origin: value['origin'] as String,
      certificatePem: value['certificate_pem'] as String?,
    );
  }

  Future<void> saveSelectedInstance(String origin, String? certificatePem) =>
      _baseStorage.write(
        key: _selectedOrigin,
        value: jsonEncode({
          'origin': origin,
          'certificate_pem': certificatePem,
        }),
      );

  static const _pendingRetirement = 'relayune.instance-retirement.v1';
  Future<void> markInstanceRetirement(String origin) =>
      _baseStorage.write(key: _pendingRetirement, value: origin);
  Future<void> finishInstanceRetirement() =>
      _baseStorage.delete(key: _pendingRetirement);
  Future<void> resumeInstanceRetirement(String officialOrigin) async {
    final origin = await _baseStorage.read(key: _pendingRetirement);
    if (origin == null) return;
    await forInstance(
      origin,
      official: origin == officialOrigin,
    ).retireInstance();
    await finishInstanceRetirement();
  }

  SecureStore forInstance(String origin, {required bool official}) =>
      SecureStore(
        storage: _InstanceStorage(
          _baseStorage,
          official
              ? ''
              : 'relayune.instance.${base64Url.encode(utf8.encode(origin))}.',
        ),
      );

  /// Controllers are disposed first. Refuse delayed writes from that generation
  /// before deleting credentials, including indexed and orphaned cache keys.
  Future<void> retireInstance() async {
    if (_storage case final _InstanceStorage scoped) {
      scoped.retired = true;
      await scoped.drainWrites();
      await scoped.deleteAll();
    } else {
      await clearAll();
    }
  }

  static const _hapticsEnabled = 'relayune.haptics-enabled.v1';
  static const _session = 'relayune.session.v1';
  static const _pairingBundle = 'relayune.pairing.v3';
  static const _contentKey = 'relayune.content-key.v2';
  static const _deviceId = 'relayune.device-id.v2';
  static const _browserId = 'relayune.browser-id.v2';
  static const _browserToken = 'relayune.browser-token.v2';
  static const _projectAliases = 'relayune.project-aliases.v1';
  static const _notificationPrimerSeen = 'relayune.notification-primer-seen.v1';
  static const _notificationPermissionRequested =
      'relayune.notification-permission-requested.v1';
  static const _preferredLocale = 'relayune.preferred-locale.v1';
  static const _directReads = 'relayune.direct-reads.v1';
  Future<void> saveDirectReads(bool enabled) =>
      _storage.write(key: _directReads, value: '$enabled');

  static const _fontSize = 'relayune.font-size.v1';
  static const _visibleAgents = 'relayune.visible-agents.v1';
  static const _agentOrder = 'relayune.agent-order.v1';
  static const _openedSessionVersions = 'relayune.opened-session-versions.v1';

  final FlutterSecureStorage _storage;
  final String? computerScope;
  // Platform writes are serialized across computers, including index changes.
  static Future<void>? _writes;
  static int _writeGeneration = 0;
  static Future<T> _serial<T>(Future<T> Function() operation) {
    final generation = ++_writeGeneration;
    final pending = _writes;
    final task = pending == null
        ? Future<T>.sync(operation)
        : pending.then((_) => operation());
    final result = task.whenComplete(() {
      // Release the idle queue, including its originating async zone.
      if (generation == _writeGeneration) _writes = null;
    });
    _writes = result.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    return result;
  }

  String _key(String key) =>
      computerScope == null ? key : '$key.computer.$computerScope';
  SecureStore forComputer(String scope) =>
      SecureStore(storage: _storage, computerScope: scope);

  // Presentation preference only: never sent to Desktop or Server.
  Future<Map<String, int>> computerColors(String email) async {
    final values = _decodeStringMap(
      await _storage.read(
        key: 'relayune.computer-colors.v1.${email.trim().toLowerCase()}',
      ),
    );
    return {
      for (final entry in values.entries)
        if (int.tryParse(entry.value) case final int value) entry.key: value,
    };
  }

  Future<void> saveComputerColor(String email, String device, int color) =>
      _serial(() async {
        final values = await computerColors(email);
        values[device] = color;
        await _storage.write(
          key: 'relayune.computer-colors.v1.${email.trim().toLowerCase()}',
          value: jsonEncode(
            values.map((key, value) => MapEntry(key, '$value')),
          ),
        );
      });

  Future<String?> lastAccountEmail() =>
      _storage.read(key: 'relayune.computers-account.v1');
  Future<void> saveAccountEmail(String email) =>
      _storage.write(key: 'relayune.computers-account.v1', value: email);

  Future<List<String>> computerScopes(String email) async {
    final values = _decodeStringMap(
      await _storage.read(key: 'relayune.computers.v1'),
    );
    final encoded = values[email.trim().toLowerCase()];
    if (encoded == null) return const [];
    return (jsonDecode(encoded) as List).whereType<String>().toList();
  }

  Future<void> rememberComputer(String email, String scope) =>
      _serial(() async {
        final values = Map<String, String>.of(
          _decodeStringMap(await _storage.read(key: 'relayune.computers.v1')),
        );
        final account = email.trim().toLowerCase();
        final scopes = await computerScopes(account);
        values[account] = jsonEncode({...scopes, scope}.toList());
        await _storage.write(
          key: 'relayune.computers.v1',
          value: jsonEncode(values),
        );
      });

  Future<void> forgetComputer(String email, String scope) => _serial(() async {
    final values = Map<String, String>.of(
      _decodeStringMap(await _storage.read(key: 'relayune.computers.v1')),
    );
    final account = email.trim().toLowerCase();
    values[account] = jsonEncode(
      (await computerScopes(account)).where((s) => s != scope).toList(),
    );
    await _storage.write(
      key: 'relayune.computers.v1',
      value: jsonEncode(values),
    );
  });

  Future<void> clearHistoryKeys() => _serial(_clearHistoryKeys);

  // Persist cleanup intent before removing secrets. An interrupted platform write
  // is retried on the next read before old credentials/cache keys can be loaded.
  Future<void> clearDeletedAccount(String email) => _serial(() async {
    final account = email.trim().toLowerCase();
    await _storage.write(
      key: 'relayune.deleted-account-cleanup.v1',
      value: account,
    );
    final root = SecureStore(storage: _storage);
    final scopes = await root.computerScopes(account);
    for (final scoped in [root, ...scopes.map(root.forComputer)]) {
      await scoped._clearHistoryKeys();
      for (final key in [
        _pairingBundle,
        _contentKey,
        _deviceId,
        _browserId,
        _browserToken,
        _projectAliases,
        _openedSessionVersions,
      ]) {
        await _storage.delete(key: scoped._key(key));
      }
    }
    await _storage.delete(key: _session);
    final accounts = Map<String, String>.of(
      _decodeStringMap(await _storage.read(key: 'relayune.computers.v1')),
    )..remove(account);
    await _storage.write(
      key: 'relayune.computers.v1',
      value: jsonEncode(accounts),
    );
    await _storage.delete(key: 'relayune.computer-colors.v1.$account');
    if ((await root.lastAccountEmail())?.trim().toLowerCase() == account) {
      await _storage.delete(key: 'relayune.computers-account.v1');
    }
    await _storage.delete(key: 'relayune.deleted-account-cleanup.v1');
  });

  Future<StoredCredentials> read() async {
    if (await _baseStorage.read(key: _pendingRetirement) != null) {
      throw StateError(
        'Instance cleanup must finish before credentials can be read',
      );
    }
    final deleted = await _storage.read(
      key: 'relayune.deleted-account-cleanup.v1',
    );
    if (deleted != null) await clearDeletedAccount(deleted);
    final values = await Future.wait([
      _storage.read(key: _session),
      _storage.read(key: _key(_pairingBundle)),
      _storage.read(key: _key(_projectAliases)),
      _storage.read(key: _notificationPrimerSeen),
      _storage.read(key: _notificationPermissionRequested),
      _storage.read(key: _preferredLocale),
      _storage.read(key: _key(_openedSessionVersions)),
      _storage.read(key: _hapticsEnabled),
      _storage.read(key: _fontSize),
      _storage.read(key: _agentOrder),
      _storage.read(key: _visibleAgents),
      _storage.read(key: _directReads),
    ]);
    final bundled = _decodePairingBundle(values[1]);
    var pairing = bundled ?? const StoredCredentials();
    // A valid atomic bundle is authoritative. Only older installations need
    // four additional platform secure-storage calls to recover legacy keys.
    if (bundled == null) {
      final legacyValues = await Future.wait([
        _storage.read(key: _key(_contentKey)),
        _storage.read(key: _key(_deviceId)),
        _storage.read(key: _key(_browserId)),
        _storage.read(key: _key(_browserToken)),
      ]);
      final legacy = StoredCredentials(
        contentKey: legacyValues[0],
        deviceId: legacyValues[1],
        browserId: legacyValues[2],
        browserToken: legacyValues[3],
      );
      if (legacy.hasPairing) {
        pairing = legacy;
        try {
          await _writePairingBundle(legacy);
        } on Object {
          // Keep legacy credentials usable if migration cannot be committed.
        }
      }
    }
    return StoredCredentials(
      sessionToken: values[0],
      contentKey: pairing.contentKey,
      deviceId: pairing.deviceId,
      browserId: pairing.browserId,
      browserToken: pairing.browserToken,
      projectAliases: _decodeProjectAliases(values[2]),
      notificationPrimerSeen: values[3] == 'true',
      notificationPermissionRequested: values[4] == 'true',
      preferredLocale: values[5],
      openedSessionVersions: _decodeStringMap(values[6]),
      hapticsEnabled: values[7] != 'false',
      fontSize: values[8],
      agentOrder: _decodeAgentOrder(values[9]),
      visibleAgents: _decodeVisibleAgents(values[10]),
      directReads: values[11] != 'false',
    );
  }

  static List<String> _decodeVisibleAgents(String? encoded) {
    try {
      return normalizeVisibleAgents(
        encoded == null ? null : jsonDecode(encoded),
      );
    } on FormatException {
      return defaultVisibleAgents;
    }
  }

  Future<void> saveVisibleAgents(List<String> values) =>
      _storage.write(key: _visibleAgents, value: jsonEncode(values));

  static List<String> _decodeAgentOrder(String? encoded) {
    try {
      return normalizeAgentOrder(encoded == null ? null : jsonDecode(encoded));
    } on FormatException {
      return defaultAgentOrder;
    }
  }

  Future<void> saveAgentOrder(List<String> order) =>
      _storage.write(key: _agentOrder, value: jsonEncode(order));

  static StoredCredentials? _decodePairingBundle(String? encoded) {
    if (encoded == null || encoded.isEmpty) return null;
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! Map || decoded['version'] != 3) return null;
      final contentKey = decoded['content_key'];
      final deviceId = decoded['device_id'];
      final browserId = decoded['browser_id'];
      final browserToken = decoded['browser_token'];
      if (contentKey is! String ||
          contentKey.isEmpty ||
          deviceId is! String ||
          deviceId.isEmpty ||
          browserId is! String ||
          browserId.isEmpty ||
          browserToken is! String ||
          browserToken.isEmpty) {
        return null;
      }
      return StoredCredentials(
        contentKey: contentKey,
        deviceId: deviceId,
        browserId: browserId,
        browserToken: browserToken,
      );
    } on FormatException {
      return null;
    }
  }

  static Map<String, String> _decodeProjectAliases(String? encoded) =>
      _decodeStringMap(encoded);

  static Map<String, String> _decodeStringMap(String? encoded) {
    if (encoded == null || encoded.isEmpty) return const {};
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! Map) return const {};
      return Map.unmodifiable({
        for (final entry in decoded.entries)
          if (entry.key is String && entry.value is String)
            entry.key as String: entry.value as String,
      });
    } on FormatException {
      return const {};
    }
  }

  Future<void> saveHapticsEnabled(bool enabled) =>
      _storage.write(key: _hapticsEnabled, value: '$enabled');

  Future<void> saveFontSize(String size) =>
      _storage.write(key: _fontSize, value: size);

  Future<void> saveSession(String token) =>
      _storage.write(key: _session, value: token);

  Future<void> clearSession() async {
    await clearHistoryKeys();
    await _storage.delete(key: _session);
  }

  // Separate from transport credentials; destroying this key invalidates only
  // this authorization's encrypted local history and protected pending input.
  Future<String?> readHistoryKey(String scope) =>
      _storage.read(key: _key('relayune.history-key.v1.$scope'));

  Future<void> saveHistoryKey(String scope, String key) => _serial(() async {
    final indexKey = _key('relayune.history-key-scopes.v1');
    final encoded = await _storage.read(key: indexKey);
    final scopes = encoded == null
        ? <String>[]
        : (jsonDecode(encoded) as List).cast<String>();
    // Register first, so interruption cannot leave an untracked secret.
    await _storage.write(
      key: indexKey,
      value: jsonEncode({...scopes, scope}.toList()),
    );
    await _storage.write(
      key: _key('relayune.history-key.v1.$scope'),
      value: key,
    );
  });

  // Only cache key material is returned; transport credentials never leave the store.
  Future<List<String>> allHistoryKeys() async => (await _storage.readAll())
      .entries
      .where((entry) => entry.key.contains('relayune.history-key.v1.'))
      .map((entry) => entry.value)
      .toList();

  Future<Map<String, String>> historyKeys() async {
    final encoded = await _storage.read(
      key: _key('relayune.history-key-scopes.v1'),
    );
    final result = <String, String>{};
    for (final scope
        in encoded == null
            ? <String>[]
            : (jsonDecode(encoded) as List).cast<String>()) {
      final key = await readHistoryKey(scope);
      if (key != null) result[scope] = key;
    }
    return result;
  }

  Future<void> _clearHistoryKeys() async {
    final indexKey = _key('relayune.history-key-scopes.v1');
    final encoded = await _storage.read(key: indexKey);
    if (encoded == null) return;
    for (final scope in (jsonDecode(encoded) as List).cast<String>()) {
      await clearHistoryKey(scope);
    }
    await _storage.delete(key: indexKey);
  }

  Future<void> clearHistoryKey(String scope) =>
      _storage.delete(key: _key('relayune.history-key.v1.$scope'));

  Future<void> saveProjectAliases(Map<String, String> aliases) =>
      _storage.write(key: _key(_projectAliases), value: jsonEncode(aliases));

  Future<void> saveNotificationPrimerSeen() =>
      _storage.write(key: _notificationPrimerSeen, value: 'true');

  Future<void> saveNotificationPermissionRequested() =>
      _storage.write(key: _notificationPermissionRequested, value: 'true');

  Future<void> savePreferredLocale(String? localeTag) => localeTag == null
      ? _storage.delete(key: _preferredLocale)
      : _storage.write(key: _preferredLocale, value: localeTag);

  Future<void> saveOpenedSessionVersions(Map<String, String> versions) =>
      _storage.write(
        key: _key(_openedSessionVersions),
        value: jsonEncode(versions),
      );

  Future<void> savePairing({
    required String contentKey,
    required String deviceId,
    required String browserId,
    required String browserToken,
  }) async {
    final pairing = StoredCredentials(
      contentKey: contentKey,
      deviceId: deviceId,
      browserId: browserId,
      browserToken: browserToken,
    );
    await _writePairingBundle(pairing);
    // Keep the previous keys during the migration window so installing an
    // older signed build does not strand an otherwise valid authorization.
    await Future.wait([
      _storage.write(key: _key(_contentKey), value: contentKey),
      _storage.write(key: _key(_deviceId), value: deviceId),
      _storage.write(key: _key(_browserId), value: browserId),
      _storage.write(key: _key(_browserToken), value: browserToken),
    ]);
  }

  Future<void> _writePairingBundle(StoredCredentials pairing) => _storage.write(
    key: _key(_pairingBundle),
    value: jsonEncode({
      'version': 3,
      'content_key': pairing.contentKey,
      'device_id': pairing.deviceId,
      'browser_id': pairing.browserId,
      'browser_token': pairing.browserToken,
    }),
  );

  Future<void> clearPairing() async {
    await clearHistoryKeys();
    await Future.wait([
      _storage.delete(key: _key(_pairingBundle)),
      _storage.delete(key: _key(_contentKey)),
      _storage.delete(key: _key(_deviceId)),
      _storage.delete(key: _key(_browserId)),
      _storage.delete(key: _key(_browserToken)),
    ]);
  }

  Future<void> clearAll() => _storage.deleteAll();
}

/// Each instance owns a distinct secure-storage namespace. Legacy unprefixed
/// credentials belong only to the official service; they never enter a custom one.
class _InstanceStorage extends FlutterSecureStorage {
  _InstanceStorage(this.base, this.prefix);
  final FlutterSecureStorage base;
  final String prefix;
  bool retired = false;
  final Set<Future<void>> _pendingWrites = {};
  Future<void> drainWrites() async {
    while (_pendingWrites.isNotEmpty) {
      await Future.wait(
        _pendingWrites.toList().map((write) => write.catchError((Object _) {})),
      );
    }
  }

  String scoped(String key) => '$prefix$key';
  bool owns(String key) => prefix.isNotEmpty
      ? key.startsWith(prefix)
      : key.startsWith('relayune.') &&
            !key.startsWith('relayune.instance.') &&
            key != SecureStore._selectedOrigin &&
            key != SecureStore._pendingRetirement;

  @override
  Future<String?> read({
    required String key,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => retired ? null : base.read(key: scoped(key));
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
    if (retired) return;
    final write = base.write(key: scoped(key), value: value);
    _pendingWrites.add(write);
    try {
      await write;
    } finally {
      _pendingWrites.remove(write);
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
  }) => base.delete(key: scoped(key));
  @override
  Future<Map<String, String>> readAll({
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => retired
      ? {}
      : {
          for (final entry in (await base.readAll()).entries)
            if (owns(entry.key))
              entry.key.substring(prefix.length): entry.value,
        };
  @override
  Future<void> deleteAll({
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    for (final key in (await base.readAll()).keys.where(owns).toList()) {
      await base.delete(key: key);
    }
  }
}
