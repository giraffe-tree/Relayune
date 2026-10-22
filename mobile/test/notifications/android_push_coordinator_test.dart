import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/notifications/android_push_coordinator.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('test/android-push');
  const a = AndroidPushAccount(
    origin: 'https://relay.test',
    deviceId: 'device-a',
    sessionToken: 'session-a',
    browserToken: 'browser-a',
    locale: 'zh',
  );
  const b = AndroidPushAccount(
    origin: 'https://relay.test',
    deviceId: 'device-b',
    sessionToken: 'session-b',
    browserToken: 'browser-b',
    locale: 'en',
  );
  Future<void> settle() async {
    for (var i = 0; i < 12; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  late List<MethodCall> calls;
  late List<String> writes;
  String? rid;
  setUp(() {
    calls = [];
    writes = [];
    rid = 'rid_fixture';
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return call.method == 'registration' ? rid : null;
        });
  });
  tearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null),
  );
  testWidgets(
    'background cancels renewal and defers token rotation until foreground',
    (tester) async {
      final coordinator = AndroidPushCoordinator(
        channel: channel,
        now: tester.binding.clock.now,
        write: (account, token) async =>
            writes.add('${account.deviceId}:$token'),
      );
      addTearDown(coordinator.dispose);
      coordinator.update(a);
      await tester.pump();
      expect(writes, ['device-a:rid_fixture']);
      final nativeCalls = calls.length;
      coordinator.setForeground(false);
      rid = 'rid_rotated';
      coordinator.refresh(resetRetryBudget: true);
      await tester.pump(const Duration(days: 1));
      expect(writes, hasLength(1));
      expect(calls, hasLength(nativeCalls));
      coordinator.setForeground(true);
      await tester.pump();
      expect(writes.last, 'device-a:rid_rotated');
      coordinator.dispose();
    },
  );

  testWidgets(
    'disabled binding clears once across refreshes and background resumes',
    (tester) async {
      final coordinator = AndroidPushCoordinator(
        channel: channel,
        now: tester.binding.clock.now,
        write: (account, token) async =>
            writes.add('${account.deviceId}:$token'),
      );
      addTearDown(coordinator.dispose);
      coordinator.update(a);
      await tester.pump();
      coordinator.update(a, enabled: false);
      await tester.pump();
      coordinator.refresh();
      await tester.pump(const Duration(hours: 7));
      coordinator.setForeground(false);
      coordinator.setForeground(true);
      await tester.pump();
      expect(writes, ['device-a:rid_fixture', 'device-a:null']);
      coordinator.update(a);
      await tester.pump();
      coordinator.update(a, enabled: false);
      await tester.pump();
      expect(writes.where((w) => w == 'device-a:null'), hasLength(2));
    },
  );

  testWidgets(
    'foreground retries are bounded and background cancels pending retry',
    (tester) async {
      var attempts = 0;
      final coordinator = AndroidPushCoordinator(
        channel: channel,
        now: tester.binding.clock.now,
        write: (_, _) async {
          attempts++;
          throw StateError('offline');
        },
      );
      addTearDown(coordinator.dispose);
      coordinator.update(a);
      await tester.pump();
      for (final minute in [1, 2, 4]) {
        await tester.pump(Duration(minutes: minute));
      }
      expect(attempts, 4);
      await tester.pump(const Duration(days: 1));
      expect(attempts, 4);
      coordinator.setForeground(false);
      coordinator.setForeground(true);
      await tester.pump();
      expect(attempts, 5);
      coordinator.setForeground(false);
      await tester.pump(const Duration(days: 1));
      expect(attempts, 5);
    },
  );

  test(
    '[MOB-NOT-018][flutter] disabled after restart removes the authenticated binding without registering',
    () async {
      final coordinator = AndroidPushCoordinator(
        channel: channel,
        write: (account, rid) async {
          writes.add('${account.deviceId}:$rid');
        },
      );
      addTearDown(coordinator.dispose);
      coordinator.update(a, enabled: false);
      await settle();
      expect(calls.first.arguments, {'enabled': false});
      expect(writes, ['device-a:null']);
      expect(calls.where((c) => c.method == 'registration'), isEmpty);
    },
  );
  test(
    'registration refresh deduplicates and token rotation registers the new token',
    () async {
      final coordinator = AndroidPushCoordinator(
        channel: channel,
        write: (account, rid) async {
          writes.add('${account.deviceId}:$rid');
        },
      );
      addTearDown(coordinator.dispose);
      coordinator.update(a);
      await settle();
      coordinator.refresh();
      await settle();
      expect(writes, ['device-a:rid_fixture']);
      rid = 'rid_rotated';
      coordinator.refresh();
      await settle();
      expect(writes.last, 'device-a:rid_rotated');
    },
  );
  test(
    'account switching unregisters using the old credentials before binding the new account',
    () async {
      final coordinator = AndroidPushCoordinator(
        channel: channel,
        write: (account, rid) async {
          writes.add('${account.browserToken}:$rid');
        },
      );
      addTearDown(coordinator.dispose);
      coordinator.update(a);
      await settle();
      coordinator.update(b);
      await settle();
      expect(writes, [
        'browser-a:rid_fixture',
        'browser-a:null',
        'browser-b:rid_fixture',
      ]);
    },
  );
  test(
    'logout during an in-flight registration disables delivery and removes its late binding',
    () async {
      final gate = Completer<void>();
      final coordinator = AndroidPushCoordinator(
        channel: channel,
        write: (account, rid) async {
          writes.add('${account.deviceId}:$rid');
          if (rid != null) await gate.future;
        },
      );
      addTearDown(coordinator.dispose);
      coordinator.update(a);
      await settle();
      final stopped = coordinator.stop();
      await settle();
      expect(calls.last.arguments, {'enabled': false});
      gate.complete();
      await stopped;
      await settle();
      expect(writes.first, 'device-a:rid_fixture');
      expect(writes.last, 'device-a:null');
    },
  );
  test(
    'an unavailable SDK or backend does not block the app or spin in retries',
    () async {
      var attempts = 0;
      final coordinator = AndroidPushCoordinator(
        channel: channel,
        write: (account, rid) async {
          attempts++;
          throw StateError('offline');
        },
      );
      addTearDown(coordinator.dispose);
      coordinator.update(a);
      await settle();
      coordinator.refresh();
      await settle();
      expect(attempts, 1);
    },
  );
  test(
    'multiple computers register together and removing one retains the other',
    () async {
      final coordinator = AndroidPushCoordinator(
        channel: channel,
        write: (account, rid) async {
          writes.add('${account.deviceId}:$rid');
        },
      );
      addTearDown(coordinator.dispose);
      coordinator.updateAll([a, b]);
      await coordinator.settled;
      expect(writes, ['device-a:rid_fixture', 'device-b:rid_fixture']);
      await coordinator.remove('a'); // Unknown computer is a no-op.
      expect(writes, hasLength(2));
      await coordinator.remove('device-a');
      expect(writes.last, 'device-a:null');
      expect(writes, isNot(contains('device-b:null')));
      await coordinator.stop();
      expect(writes.last, 'device-b:null');
    },
  );
}
