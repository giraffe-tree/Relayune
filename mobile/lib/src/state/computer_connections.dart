import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/widgets.dart';

import '../models.dart';
import '../network/relay_api.dart';
import '../config.dart';
import '../network/instance_endpoint.dart';
import '../notifications/notification_coordinator.dart';
import '../storage/secure_store.dart';
import 'app_controller.dart';

// Local UI/notification identity only. Native IDs on the encrypted wire remain
// unchanged. Authorization is included so old notifications cannot approve a
// request from a newer pairing, even when session/approval IDs are reused.
String computerRoute(String device, String authorization, String id) =>
    'computer:${base64Url.encode(utf8.encode(jsonEncode([device, authorization, id]))).replaceAll('=', '')}';

({String device, String authorization, String id})? parseComputerRoute(
  String value,
) {
  if (!value.startsWith('computer:')) return null;
  try {
    final parts = jsonDecode(
      utf8.decode(base64Url.decode(base64Url.normalize(value.substring(9)))),
    );
    if (parts is! List ||
        parts.length != 3 ||
        parts.any((p) => p is! String || p.isEmpty)) {
      return null;
    }
    return (
      device: parts[0] as String,
      authorization: parts[1] as String,
      id: parts[2] as String,
    );
  } on Object {
    return null;
  }
}

/// Reuses one existing connection controller per computer. No aggregated
/// controller may send commands: conversation routes retain their own owner.
class ComputerConnections extends ChangeNotifier {
  ComputerConnections({
    required this.notifications,
    Locale locale = const Locale('zh', 'CN'),
    SecureStore? store,
    this.controllerFactory,
    this.cleanupApiFactory,
  }) : store = store ?? SecureStore() {
    this.store = this.store.forInstance(
      RelayConfig.activeOrigin,
      official: RelayConfig.usesOfficialService,
    );
    account = _create(this.store, locale);
    _controllers.add(account);
    account.beforeLogout = _beforeLogout;
  }
  final RelayNotificationCoordinator notifications;
  SecureStore store;
  final RelayApi Function(RelayApi)? cleanupApiFactory;
  final AppController Function(
    SecureStore,
    RelayEventNotificationSink,
    RelayNotificationManager,
    Locale,
  )?
  controllerFactory;
  Future<void>? _restoration;
  Future<void> get restored async {
    await _restoration;
  }

  Future<void> initialize({Uri? initialLink}) async {
    try {
      await store.resumeInstanceRetirement(RelayConfig.officialOrigin);
    } catch (_) {
      account.error =
          'Could not finish clearing the previous instance. Retry before signing in.';
      account.phase = AppPhase.unavailable;
      notifyListeners();
      return;
    }
    final selected = await store.selectedInstance();
    if (selected == null) {
      if (account.api.origin != RelayConfig.officialOrigin) {
        // An old build did not bind its unprefixed secrets to any origin. A
        // custom default must never reinterpret or later forward those secrets.
        await store
            .forInstance(RelayConfig.officialOrigin, official: true)
            .retireInstance();
      }
      await store.saveSelectedInstance(
        account.api.origin,
        account.api.certificatePem,
      );
    }
    if (selected != null && selected.origin != account.api.origin) {
      _replaceAccount(selected.origin, selected.certificatePem);
    } else if (selected != null &&
        selected.certificatePem != account.api.certificatePem) {
      _replaceAccount(selected.origin, selected.certificatePem);
    }
    final (lastAccount, saved) = await (
      store.lastAccountEmail(),
      store.read(),
    ).wait;
    if (_disposed) return;
    if (saved.deviceId != null) _deviceIds[account] = saved.deviceId!;
    if (saved.sessionToken != null &&
        lastAccount != null &&
        lastAccount.isNotEmpty) {
      // Stored identity permits local reading only. Each computer independently
      // verifies the account identity and bootstrap before enabling network commands.
      // Start scoped cache restoration before the root's network requests: the
      // root need not have a pairing or a directory cache of its own.
      account.api.sessionToken = saved.sessionToken;
      account.localReadOnly = true;
      account.email = lastAccount;
      _restoredAccount = lastAccount;
      _restoration = _restoreComputers(lastAccount, ++_generation);
      unawaited(_restoration!.catchError((Object _) {}));
    }
    await account.initialize(initialLink: initialLink, credentials: saved);
  }

