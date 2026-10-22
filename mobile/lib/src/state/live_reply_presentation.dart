import 'dart:async';
import 'dart:collection';
import 'dart:math' as math;

import 'package:characters/characters.dart';
import 'package:flutter/foundation.dart';

/// Keeps authoritative reply text separate from the short-lived text shown by
/// the active conversation. Transport processing never waits for this layer.
class LiveReplyRegistry extends ChangeNotifier {
  LiveReplyRegistry({DateTime Function()? now}) : _now = now ?? DateTime.now;

  static const int _maximumEntries = 64;

  final DateTime Function() _now;
  final Map<String, _LiveReplyEntry> _entries = {};
  bool _disposed = false;
  bool _foreground = true;

  void setForeground(bool foreground) {
    _foreground = foreground;
    for (final entry in _entries.values.toList()) {
      entry.presentation.setForeground(foreground);
    }
  }

  LiveReplyPresentation? listenableFor(String sessionId, String messageId) =>
      _entries[_entryKey(sessionId, messageId)]?.presentation;

  void append({
    required String sessionId,
    required String turnId,
    required String messageId,
    required String text,
    required String createdAt,
    String initialText = '',
  }) {
    if (_disposed || text.isEmpty) return;
    final presentation = _entryFor(
      sessionId: sessionId,
      turnId: turnId,
      messageId: messageId,
      initialText: initialText,
    ).presentation;
    presentation.append(text, eventCreatedAt: _parseTime(createdAt));
  }

  void complete({
    required String sessionId,
    required String turnId,
    required String messageId,
    required String text,
    required String createdAt,
  }) {
    if (_disposed) return;
    final presentation = _entryFor(
      sessionId: sessionId,
      turnId: turnId,
      messageId: messageId,
    ).presentation;
    presentation.complete(text, eventCreatedAt: _parseTime(createdAt));
  }

  void completeTurn(String sessionId, String turnId) {
    if (_disposed) return;
    for (final entry
        in _entries.values
            .where(
              (entry) => entry.sessionId == sessionId && entry.turnId == turnId,
            )
            .toList()) {
      entry.presentation.markTerminal();
    }
  }

  void retainSession(String sessionId) {
    if (_disposed) return;
    final staleKeys = [
      for (final entry in _entries.entries)
        if (entry.value.sessionId != sessionId) entry.key,
    ];
    for (final key in staleKeys) {
      _entries.remove(key)?.presentation.abandon();
    }
  }

  /// History has already merged newer live versions into its snapshot. Retire
  /// their reveal objects so a suspended animation cannot hide recovered text.
  void resetSession(String sessionId) {
    if (_disposed) return;
    final keys = [
      for (final entry in _entries.entries)
        if (entry.value.sessionId == sessionId) entry.key,
    ];
    for (final key in keys) {
      _entries.remove(key)?.presentation.abandon();
    }
  }

  void clear() {
    for (final entry in _entries.values) {
      entry.presentation.dispose();
    }
    _entries.clear();
  }

  _LiveReplyEntry _entryFor({
    required String sessionId,
    required String turnId,
    required String messageId,
    String initialText = '',
  }) {
    final key = _entryKey(sessionId, messageId);
    final existing = _entries[key];
    if (existing != null) return existing;
    _evictDetachedEntries();
    late final LiveReplyPresentation presentation;
    presentation = LiveReplyPresentation(
      initialText: initialText,
      now: _now,
      onPresented: _notifyPresented,
      onSettled: () {
        final current = _entries[key];
        if (identical(current?.presentation, presentation)) {
          _entries.remove(key);
        }
      },
    );
    presentation.setForeground(_foreground);
    final entry = _LiveReplyEntry(
      sessionId: sessionId,
      turnId: turnId,
      presentation: presentation,
    );
    _entries[key] = entry;
    return entry;
  }

  void _evictDetachedEntries() {
    if (_entries.length < _maximumEntries) return;
    final removable = [
      for (final entry in _entries.entries)
        if (!entry.value.presentation.attached) entry.key,
    ];
    for (final key in removable) {
      _entries.remove(key)?.presentation.dispose();
      if (_entries.length < _maximumEntries) return;
    }
  }

