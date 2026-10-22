import 'dart:async';
import 'package:flutter/services.dart';
import '../network/relay_api.dart';

/// Credentials stay in memory and are snapshotted for each account binding.
/// Native push stores only the user's enabled preference, never relay keys.
class AndroidPushAccount {
  const AndroidPushAccount({
    required this.origin,
    required this.deviceId,
    required this.sessionToken,
    required this.browserToken,
    required this.locale,
  });
  final String origin, deviceId, sessionToken, browserToken, locale;
  bool sameAs(AndroidPushAccount other) =>
      origin == other.origin &&
      deviceId == other.deviceId &&
      sessionToken == other.sessionToken &&
      browserToken == other.browserToken &&
      locale == other.locale;
}

typedef PushRegistrationWriter =
    Future<void> Function(AndroidPushAccount account, String? registration);

class AndroidPushCoordinator {
  AndroidPushCoordinator({
    MethodChannel? channel,
    PushRegistrationWriter? write,
    this.onBindingChanged,
    DateTime Function()? now,
  }) : _channel =
           channel ?? const MethodChannel('cn.giraffetree.relayune/push'),
       _write = write ?? _writeRegistration,
       _now = now ?? DateTime.now {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'registrationChanged') refresh(resetRetryBudget: true);
    });
  }
  final void Function(bool active)? onBindingChanged;
  final MethodChannel _channel;
  final PushRegistrationWriter _write;
  final DateTime Function() _now;
  bool _foreground = true;
  bool? _configuredEnabled;
  int _retryAttempts = 0;
  static const maxRetryAttempts = 3;
  final Map<String, AndroidPushAccount> _cleared = {};
  Timer? _timer;
  List<AndroidPushAccount> _desired = const [];
  final Map<
    String,
    ({AndroidPushAccount account, String registration, DateTime renewed})
  >
  _registered = {};
  Future<void>? _operation;
  bool _again = false, _disposed = false;
  bool _enabled = false;
  DateTime? _retryAfter;

  static Future<void> _writeRegistration(
    AndroidPushAccount account,
    String? registration,
  ) async {
    final api = RelayApi(origin: account.origin)
      ..sessionToken = account.sessionToken
      ..browserToken = account.browserToken;
    try {
      await api.registerAndroidPush(
        deviceId: account.deviceId,
        registrationId: registration,
        locale: account.locale,
      );
    } finally {
      api.close();
    }
  }

  void update(AndroidPushAccount? account, {bool enabled = true}) =>
      updateAll(account == null ? const [] : [account], enabled: enabled);

  void updateAll(List<AndroidPushAccount> accounts, {bool enabled = true}) {
    if (_enabled == enabled &&
        accounts.length == _desired.length &&
        List.generate(
          accounts.length,
          (i) => accounts[i].sameAs(_desired[i]),
        ).every((v) => v)) {
      return;
    }
    _desired = List.unmodifiable(accounts);
    _enabled = enabled;
    onBindingChanged?.call(false);
    refresh(resetRetryBudget: true);
  }

  void refresh({bool resetRetryBudget = false}) {
    if (_disposed) return;
    if (resetRetryBudget) {
      _retryAttempts = 0;
      _retryAfter = null;
      _timer?.cancel();
      _timer = null;
    }
    if (!_foreground) return;
    if (_operation != null) {
      _again = true;
      return;
    }
    if (_retryAfter?.isAfter(_now()) == true) return;
    _operation = _sync().catchError((Object _) => _retry()).whenComplete(() {
      _operation = null;
      if (_again) {
        _again = false;
        refresh();
      }
    });
  }

  void setForeground(bool foreground) {
    if (_disposed || _foreground == foreground) return;
    _foreground = foreground;
    _timer?.cancel();
    _timer = null;
    if (foreground) refresh(resetRetryBudget: true);
  }

  void _retry() {
    _timer?.cancel();
    _timer = null;
    if (!_foreground || _disposed || _retryAttempts >= maxRetryAttempts) return;
    final delay = Duration(minutes: 1 << _retryAttempts++);
    _retryAfter = _now().add(delay);
    _timer = Timer(delay, refresh);
  }

  String _accountKey(AndroidPushAccount account) =>
      '${account.origin}\u0000${account.deviceId}';

  Future<void> _clear(AndroidPushAccount account) async {
    final key = _accountKey(account);
    if (_cleared[key]?.sameAs(account) == true) return;
    await _write(account, null);
    _cleared[key] = account;
  }

  Future<void> _sync() async {
    final desired = _desired, enabled = _enabled;
    final targets = enabled ? desired : <AndroidPushAccount>[];
    if (_configuredEnabled != targets.isNotEmpty) {
      await _channel.invokeMethod<void>('configure', {
        'enabled': targets.isNotEmpty,
      });
      _configuredEnabled = targets.isNotEmpty;
    }
    if (_disposed || !_foreground) return;
    var failed = false;
    for (final entry in _registered.entries.toList()) {
      if (!targets.any((a) => a.sameAs(entry.value.account))) {
        try {
          await _clear(entry.value.account);
          _registered.remove(entry.key);
          if (!_foreground || _disposed) return;
        } on Object {
          failed = true;
        }
      }
    }
    // Also clear a persisted registration after an app restart/opt-out.
    if (!enabled) {
      for (final account in desired) {
        try {
          await _clear(account);
          if (!_foreground || _disposed) return;
        } on Object {
          failed = true;
        }
      }
      if (failed) _retry();
      return;
    }
    final registration = await _channel.invokeMethod<String>('registration');
    if (_disposed ||
        !_foreground ||
        !identical(desired, _desired) ||
        enabled != _enabled) {
      _again = true;
      return;
    }
    if (registration == null || registration.isEmpty) return;
    var allRegistered = !failed;
    for (final account in targets) {
      final accountKey = _accountKey(account);
      final existing = _registered[accountKey];
      if (existing != null &&
          existing.account.sameAs(account) &&
          existing.registration == registration &&
          _now().difference(existing.renewed) < const Duration(hours: 6)) {
        continue;
      }
      try {
        await _write(account, registration);
        _cleared.remove(accountKey);
        _registered[accountKey] = (
          account: account,
          registration: registration,
          renewed: _now(),
        );
      } on Object {
        allRegistered = false;
      }
      if (_disposed || !_foreground || !identical(desired, _desired)) {
        _again = true;
        return;
      }
    }
    if (!allRegistered) {
      _retry();
    }
    onBindingChanged?.call(allRegistered && targets.isNotEmpty);
    if (allRegistered && targets.isNotEmpty && _foreground && !_disposed) {
      _retryAttempts = 0;
      _retryAfter = null;
      final due = _registered.values
          .map((entry) => entry.renewed.add(const Duration(hours: 6)))
          .reduce((a, b) => a.isBefore(b) ? a : b);
      _timer?.cancel();
      final remaining = due.difference(_now());
      _timer = Timer(remaining.isNegative ? Duration.zero : remaining, refresh);
    }
  }

  Future<void> get settled async {
    while (_operation != null) {
      await _operation;
    }
  }

  Future<void> remove(String deviceId) async {
    updateAll(
      _desired.where((a) => a.deviceId != deviceId).toList(),
      enabled: _enabled,
    );
    await settled;
  }

  Future<void> stop() async {
    onBindingChanged?.call(false);
    _timer?.cancel();
    _timer = null;
    await _channel.invokeMethod<void>('configure', {'enabled': false});
    _configuredEnabled = false;
    updateAll(const [], enabled: false);
    _retryAfter = null;
    refresh();
    await settled;
  }

  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _desired = const [];
    _registered.clear();
    _cleared.clear();
    _channel.setMethodCallHandler(null);
  }
}
