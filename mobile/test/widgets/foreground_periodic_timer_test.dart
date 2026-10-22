import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/widgets/foreground_periodic_timer.dart';

void main() {
  testWidgets('UI timer stops in background and restarts only on resume', (
    tester,
  ) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    var ticks = 0;
    final timer = ForegroundPeriodicTimer(
      const Duration(seconds: 1),
      () => ticks += 1,
    );
    await tester.pump(const Duration(seconds: 2));
    expect(ticks, 2);
    for (final state in [
      AppLifecycleState.inactive,
      AppLifecycleState.hidden,
      AppLifecycleState.paused,
    ]) {
      tester.binding.handleAppLifecycleStateChanged(state);
      await tester.pump(const Duration(minutes: 1));
      expect(ticks, 2);
    }
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump(const Duration(seconds: 1));
    expect(ticks, 3);
    timer.cancel();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump(const Duration(seconds: 2));
    expect(ticks, 3);
  });
}
