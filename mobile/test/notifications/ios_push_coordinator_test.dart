// [MOB-NOT-019][flutter]
import 'dart:async';
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/notifications/ios_push_coordinator.dart';

class PushApi extends RelayApi {
  final calls = <Map<String, dynamic>>[];
  Completer<void>? registrationGate;
  @override
  Future<void> registerIosPush(
    String deviceId,
    Map<String, dynamic> body,
  ) async {
    calls.add({'device': deviceId, ...body});
    if (body['enabled'] == true) await registrationGate?.future;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('relayune.test.ios-push');
  final key = RelayKey.import(
    base64Url.encode(List.filled(32, 7)).replaceAll("=", ""),
  );
  late PushApi api;
  late IosPushCoordinator coordinator;
  late List<MethodCall> native;
  Map<String, dynamic>? snapshot;
  Completer<void>? blocked;
  void configure({bool enabled = true, bool clear = false}) =>
      coordinator.configure(
        enabled: enabled,
        clear: clear,
        deviceId: 'dev_test',
        key: key,
        labels: {'running': 'Working'},
      );
  setUp(() {
    api = PushApi();
    native = [];
    snapshot = {'token': 'ab' * 32, 'environment': 'sandbox', 'activities': []};
    blocked = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          native.add(call);
          if (call.method == 'configure' && call.arguments != null) {
            await blocked?.future;
          }
          if (call.method == 'snapshot') return snapshot;
          return null;
        });
    coordinator = IosPushCoordinator(
      api: api,
      onOpen: (_) {},
      channel: channel,
    );
  });
  tearDown(() {
    coordinator.dispose();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });
  test(
    'background defers push registration changes without clearing delivery',
    () async {
      configure();
      await coordinator.settled;
      expect(api.calls, hasLength(1));
      final nativeCount = native.length;
      coordinator.setForeground(false);
      snapshot = {
        'token': 'cd' * 32,
        'environment': 'sandbox',
        'activities': [],
      };
      configure();
      await coordinator.settled;
      expect(api.calls, hasLength(1));
      expect(native, hasLength(nativeCount));
      coordinator.setForeground(true);
      await coordinator.settled;
      expect(api.calls, hasLength(2));
      expect(api.calls.last['token'], 'cd' * 32);
      expect(api.calls.every((call) => call['enabled'] == true), isTrue);
    },
  );

  test('HKDF matches Node vector without exposing conversation key', () {
    expect(
      deriveIosPushKey(key),
      'iaLIh1c-nKIcUvn62fjVfzrxbzUp9AB5qgHFfoMPYqk',
    );
    expect(deriveIosPushKey(key), isNot(key.exportForSecureStorage()));
  });
  test(
    'registers derived identity, deduplicates heartbeats, preserves reconnect and clears logout',
    () async {
      configure();
      await coordinator.settled;
      expect(api.calls, hasLength(1));
      expect(api.calls.single['push_key_id'], startsWith('sha256:'));
      expect(api.calls.single.containsKey('key'), isFalse);
      expect(
        native.first.arguments['bindings'][0]['key'],
        deriveIosPushKey(key),
      );
      configure();
      configure(enabled: false);
      await coordinator.settled;
      expect(api.calls, hasLength(1));
      configure(enabled: false, clear: true);
      await coordinator.settled;
      expect(api.calls.last, {'device': 'dev_test', 'enabled': false});
      expect(
        native.where((c) => c.method == 'configure').last.arguments,
        isNull,
      );
    },
  );
  test(
    'logout during native configuration cannot register stale authorization',
    () async {
      blocked = Completer<void>();
      configure();
      await Future<void>.delayed(Duration.zero);
      configure(enabled: false, clear: true);
      blocked!.complete();
      await coordinator.settled;
      expect(api.calls.every((c) => c['enabled'] == false), isTrue);
      expect(
        native.where((c) => c.method == 'configure').last.arguments,
        isNull,
      );
    },
  );
  test('missing APNs token leaves registration pending', () async {
    snapshot = {'token': null, 'environment': 'sandbox', 'activities': []};
    configure();
    await coordinator.settled;
    expect(api.calls, isEmpty);
  });
  test(
    'two computers retain independent push keys and activity routes; removal clears only one',
    () async {
      final second = PushApi();
      final secondKey = RelayKey.import(
        base64Url.encode(List.filled(32, 9)).replaceAll('=', ''),
      );
      snapshot!['activities'] = [
        {'deviceId': 'a', 'route': 'route-a', 'token': 'token-a'},
        {'deviceId': 'b', 'route': 'route-b', 'token': 'token-b'},
      ];
      coordinator.configureComputers(
        enabled: true,
        clear: false,
        labels: {'running': 'Working'},
        computers: [
          IosPushComputer(
            api: api,
            deviceId: 'a',
            browserId: 'auth-a',
            key: key,
          ),
          IosPushComputer(
            api: second,
            deviceId: 'b',
            browserId: 'auth-b',
            key: secondKey,
          ),
        ],
      );
      await coordinator.settled;
      expect(native.first.arguments['bindings'], hasLength(2));
      expect(api.calls.single['activities'], [
        {'route': 'route-a', 'token': 'token-a'},
      ]);
      expect(second.calls.single['activities'], [
        {'route': 'route-b', 'token': 'token-b'},
      ]);
      expect(
        api.calls.single['push_key_id'],
        isNot(second.calls.single['push_key_id']),
      );
      await coordinator.remove('a');
      expect(api.calls.last, {'device': 'a', 'enabled': false});
      expect(second.calls, hasLength(1));
      expect(
        native.where((c) => c.method == 'configure').last.arguments['bindings'],
        hasLength(1),
      );
    },
  );

  test('late server registration is unregistered after removal', () async {
    api.registrationGate = Completer<void>();
    configure();
    await Future<void>.delayed(Duration.zero);
    expect(api.calls.single['enabled'], isTrue);
    final removal = coordinator.remove('dev_test');
    api.registrationGate!.complete();
    await removal;
    expect(api.calls.last, {'device': 'dev_test', 'enabled': false});
  });
  test('opt-out after restart removes persisted registration', () async {
    configure(enabled: false, clear: true);
    await coordinator.settled;
    expect(api.calls.single, {'device': 'dev_test', 'enabled': false});
  });
}
