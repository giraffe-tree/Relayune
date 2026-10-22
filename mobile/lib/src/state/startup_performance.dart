import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// Debug-only, fixed stage names and timings. No account or content identifiers.
/// The native launch probe combines these markers with its process launch clock.
abstract final class StartupPerformance {
  static Stopwatch? _clock;
  static final _stages = <String>{};

  static void start() {
    if (!kDebugMode) return;
    _clock = Stopwatch()..start();
    _stages.clear();
  }

  static void frame(String stage) {
    if (!kDebugMode || _clock == null || !_stages.add(stage)) return;
    final clock = _clock!;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (clock != _clock) return;
      debugPrint(
        'Relayune startup performance ${jsonEncode({'stage': stage, 'dart_elapsed_ms': clock.elapsedMicroseconds / 1000})}',
      );
    });
  }
}
