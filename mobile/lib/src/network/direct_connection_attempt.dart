import 'dart:async';

/// One bounded attempt; late stage completions cannot advance a cancelled attempt.
class DirectConnectionAttempt {
  DirectConnectionAttempt({this.budget = const Duration(seconds: 30)}) {
    _watch.start();
  }
  final Duration budget;
  final Stopwatch _watch = Stopwatch();
  final Map<String, int> stages = {};
  String stage = 'connect';
  bool cancelled = false;

  Future<T> run<T>(String name, Future<T> Function() work) async {
    if (cancelled) throw StateError('direct_attempt_cancelled');
    stage = name;
    final remaining = budget - _watch.elapsed;
    if (remaining <= Duration.zero) {
      cancelled = true;
      throw TimeoutException('direct_attempt_timeout');
    }
    final started = _watch.elapsedMilliseconds;
    try {
      final result = await work().timeout(remaining);
      if (cancelled) throw StateError('direct_attempt_cancelled');
      return result;
    } on TimeoutException {
      cancelled = true;
      rethrow;
    } finally {
      stages[name] = _watch.elapsedMilliseconds - started;
    }
  }

  Map<String, Object> summary(String outcome) => {
    'outcome': outcome,
    'stage': stage,
    'elapsed_ms': _watch.elapsedMilliseconds,
    'stages_ms': Map<String, int>.of(stages),
  };
}