  late AppController account;
  final List<AppController> _controllers = [];
  final Map<AppController, SecureStore> _stores = {};
  final Map<AppController, VoidCallback> _listeners = {};
  final Map<AppController, String> _deviceIds = {};
  final Map<AppController, String> _names = {};
  String? _restoredAccount;
  bool _disposed = false, _scheduled = false, _loggingOut = false;
  bool _foreground = true;
  bool _memoryReleased = false;
  int _resumeGeneration = 0;
  int _generation = 0;
  AppController? _adding;
  String? _visibleSession;
  AppController? _visibleComputer;
  String? get visibleSession => _visibleSession;
  set visibleSession(String? value) {
    _visibleSession = value;
    _visibleComputer = value == null ? null : resolve(value)?.controller;
    notifications.setActiveSession(value);
  }

  Future<void> Function()? beforeLogout;
  Future<void> Function(AppController)? beforeRemove;

  List<AppController> get controllers => List.unmodifiable(_controllers);
  List<AppController> get computers =>
      _controllers.where((c) => deviceId(c).isNotEmpty).toList();
  List<AppController> get readyComputers =>
      computers.where((c) => c.phase == AppPhase.ready).toList();
  AppPhase get phase {
    if (_switchingInstance) return AppPhase.loading;
    if ({AppPhase.signedOut}.contains(account.phase)) {
      return account.phase;
    }
    return computers.isNotEmpty &&
            account.api.sessionToken != null &&
            _restoredAccount != null
        ? AppPhase.ready
        : account.phase;
  }

  static const colors = <int>[
    0xFFA6E3B9,
    0xFF91BFFF,
    0xFFC4A7EF,
    0xFFF0BB7E,
    0xFFF09CAC,
    0xFF80D9D6,
  ];
  Map<String, int> _colors = {};
  final Map<AppController, int> _pendingColors = {};
  int colorOf(AppController c) =>
      _pendingColors[c] ?? _colors[deviceId(c)] ?? colors[0];
  int get nextColor => colors.firstWhere(
    (value) => !computers.any((c) => colorOf(c) == value),
    orElse: () => colors[computers.length % colors.length],
  );
  Future<void> setColor(AppController c, int color) async {
    if (_disposed || !_stores.containsKey(c) || !colors.contains(color)) return;
    _pendingColors[c] = color;
    if (deviceId(c).isNotEmpty && account.email.isNotEmpty) {
      try {
        await store.saveComputerColor(account.email, deviceId(c), color);
        _colors[deviceId(c)] = color;
        if (_pendingColors[c] == color) _pendingColors.remove(c);
      } on Object {
        // Cosmetic storage failures must not strand a successful pairing.
        c.notice = account.locale.languageCode == 'zh'
            ? '电脑颜色未能保存到手机，重新选择颜色可重试。'
            : 'Could not save the computer color. Choose the color again to retry.';
      }
    }
    if (!_disposed) notifyListeners();
  }

  String deviceId(AppController c) => c.bootstrap?.device.id.isNotEmpty == true
      ? c.bootstrap!.device.id
      : _deviceIds[c] ?? '';
  String name(AppController c) =>
      c.bootstrap?.device.name ??
      _names[c] ??
      (account.locale.languageCode == 'zh' ? '电脑' : 'Computer');
  String route(AppController c, String id) =>
      computerRoute(deviceId(c), c.browserAuthorizationId ?? '', id);

  AppController _create(SecureStore storage, Locale locale) {
    late AppController c;
    final sink = _ComputerEventSink(() => c, notifications);
    c =
        controllerFactory?.call(storage, sink, notifications, locale) ??
        AppController(
          secureStore: storage,
          locale: locale,
          eventNotifications: sink,
          notificationManager: notifications,
        );
    c.removeComputer = () => remove(c);
    c.changeInstance = switchInstance;
    _stores[c] = storage;
    void changed() => _changed(c);
    _listeners[c] = changed;
    c.addListener(changed);
    c.connectionSnapshotListenable.addListener(changed);
    return c;
  }

