import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

enum RelayHapticEvent { connected, decisionConfirmed, stopConfirmed }

/// Acknowledges a small number of confirmed, foreground user actions.
/// Tickets are transient and invalidated when the app loses focus, so delayed
/// network events, recovery and duplicate delivery cannot replay a vibration.
class RelayHaptics with WidgetsBindingObserver {
  RelayHaptics({Future<void> Function(RelayHapticEvent)? play})
    : _play = play ?? _platformPlay {
    try {
      _binding = WidgetsBinding.instance;
    } on Object {
      // Pure controller tests need no platform binding.
    }
    _binding?.addObserver(this);
    final state = _binding?.lifecycleState;
    _foreground = state == null || state == AppLifecycleState.resumed;
  }

  WidgetsBinding? _binding;
  final Future<void> Function(RelayHapticEvent) _play;
  final Set<int> _pending = {};
  int _nextTicket = 0;
  bool _enabled = true;
  bool _foreground = true;
  bool _disposed = false;

  bool get enabled => _enabled;
  set enabled(bool value) {
    _enabled = value;
    if (!value) _pending.clear();
  }

  int? begin() {
    if (!_enabled || !_foreground || _disposed) return null;
    if (_pending.length >= 64) _pending.remove(_pending.first);
    final ticket = ++_nextTicket;
    _pending.add(ticket);
    return ticket;
  }

  void cancel(int? ticket) => _pending.remove(ticket);

  void cancelAll() => _pending.clear();

  void confirm(int? ticket, RelayHapticEvent event) {
    if (!_pending.remove(ticket) || !_enabled || !_foreground || _disposed) {
      return;
    }
    unawaited(_playSafely(event));
  }

  Future<void> _playSafely(RelayHapticEvent event) async {
    try {
      await _play(event);
    } on Object {
      // Optional feedback must never affect the confirmed operation.
    }
  }

  static Future<void> _platformPlay(RelayHapticEvent event) => switch (event) {
    RelayHapticEvent.connected => HapticFeedback.mediumImpact(),
    RelayHapticEvent.decisionConfirmed ||
    RelayHapticEvent.stopConfirmed => HapticFeedback.lightImpact(),
  };

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (!_foreground) _pending.clear();
  }

  void dispose() {
    _disposed = true;
    _pending.clear();
    _binding?.removeObserver(this);
  }
}
