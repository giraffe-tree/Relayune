import 'dart:async';

/// Foreground-only connection supervision. Business traffic never awaits a retry.
class AutomaticRouteSupervisor {
  AutomaticRouteSupervisor({
    required this.canConnect,
    required this.isDirect,
    required this.connect,
    required this.check,
    required this.fallback,
    this.healthInterval = const Duration(seconds: 15),
    this.retryBase = const Duration(seconds: 15),
    this.retryMaximum = const Duration(minutes: 2),
    double Function()? jitter,
  }) : _jitter = jitter ?? (() => 0);

  final bool Function() canConnect;
  final bool Function() isDirect;
  final Future<bool> Function() connect;
  // null means a busy data channel: defer probing without disrupting traffic.
  final Future<bool?> Function() check;
  final void Function() fallback;
  final Duration healthInterval;
  final Duration retryBase;
  final Duration retryMaximum;
  final double Function() _jitter;
  Timer? _timer;
  bool _running = false;
  int _generation = 0;
  int? _busyGeneration;
  int _failures = 0;
  int _healthySamples = 0;

  void start() {
    if (_running) return;
    _running = true;
    ++_generation;
    _schedule(Duration.zero);
  }

  void stop() {
    _running = false;
    ++_generation;
    _timer?.cancel();
    _timer = null;
    _healthySamples = 0;
  }

  void retryNow() {
    if (!_running || _busyGeneration == _generation) return;
    _schedule(Duration.zero);
  }

  void connectionLost() {
    if (!_running || _busyGeneration == _generation) return;
    _failed();
  }

  void _schedule(Duration delay) {
    _timer?.cancel();
    if (_running) _timer = Timer(delay, _tick);
  }

  void _failed() {
    _healthySamples = 0;
    _failures = (_failures + 1).clamp(1, 8);
    final base = (retryBase.inMilliseconds * (1 << (_failures - 1))).clamp(
      1,
      retryMaximum.inMilliseconds,
    );
    // Positive jitter preserves the minimum delay and avoids synchronized retries.
    _schedule(
      Duration(milliseconds: (base * (1 + _jitter().clamp(0, 1) * .2)).round()),
    );
  }

  Future<void> _tick() async {
    if (!_running || _busyGeneration == _generation) return;
    if (!canConnect()) {
      _schedule(healthInterval);
      return;
    }
    final generation = _generation;
    _busyGeneration = generation;
    try {
      final wasDirect = isDirect();
      final result = wasDirect ? await check() : await connect();
      if (!_running || generation != _generation) return;
      if (result == false || !isDirect()) {
        fallback();
        _failed();
      } else {
        if (wasDirect && result == true) {
          _healthySamples++;
          // A brief connection is not proof of recovery; retain backoff until stable.
          if (_healthySamples >= 4) _failures = 0;
        }
        _schedule(healthInterval);
      }
    } catch (_) {
      if (_running && generation == _generation) {
        fallback();
        _failed();
      }
    } finally {
      if (_busyGeneration == generation) _busyGeneration = null;
    }
  }
}