  void _changed(AppController source) {
    if (_disposed || _loggingOut) return;
    if (_visibleComputer == source) {
      final session = source.activeRootSessionId ?? source.activeSessionId;
      _visibleSession = session == null ? null : route(source, session);
      notifications.setActiveSession(_visibleSession);
    }
    final device = source.bootstrap?.device;
    if (device != null && device.id.isNotEmpty) {
      _deviceIds[source] = device.id;
      _names[source] = device.name;
    }
    if (identical(source, account) &&
        account.email.isNotEmpty &&
        {AppPhase.ready, AppPhase.needsPairing}.contains(account.phase) &&
        _restoredAccount != account.email) {
      _restoredAccount = account.email;
      unawaited(store.saveAccountEmail(account.email));
      _restoration = _restoreComputers(account.email, ++_generation);
      unawaited(_restoration!.catchError((Object _) {}));
    }
    if (identical(source, account) &&
        account.phase == AppPhase.signedOut &&
        _restoredAccount != null) {
      unawaited(_beforeLogout());
    }
    if (source.phase == AppPhase.ready &&
        source == account &&
        _pendingColors.containsKey(source)) {
      final color = _pendingColors.remove(source)!;
      _colors[deviceId(source)] = color;
      unawaited(
        store
            .saveComputerColor(account.email, deviceId(source), color)
            .catchError((Object _) {}),
      );
    }
    if (source.phase == AppPhase.ready) {
      for (final c in _controllers) {
        if (!identical(c, source)) c.copyAccountPreferences(source);
      }
    }
    if (!_scheduled) {
      _scheduled = true;
      scheduleMicrotask(() {
        _scheduled = false;
        if (!_disposed) notifyListeners();
      });
    }
  }

  Future<void> _restoreComputers(String email, int generation) async {
    final (savedColors, scopes) = await (
      store.computerColors(email),
      store.computerScopes(email),
    ).wait;
    if (_disposed || generation != _generation) return;
    _colors = {
      for (final e in savedColors.entries)
        if (colors.contains(e.value)) e.key: e.value,
    };
    await Future.wait(
      scopes.map((scope) async {
        final storage = store.forComputer(scope);
        final saved = await storage.read();
        if (_disposed || generation != _generation || !saved.hasPairing) return;
        if (computers.any((c) => deviceId(c) == saved.deviceId)) return;
        final c = _create(storage, account.locale)..expectedAccount = email;
        c.logoutAccount = account.logout;
        c.deleteAccountForAccount = account.deleteAccount;
        c.addComputer = account.addComputer;
        c.setPresentationForeground(_foreground);
        if (_memoryReleased) c.releaseBackgroundMemory();
        _deviceIds[c] = saved.deviceId!;
        _controllers.add(c);
        await c.initialize(credentials: saved);
        if (!_disposed && generation == _generation) _changed(c);
      }),
    );
    if (_disposed || generation != _generation) return;
    for (final c in computers) {
      if (!_colors.containsKey(deviceId(c))) {
        await setColor(
          c,
          _pendingColors[c] ?? (c == account ? colors[0] : nextColor),
        );
      }
    }
  }

