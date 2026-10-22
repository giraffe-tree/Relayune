import 'dart:async';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/network/automatic_route_supervisor.dart';

void main() {
  test(
    'probes without business requests and keeps fallback until validation completes',
    () {
      fakeAsync((clock) {
        var direct = false;
        var connects = 0;
        var checks = 0;
        final validated = Completer<bool>();
        final monitor = AutomaticRouteSupervisor(
          canConnect: () => true,
          isDirect: () => direct,
          connect: () {
            connects++;
            return validated.future;
          },
          check: () async {
            checks++;
            return true;
          },
          fallback: () => direct = false,
        );
        monitor.start();
        clock.elapse(Duration.zero);
        expect(connects, 1);
        expect(direct, false);
        clock.elapse(const Duration(seconds: 60));
        expect(connects, 1, reason: 'no overlapping handshake');
        direct = true;
        validated.complete(true);
        clock.flushMicrotasks();
        clock.elapse(const Duration(seconds: 15));
        expect(checks, 1);
        expect(direct, true);
        monitor.stop();
        expect(clock.nonPeriodicTimerCount + clock.periodicTimerCount, 0);
      });
    },
  );

  test(
    'failed candidates back off and a short-lived success does not reset cooldown',
    () {
      fakeAsync((clock) {
        var attempts = 0;
        var direct = false;
        final monitor = AutomaticRouteSupervisor(
          canConnect: () => true,
          isDirect: () => direct,
          connect: () async {
            attempts++;
            return direct = attempts == 3;
          },
          check: () async => true,
          fallback: () => direct = false,
        );
        monitor.start();
        clock.elapse(Duration.zero);
        expect(attempts, 1);
        clock.elapse(const Duration(seconds: 14));
        expect(attempts, 1);
        clock.elapse(const Duration(seconds: 1));
        expect(attempts, 2);
        clock.elapse(const Duration(seconds: 30));
        expect(attempts, 3);
        expect(direct, true);
        direct = false;
        monitor.connectionLost();
        clock.elapse(const Duration(seconds: 59));
        expect(attempts, 3);
        clock.elapse(const Duration(seconds: 1));
        expect(attempts, 4);
        monitor.stop();
      });
    },
  );

  test(
    'failed health checks fall back automatically; busy channels are not declared dead',
    () {
      fakeAsync((clock) {
        var direct = true;
        bool? health;
        var fallbacks = 0;
        final monitor = AutomaticRouteSupervisor(
          canConnect: () => true,
          isDirect: () => direct,
          connect: () async => false,
          check: () async => health,
          fallback: () {
            direct = false;
            fallbacks++;
          },
        );
        monitor.start();
        clock.elapse(Duration.zero);
        expect(direct, true);
        expect(fallbacks, 0);
        health = false;
        clock.elapse(const Duration(seconds: 15));
        expect(direct, false);
        expect(fallbacks, 1);
        monitor.stop();
      });
    },
  );

  test(
    'paused or forced-server mode cancels retries and ignores stale probe completion',
    () {
      fakeAsync((clock) {
        final first = Completer<bool>();
        var calls = 0, fallbacks = 0;
        var direct = false;
        final monitor = AutomaticRouteSupervisor(
          canConnect: () => true,
          isDirect: () => direct,
          connect: () {
            calls++;
            return calls == 1 ? first.future : Future.value(direct = true);
          },
          check: () async => true,
          fallback: () {
            fallbacks++;
            direct = false;
          },
        );
        monitor.start();
        clock.elapse(Duration.zero);
        monitor.stop();
        clock.elapse(const Duration(minutes: 5));
        expect(calls, 1);
        monitor.start();
        clock.elapse(Duration.zero);
        expect(direct, true);
        first.complete(false);
        clock.flushMicrotasks();
        expect(direct, true);
        expect(fallbacks, 0);
        monitor.stop();
        expect(clock.nonPeriodicTimerCount + clock.periodicTimerCount, 0);
      });
    },
  );

  test(
    'offline or incompatible Desktop is not probed and recovery is detected automatically',
    () {
      fakeAsync((clock) {
        var available = false, direct = false;
        var calls = 0;
        final monitor = AutomaticRouteSupervisor(
          canConnect: () => available,
          isDirect: () => direct,
          connect: () async {
            calls++;
            return direct = true;
          },
          check: () async => true,
          fallback: () => direct = false,
        );
        monitor.start();
        clock.elapse(const Duration(minutes: 1));
        expect(calls, 0);
        available = true;
        clock.elapse(const Duration(seconds: 15));
        expect(calls, 1);
        expect(direct, true);
        monitor.stop();
      });
    },
  );
}