  DateTime? _parseTime(String value) => DateTime.tryParse(value)?.toLocal();

  void _notifyPresented() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    clear();
    super.dispose();
  }
}

/// Reveals real model deltas on a bounded cadence. It does not synthesize
/// content and always converges to the authoritative completed text.
class LiveReplyPresentation extends ChangeNotifier
    implements ValueListenable<String> {
  LiveReplyPresentation({
    String initialText = '',
    DateTime Function()? now,
    VoidCallback? onPresented,
    VoidCallback? onSettled,
  }) : _now = now ?? DateTime.now,
       _onPresented = onPresented,
       _onSettled = onSettled,
       _target = initialText,
       _value = initialText;

  static const Duration frameInterval = Duration(milliseconds: 40);
  static const Duration catchUpWindow = Duration(milliseconds: 320);
  static const Duration completionWindow = Duration(milliseconds: 240);
  // Event timestamps originate on the paired computer. A generous threshold
  // tolerates normal clock skew while still avoiding replay after recovery.
  static const Duration staleEventThreshold = Duration(seconds: 30);
  static const int maximumAnimatedGraphemes = 4000;

  final DateTime Function() _now;
  final VoidCallback? _onPresented;
  final VoidCallback? _onSettled;
  final Queue<String> _pending = Queue<String>();

  Timer? _timer;
  DateTime? _latestEventAt;
  DateTime? _lastPresentedAt;
  DateTime? _deadline;
  String _target;
  String _value;
  int _listenerCount = 0;
  bool _terminal = false;
  bool _everAttached = false;
  bool _disposed = false;
  bool _foreground = true;

  void setForeground(bool foreground) {
    if (_disposed || _foreground == foreground) return;
    _foreground = foreground;
    // Keep the latest text without spending CPU on invisible reveal frames.
    _snap(notify: false);
    if (foreground) _publish();
  }

  @override
  String get value => _value;

  bool get attached => _listenerCount > 0;

  /// True only when the authoritative completion has arrived and every
  /// pending grapheme has been presented.
  bool get isSettled => _terminal && _pending.isEmpty;

  void append(String text, {DateTime? eventCreatedAt}) {
    if (_disposed || text.isEmpty) return;
    final wasEmpty = _pending.isEmpty;
    _target += text;
    _latestEventAt = eventCreatedAt ?? _now();
    if (!_foreground) {
      _snap(notify: false);
      return;
    }
    _pending.addAll(text.characters);
    _deadline = _now().add(catchUpWindow);
    if (_shouldSnap()) {
      _snap(notify: attached);
      return;
    }
    if (!attached) return;
    if (wasEmpty && _timer == null && _untilNextFrame == Duration.zero) {
      _reveal(maximum: 1, notify: true);
    }
    _schedule();
  }

  void complete(String text, {DateTime? eventCreatedAt}) {
    if (_disposed) return;
    _terminal = true;
    _latestEventAt = eventCreatedAt ?? _now();
    if (!_foreground) {
      _target = text;
      _snap(notify: false);
      return;
    }
    final corrected = _replaceTarget(text);
    _deadline = _now().add(completionWindow);
    if (!attached) {
      if (_shouldSnap()) {
        _snap(notify: false);
      } else if (_pending.isEmpty) {
        _onSettled?.call();
      }
      return;
    }
    if (corrected) {
      _publish();
      _onSettled?.call();
      return;
    }
    if (_shouldSnap()) {
      _snap(notify: true);
      return;
    }
    if (_pending.isEmpty) {
      // The text itself did not change, but listeners still need one terminal
      // publication so expensive final rendering can replace the lightweight
      // streaming presentation.
      _publish();
      _onSettled?.call();
      return;
    }
    _scheduleOrSettle();
  }

  void markTerminal() {
    if (_disposed) return;
    _terminal = true;
    _deadline = _now().add(completionWindow);
    if (attached && _pending.isEmpty) {
      _publish();
      _onSettled?.call();
      return;
    }
    _scheduleOrSettle();
  }

  void abandon() {
    _timer?.cancel();
    _timer = null;
    _pending.clear();
    _value = _target;
  }

  @override
  void addListener(VoidCallback listener) {
    if (_disposed) return;
    super.addListener(listener);
    _listenerCount += 1;
    if (_listenerCount != 1 || _pending.isEmpty) return;
    if (_shouldSnap()) {
      _snap(notify: true);
      return;
    }
    if (!_everAttached) {
      _everAttached = true;
      _deadline = _now().add(_terminal ? completionWindow : catchUpWindow);
    }
    _reveal(maximum: 1, notify: true);
    _scheduleOrSettle();
  }

  @override
  void removeListener(VoidCallback listener) {
    if (_disposed) return;
    super.removeListener(listener);
    _listenerCount = math.max(0, _listenerCount - 1);
    if (_listenerCount == 0) {
      _timer?.cancel();
      _timer = null;
    }
  }

  bool _replaceTarget(String text) {
    _target = text;
    _pending.clear();
    if (!text.startsWith(_value)) {
      final changed = _value != text;
      _value = text;
      return changed;
    }
    _pending.addAll(text.substring(_value.length).characters);
    return false;
  }

  void _scheduleOrSettle() {
    if (_pending.isNotEmpty) {
      _schedule();
    } else if (_terminal) {
      _onSettled?.call();
    }
  }

  void _schedule() {
    if (_disposed ||
        !_foreground ||
        !attached ||
        _pending.isEmpty ||
        _timer != null) {
      return;
    }
    _timer = Timer(_untilNextFrame, _tick);
  }

  // A one-character upstream delta used to bypass the timer whenever the
  // queue was empty, allowing transport frequency to dictate UI rebuilds.
  Duration get _untilNextFrame {
    final last = _lastPresentedAt;
    if (last == null) return Duration.zero;
    final remaining = frameInterval - _now().difference(last);
    return remaining.isNegative ? Duration.zero : remaining;
  }

  void _tick() {
    _timer = null;
    if (_disposed || !attached || _pending.isEmpty) return;
    if (_shouldSnap()) {
      _snap(notify: true);
      return;
    }
    final now = _now();
    final remainingMs = math.max(
      1,
      (_deadline ?? now).difference(now).inMilliseconds,
    );
    final remainingTicks = math.max(
      1,
      (remainingMs / frameInterval.inMilliseconds).ceil(),
    );
    final revealCount = math.max(1, (_pending.length / remainingTicks).ceil());
    _reveal(maximum: revealCount, notify: true);
    _scheduleOrSettle();
  }

  void _reveal({required int maximum, required bool notify}) {
    if (_pending.isEmpty) return;
    final addition = StringBuffer();
    for (var index = 0; index < maximum && _pending.isNotEmpty; index += 1) {
      addition.write(_pending.removeFirst());
    }
    _value += addition.toString();
    if (notify) _publish();
  }

  bool _shouldSnap() {
    if (_pending.length > maximumAnimatedGraphemes) return true;
    final eventAt = _latestEventAt;
    if (eventAt == null) return false;
    return _now().difference(eventAt) > staleEventThreshold;
  }

  void _snap({required bool notify}) {
    _timer?.cancel();
    _timer = null;
    _pending.clear();
    final changed = _value != _target;
    _value = _target;
    if (notify && changed) _publish();
    if (_terminal) _onSettled?.call();
  }

  void _publish() {
    if (_disposed) return;
    _lastPresentedAt = _now();
    notifyListeners();
    _onPresented?.call();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _timer = null;
    _pending.clear();
    super.dispose();
  }
}

class _LiveReplyEntry {
  const _LiveReplyEntry({
    required this.sessionId,
    required this.turnId,
    required this.presentation,
  });

  final String sessionId;
  final String turnId;
  final LiveReplyPresentation presentation;
}

String _entryKey(String sessionId, String messageId) =>
    '$sessionId\u0000$messageId';
