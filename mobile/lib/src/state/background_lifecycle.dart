import 'dart:async';

import 'package:flutter/widgets.dart';

/// Time changes the cache policy, never the permission to keep syncing.
/// A Dart timer cannot wake a suspended app; resume also checks the deadline.
class BackgroundLifecycle extends ChangeNotifier {
  BackgroundLifecycle({
    required this.onBackground,
    required this.onReleaseMemory,
    required this.onResume,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  static const warmDuration = Duration(minutes: 5);
  final VoidCallback onBackground, onReleaseMemory;
  final void Function(Duration away) onResume;
  final DateTime Function() _now;
  DateTime? _leftAt;
  Timer? _deadline;
  bool _released = false, _disposed = false;
  bool _visible = true;
  bool get visible => _visible;
  bool get background => _leftAt != null;
  bool get memoryReleased => _released;

  void handle(AppLifecycleState state) {
    if (_disposed) return;
    _visible = state == AppLifecycleState.resumed;
    if (state == AppLifecycleState.resumed) {
      final left = _leftAt;
      if (left != null) {
        final elapsed = _now().difference(left);
        if (elapsed >= warmDuration) _release();
        _deadline?.cancel();
        _deadline = null;
        _leftAt = null;
        _released = false;
        onResume(elapsed.isNegative ? Duration.zero : elapsed);
      }
    } else if (state != AppLifecycleState.inactive && _leftAt == null) {
      _leftAt = _now();
      onBackground();
      _deadline = Timer(warmDuration, _release);
    }
    notifyListeners();
  }

  void memoryPressure() {
    if (!_disposed && background) _release();
  }

  void _release() {
    if (_disposed || !background || _released) return;
    _deadline?.cancel();
    _deadline = null;
    _released = true;
    onReleaseMemory();
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _deadline?.cancel();
    super.dispose();
  }
}