  Future<AppController> beginAdding({bool initialize = true}) async {
    if (_adding != null) return _adding!;
    final random = Random.secure();
    final scope = List.generate(
      16,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    // Index before writing secrets so an interrupted pairing remains tracked.
    await store.rememberComputer(account.email, scope);
    final c = _create(store.forComputer(scope), account.locale)
      ..expectedAccount = account.email;
    _adding = c;
    _pendingColors[c] = nextColor;
    c.logoutAccount = account.logout;
    c.deleteAccountForAccount = account.deleteAccount;
    c.setPresentationForeground(_foreground);
    if (initialize) await c.initialize();
    return c;
  }

  Future<void> finishAdding(AppController c) async {
    if (!identical(_adding, c)) return;
    _adding = null;
    if (c.phase == AppPhase.ready &&
        c.relayKey != null &&
        deviceId(c).isNotEmpty) {
      await setColor(c, colorOf(c));
      final previous = computers
          .where((p) => deviceId(p) == deviceId(c))
          .toList();
      for (final p in previous) {
        await remove(p);
      }
      c.addComputer = account.addComputer;
      _controllers.add(c);
    } else {
      await c.clearPairing();
      await store.forgetComputer(account.email, _stores[c]!.computerScope!);
      _disposeController(c);
    }
    if (!_disposed) notifyListeners();
  }

  Future<void> retry(AppController c) async {
    if (c.phase == AppPhase.loading) return;
    if (c.phase == AppPhase.ready) {
      await c.resumeRealtime();
      return;
    }
    if (c.browserAuthorizationId == null) {
      await account.addComputer?.call();
      return;
    }
    c.pauseRealtime();
    await c.initialize();
  }

  Future<void> remove(AppController c) async {
    await beforeRemove?.call(c);
    await c.clearPairing();
    _deviceIds.remove(c);
    _names.remove(c);
    final scope = _stores[c]?.computerScope;
    if (scope != null) await store.forgetComputer(account.email, scope);
    if (identical(c, account)) {
      c.phase = AppPhase.needsPairing;
      c.bootstrap = null;
    } else {
      _controllers.remove(c);
      _disposeController(c);
    }
    if (!_disposed) notifyListeners();
  }

  ({AppController controller, String sessionId})? resolve(String identity) {
    final parsed = parseComputerRoute(identity);
    if (parsed != null) {
      final c = computers
          .where(
            (c) =>
                deviceId(c) == parsed.device &&
                c.browserAuthorizationId == parsed.authorization,
          )
          .firstOrNull;
      return c == null ? null : (controller: c, sessionId: parsed.id);
    }
    // Pre-upgrade notifications can be opened only when the target is unique.
    if (identity.startsWith('computer:')) return null;
    final matches = readyComputers
        .where((c) => c.sessions.any((s) => s.id == identity))
        .toList();
    return matches.length == 1
        ? (controller: matches.single, sessionId: identity)
        : null;
  }

  List<RelaySession> get notificationSessions => [
    for (final c in readyComputers)
      for (final s in c.sessions)
        RelaySession.fromJson({
          ...s.raw,
          'id': route(c, s.id),
          'root_session_id': route(c, s.rootSessionId),
          'name': computers.length > 1 ? '${name(c)} · ${s.name}' : s.name,
        }),
  ];

  void setForeground(bool foreground) {
    _foreground = foreground;
    ++_resumeGeneration;
    if (foreground) _memoryReleased = false;
    for (final c in [..._controllers, if (_adding != null) _adding!]) {
      c.setPresentationForeground(foreground, resumeTransport: false);
    }
  }

  void releaseBackgroundMemory() {
    if (_foreground || _disposed) return;
    _memoryReleased = true;
    for (final c in [..._controllers, if (_adding != null) _adding!]) {
      c.releaseBackgroundMemory();
    }
  }

  /// Recover the visible conversation before admitting other computers. Yield
  /// between computers and stop an old resume if the user leaves again.
  Future<void> resumeRealtime() async {
    final generation = _resumeGeneration;
    final priority = _visibleComputer ?? account;
    final ordered = [
      if (priority.phase == AppPhase.ready) priority,
      ...readyComputers.where((c) => c != priority),
    ];
    for (final c in ordered) {
      if (_disposed || !_foreground || generation != _resumeGeneration) return;
      await c
          .resumeRealtime(restoreConversation: c == _visibleComputer)
          .catchError((Object _) {});
      await Future<void>.delayed(Duration.zero);
    }
  }

  void _replaceAccount(String origin, String? certificatePem) {
    final previous = account;
    final addComputer = previous.addComputer;
    final locale = previous.locale;
    _controllers.remove(previous);
    _disposeController(previous);
    RelayConfig.activeOrigin = normalizeInstanceOrigin(origin);
    RelayConfig.activeCertificatePem = certificatePem;
    store = store.forInstance(
      origin,
      official: RelayConfig.usesOfficialService,
    );
    account = _create(store, locale)..addComputer = addComputer;
    account.beforeLogout = _beforeLogout;
    _controllers.add(account);
  }

  bool _switchingInstance = false;
  Future<void> switchInstance(String origin, String? certificatePem) async {
    origin = normalizeInstanceOrigin(origin);
    certificateFingerprint(certificatePem);
    if (_switchingInstance || _disposed) return;
    if (origin == account.api.origin &&
        certificatePem == account.api.certificatePem) {
      return;
    }
    _switchingInstance = true;
    notifyListeners();
    final oldStore = store;
    try {
      await oldStore.markInstanceRetirement(account.api.origin);
      _loggingOut = true;
      ++_generation;
      ++_resumeGeneration;
      // Stop commands, subscriptions and previews before clearing native push.
      for (final c in [..._controllers, if (_adding != null) _adding!]) {
        c.pauseRealtime();
      }
      await beforeLogout?.call();
      final cleanup = <AppController, RelayApi>{
        for (final c in [..._controllers, if (_adding != null) _adding!])
          c:
              (cleanupApiFactory?.call(c.api) ??
                    RelayApi(
                      origin: c.api.origin,
                      certificatePem: c.api.certificatePem ?? '',
                    ))
                ..sessionToken = c.api.sessionToken
                ..browserToken = c.api.browserToken,
      };
      // Cancel old in-flight HTTP and prevent stale UI callbacks from issuing
      // another request. Cleanup clients retain only the old confirmed origin.
      for (final c in cleanup.keys) {
        c.api.close();
      }
      try {
        // An unreachable old service must not multiply the timeout by the
        // computer count. Remote cleanup is best effort within one budget.
        final remoteCleanup = () async {
          await Future.wait(
            cleanup.values.map(
              (api) => api.revokeOwnAuthorization().catchError((Object _) {}),
            ),
          );
          await cleanup[account]!.logout().catchError((Object _) {});
        }();
        await remoteCleanup.timeout(
          const Duration(seconds: 3),
          onTimeout: () {},
        );
      } finally {
        for (final api in cleanup.values) {
          api.close();
        }
      }
      for (final c in cleanup.keys) {
        await c.flushHistoryCache();
        await c.clearPairing();
      }
      for (final c in [
        ..._controllers.where((c) => c != account),
        if (_adding != null) _adding!,
      ]) {
        _controllers.remove(c);
        _disposeController(c);
      }
      _adding = null;
      _restoredAccount = null;
      _colors.clear();
      _pendingColors.clear();
      visibleSession = null;
      // Persist the target only after old credentials are erased. If an OS
      // storage operation fails, remain signed out on the old instance.
      final originBefore = account.api.origin;
      final certificateBefore = account.api.certificatePem;
      _replaceAccount(origin, certificatePem);
      try {
        await oldStore.retireInstance();
        await store.saveSelectedInstance(origin, certificatePem);
        await store.finishInstanceRetirement();
      } catch (_) {
        _replaceAccount(originBefore, certificateBefore);
        account.phase = AppPhase.signedOut;
        rethrow;
      }
      await account.initialize();
    } catch (_) {
      account.phase = AppPhase.unavailable;
      account.error = account.locale.languageCode == 'zh'
          ? '实例切换未能完成。请重启应用以重试安全清理，或重新选择服务实例。'
          : 'Instance switching could not finish. Restart to retry secure cleanup, or select the server again.';
      rethrow;
    } finally {
      _loggingOut = false;
      _switchingInstance = false;
      if (!_disposed) notifyListeners();
    }
  }

  Future<void> _beforeLogout() async {
    _loggingOut = true;
    ++_generation;
    try {
      await beforeLogout?.call();
      for (final c in _controllers.where((c) => c != account).toList()) {
        c.pauseRealtime();
        await c.flushHistoryCache().catchError((Object _) {});
        await c.clearLocalHistoryKeys().catchError((Object _) {});
        _controllers.remove(c);
        _disposeController(c);
      }
      if (_adding != null) {
        final c = _adding!;
        _adding = null;
        await c.clearPairing().catchError((Object _) {});
        _disposeController(c);
      }
      _deviceIds.remove(account);
      _names.remove(account);
      _restoredAccount = null;
      _colors.clear();
      _pendingColors.clear();
      visibleSession = null;
    } finally {
      _loggingOut = false;
    }
  }

  void _disposeController(AppController c) {
    _pendingColors.remove(c);
    final listener = _listeners.remove(c);
    if (listener != null) {
      c.removeListener(listener);
      c.connectionSnapshotListenable.removeListener(listener);
    }
    _stores.remove(c);
    _deviceIds.remove(c);
    _names.remove(c);
    c.dispose();
  }

  @override
  void dispose() {
    _disposed = true;
    ++_generation;
    for (final c in [..._controllers, if (_adding != null) _adding!]) {
      _disposeController(c);
    }
    super.dispose();
  }
}

class _ComputerEventSink implements RelayEventNotificationSink {
  _ComputerEventSink(this.controller, this.target);
  final AppController Function() controller;
  final RelayEventNotificationSink target;
  @override
  void handleDecryptedEvent(RelayEvent record, {bool isRootSession = true}) {
    final device = controller().bootstrap?.device.id,
        authorization = controller().browserAuthorizationId;
    if (device == null || device.isEmpty || authorization == null) return;
    String id(String value) => computerRoute(device, authorization, value);
    target.handleDecryptedEvent(
      RelayEvent(
        cursor: record.cursor,
        eventId: id(record.eventId),
        sessionId: id(record.sessionId),
        agentId: record.agentId,
        createdAt: record.createdAt,
        event: {
          ...record.event,
          for (final field in ['session_id', 'root_session_id', 'approval_id'])
            if (record.event[field] is String &&
                (record.event[field] as String).isNotEmpty)
              field: id(record.event[field] as String),
        },
      ),
      isRootSession: isRootSession,
    );
  }
}
