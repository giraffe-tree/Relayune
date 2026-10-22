import 'dart:async';

import 'package:flutter/widgets.dart';

/// Cancels UI timers while the app is inactive instead of waking up to skip
/// their callbacks. Elapsed labels derive their time from the clock on resume.
class ForegroundPeriodicTimer with WidgetsBindingObserver {
  ForegroundPeriodicTimer(this.interval, this.onTick) {
    WidgetsBinding.instance.addObserver(this);
    _sync(WidgetsBinding.instance.lifecycleState);
  }

  final Duration interval;
  final VoidCallback onTick;
  Timer? _timer;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) => _sync(state);

  void _sync(AppLifecycleState? state) {
    _timer?.cancel();
    _timer = state == null || state == AppLifecycleState.resumed
        ? Timer.periodic(interval, (_) => onTick())
        : null;
  }

  void cancel() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _timer = null;
  }
}
