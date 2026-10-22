import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/state/background_lifecycle.dart';

void main() {
  testWidgets(
    'brief inactivity keeps connections, background stops once and retains warm cache',
    (tester) async {
      final events = <String>[];
      final policy = BackgroundLifecycle(
        now: tester.binding.clock.now,
        onBackground: () => events.add('stop'),
        onReleaseMemory: () => events.add('release'),
        onResume: (away) => events.add('resume:${away.inSeconds}'),
      );
      addTearDown(policy.dispose);
      policy.handle(AppLifecycleState.inactive);
      expect(policy.visible, isFalse);
      expect(events, isEmpty);
      policy.handle(AppLifecycleState.resumed);
      expect(events, isEmpty);
      policy.handle(AppLifecycleState.hidden);
      policy.handle(AppLifecycleState.paused);
      await tester.pump(const Duration(minutes: 4));
      expect(events, ['stop']);
      policy.handle(AppLifecycleState.inactive);
      expect(policy.background, isTrue);
      policy.handle(AppLifecycleState.resumed);
      expect(events, ['stop', 'resume:240']);
      await tester.pump(const Duration(minutes: 2));
      expect(events, hasLength(2));
    },
  );

  testWidgets('five minutes releases once without recurring background work', (
    tester,
  ) async {
    var released = 0;
    final policy = BackgroundLifecycle(
      now: tester.binding.clock.now,
      onBackground: () {},
      onReleaseMemory: () => released++,
      onResume: (_) {},
    );
    addTearDown(policy.dispose);
    policy.handle(AppLifecycleState.paused);
    await tester.pump(const Duration(minutes: 5));
    expect(released, 1);
    policy.handle(AppLifecycleState.detached);
    policy.memoryPressure();
    await tester.pump(const Duration(days: 1));
    expect(released, 1);
  });

  testWidgets('suspension cannot prevent deadline evaluation before resume', (
    tester,
  ) async {
    var now = DateTime(2026, 10, 1);
    final events = <String>[];
    final policy = BackgroundLifecycle(
      now: () => now,
      onBackground: () => events.add('stop'),
      onReleaseMemory: () => events.add('release'),
      onResume: (_) => events.add('resume'),
    );
    addTearDown(policy.dispose);
    policy.handle(AppLifecycleState.paused);
    // Advance the clock without delivering any timer, as on a suspended app.
    now = now.add(const Duration(hours: 2));
    policy.handle(AppLifecycleState.resumed);
    expect(events, ['stop', 'release', 'resume']);
    expect(policy.background, isFalse);
    expect(policy.memoryReleased, isFalse);
    await tester.pump(const Duration(minutes: 5));
    expect(events, hasLength(3));
  });

  testWidgets(
    'memory pressure releases early and a new background gets a new deadline',
    (tester) async {
      var released = 0;
      final policy = BackgroundLifecycle(
        now: tester.binding.clock.now,
        onBackground: () {},
        onReleaseMemory: () => released++,
        onResume: (_) {},
      );
      addTearDown(policy.dispose);
      policy.memoryPressure();
      expect(released, 0);
      policy.handle(AppLifecycleState.paused);
      policy.memoryPressure();
      expect(released, 1);
      policy.handle(AppLifecycleState.resumed);
      policy.handle(AppLifecycleState.paused);
      await tester.pump(const Duration(minutes: 5));
      expect(released, 2);
    },
  );
}
