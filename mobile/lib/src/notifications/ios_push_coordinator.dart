import 'dart:async';
import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import '../crypto/e2ee.dart';
import '../network/relay_api.dart';

String deriveIosPushKey(RelayKey key) {
  final extracted = Hmac(sha256, List.filled(32, 0)).convert(key.bytes).bytes;
  final expanded = Hmac(
    sha256,
    extracted,
  ).convert([...utf8.encode('relayune.ios.push.v1'), 1]).bytes;
  return base64Url.encode(expanded).replaceAll('=', '');
}

class IosPushComputer {
  const IosPushComputer({
    required this.api,
    required this.deviceId,
    required this.browserId,
    required this.key,
  });
  final RelayApi api;
  final String deviceId, browserId;
  final RelayKey key;
}

class IosPushCoordinator {
  IosPushCoordinator({
    required this.api,
    required this.onOpen,
    this.channel = const MethodChannel('cn.giraffetree.relayune/ios_push'),
  }) {
    channel.setMethodCallHandler((call) async {
      if (call.method == 'changed') _schedule();
    });
  }
  final RelayApi api;
  final void Function(String) onOpen;
  final MethodChannel channel;
  final Map<String, ({RelayApi api, Map<String, dynamic> binding})> _desired =
      {};
  final Map<String, ({RelayApi api, String fingerprint, DateTime at})>
  _registered = {};
  final Map<String, RelayApi> _clearPending = {};
  Future<void> _work = Future.value();
  bool _disposed = false;
  bool _foreground = true;
  int _generation = 0;
  String? _nativeFingerprint;
  DateTime? _lastAttempt;

  void configure({
    required bool enabled,
    required bool clear,
    required String? deviceId,
    required RelayKey? key,
    required Map<String, String> labels,
  }) => configureComputers(
    enabled: enabled,
    clear: clear,
    labels: labels,
    computers: deviceId != null && key != null
        ? [
            IosPushComputer(
              api: api,
              deviceId: deviceId,
              browserId: '',
              key: key,
            ),
          ]
        : const [],
  );

  void configureComputers({
    required bool enabled,
    required bool clear,
    required List<IosPushComputer> computers,
    required Map<String, String> labels,
  }) {
    if (_disposed || (!enabled && !clear)) return;
    if (!enabled && clear) {
      for (final computer in computers) {
        _clearPending[computer.deviceId] = computer.api;
      }
    }
    final next = <String, ({RelayApi api, Map<String, dynamic> binding})>{};
    if (enabled) {
      for (final computer in computers) {
        final derived = deriveIosPushKey(computer.key);
        final bytes = base64Url.decode(base64Url.normalize(derived));
        next[computer.deviceId] = (
          api: computer.api,
          binding: {
            'deviceId': computer.deviceId,
            'browserId': computer.browserId,
            'key': derived,
            'kid':
                'sha256:${base64Url.encode(sha256.convert(bytes).bytes).replaceAll('=', '')}',
            'labels': labels,
          },
        );
      }
    }
    final changed =
        jsonEncode(next.values.map((v) => v.binding).toList()) !=
        jsonEncode(_desired.values.map((v) => v.binding).toList());
    _desired
      ..clear()
      ..addAll(next);
    if (changed || _clearPending.isNotEmpty) {
      _generation++;
      _schedule();
    } else if (_lastAttempt == null ||
        DateTime.now().difference(_lastAttempt!) > const Duration(minutes: 1)) {
      _schedule();
    }
  }

  void setForeground(bool foreground) {
    if (_disposed || _foreground == foreground) return;
    _foreground = foreground;
    _generation++;
    if (foreground) _schedule();
  }

  void _schedule() {
    if (_disposed || !_foreground) return;
    _work = _work.then((_) async {
      if (_disposed || !_foreground) return;
      final generation = _generation, desired = Map.of(_desired);
      _lastAttempt = DateTime.now();
      try {
        final bindings = desired.values.map((v) => v.binding).toList();
        final fingerprint = jsonEncode(bindings);
        if (_nativeFingerprint != fingerprint) {
          await channel.invokeMethod<void>(
            'configure',
            bindings.isEmpty ? null : {'bindings': bindings},
          );
          if (generation != _generation || _disposed || !_foreground) return;
          _nativeFingerprint = fingerprint;
          if (bindings.isNotEmpty) await channel.invokeMethod<void>('register');
        }
        final session = await channel.invokeMethod<String>('takeOpen');
        if (session != null && session.isNotEmpty && !_disposed) {
          onOpen(session);
        }
        if (generation != _generation || _disposed || !_foreground) return;
        for (final entry in _clearPending.entries.toList()) {
          if (desired.containsKey(entry.key)) {
            _clearPending.remove(entry.key);
            continue;
          }
          try {
            await entry.value.registerIosPush(entry.key, {'enabled': false});
            _clearPending.remove(entry.key);
            _registered.remove(entry.key);
          } on Object {
            /* Retry without blocking another computer. */
          }
        }
        for (final device in _registered.keys.toList()) {
          if (!desired.containsKey(device)) {
            try {
              await _registered[device]!.api.registerIosPush(device, {
                'enabled': false,
              });
            } on Object {
              continue;
            }
            _registered.remove(device);
          }
        }
        if (desired.isEmpty) return;
        final snapshot = await channel.invokeMapMethod<String, dynamic>(
          'snapshot',
        );
        if (generation != _generation ||
            _disposed ||
            !_foreground ||
            snapshot?['token'] is! String) {
          return;
        }
        for (final entry in desired.entries) {
          final device = entry.key, target = entry.value;
          final activities = (snapshot!['activities'] as List? ?? const [])
              .whereType<Map>()
              .where(
                (a) =>
                    a['deviceId'] == device ||
                    (desired.length == 1 && a['deviceId'] == null),
              )
              .map((a) => {'route': a['route'], 'token': a['token']})
              .take(8)
              .toList();
          final body = {
            ...snapshot,
            'activities': activities,
            'enabled': true,
            'push_key_id': target.binding['kid'],
          };
          final fp = jsonEncode(body), registered = _registered[device];
          if (registered?.fingerprint == fp &&
              DateTime.now().difference(registered!.at) <
                  const Duration(hours: 12)) {
            continue;
          }
          try {
            await target.api.registerIosPush(device, body);
            _registered[device] = (
              api: target.api,
              fingerprint: fp,
              at: DateTime.now(),
            );
            if (generation != _generation || _disposed || !_foreground) return;
          } on Object {
            /* Retry this computer independently. */
          }
        }
      } on Object {
        /* Never log native tokens or key material. */
      }
    });
  }

  Future<void> remove(String deviceId) async {
    final target = _desired.remove(deviceId);
    if (target != null) _clearPending[deviceId] = target.api;
    _generation++;
    _schedule();
    await settled;
  }

  Future<void> stop() async {
    _clearPending.addAll(
      _desired.map((id, target) => MapEntry(id, target.api)),
    );
    _desired.clear();
    _generation++;
    _schedule();
    await settled;
  }

  Future<void> get settled => _work;
  void dispose() {
    _disposed = true;
    _desired.clear();
    _registered.clear();
    _clearPending.clear();
    _nativeFingerprint = null;
    channel.setMethodCallHandler(null);
  }
}
