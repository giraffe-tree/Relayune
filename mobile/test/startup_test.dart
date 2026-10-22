import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/main.dart' as app;
import 'package:relayune_mobile/src/notifications/flutter_local_notification_gateway.dart';
import 'package:relayune_mobile/src/notifications/notification_coordinator.dart';
import 'package:relayune_mobile/src/ui/auth_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const messages = MethodChannel('com.llfbandit.app_links/messages');
  const events = MethodChannel('com.llfbandit.app_links/events');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      'relayune.preferred-locale.v1': 'zh-CN',
    });
    messenger.setMockMethodCallHandler(events, (_) async => null);
  });
  tearDown(() {
    messenger.setMockMethodCallHandler(messages, null);
    messenger.setMockMethodCallHandler(events, null);
  });

  testWidgets('slow launch link does not block the first frame or login', (
    tester,
  ) async {
    final launchLink = Completer<String?>();
    messenger.setMockMethodCallHandler(messages, (_) => launchLink.future);

    await tester.pumpWidget(const SizedBox.shrink());
    app.main();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.byType(AuthScreen), findsOneWidget);
    expect(launchLink.isCompleted, isFalse);

    final pairingId = 'pair_${List.filled(43, 'A').join()}';
    launchLink.complete('relayune://pair?id=$pairingId');
    await tester.pump();
    expect(
      tester
          .widget<AuthScreen>(find.byType(AuthScreen))
          .controller
          .pendingPairingId,
      pairingId,
    );
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('failed initial link lookup still opens login', (tester) async {
    final links = _FakeAppLinks(() async {
      throw PlatformException(code: 'unavailable');
    });
    addTearDown(links.events.close);
    await tester.pumpWidget(
      app.RelayuneApp(
        links: links,
        notifications: _DelayedNotifications(Future.value()),
        usesIosSimulatorEmojiFallback: false,
      ),
    );
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byType(AuthScreen), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('slow notifications do not block login', (tester) async {
    final gate = Completer<void>();
    final links = _FakeAppLinks(() async => null);
    addTearDown(links.events.close);
    await tester.pumpWidget(
      app.RelayuneApp(
        links: links,
        notifications: _DelayedNotifications(gate.future),
        usesIosSimulatorEmojiFallback: false,
      ),
    );
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byType(AuthScreen), findsOneWidget);
    expect(gate.isCompleted, isFalse);
    gate.complete();
    await tester.pump();
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('a late initial link cannot overwrite a newer incoming link', (
    tester,
  ) async {
    final initialLink = Completer<Uri?>();
    final links = _FakeAppLinks(() => initialLink.future);
    addTearDown(links.events.close);
    await tester.pumpWidget(
      app.RelayuneApp(
        links: links,
        notifications: _DelayedNotifications(Future.value()),
        usesIosSimulatorEmojiFallback: false,
      ),
    );
    await tester.pump(const Duration(milliseconds: 50));
    final newerId = 'pair_${List.filled(43, 'B').join()}';
    links.events.add(Uri.parse('relayune://pair?id=$newerId'));
    await tester.pump();
    initialLink.complete(
      Uri.parse('relayune://pair?id=pair_${List.filled(43, 'A').join()}'),
    );
    await tester.pump();
    expect(
      tester
          .widget<AuthScreen>(find.byType(AuthScreen))
          .controller
          .pendingPairingId,
      newerId,
    );
    await tester.pumpWidget(const SizedBox.shrink());
  });
}

class _FakeAppLinks implements AppLinks {
  _FakeAppLinks(this.initialLink);
  final Future<Uri?> Function() initialLink;
  final events = StreamController<Uri>.broadcast();

  @override
  Future<Uri?> getInitialLink() => initialLink();

  @override
  Stream<Uri> get uriLinkStream => events.stream;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _DelayedNotifications extends RelayNotificationCoordinator {
  _DelayedNotifications(this.gate)
    : super(gateway: FlutterLocalNotificationGateway());
  final Future<void> gate;

  @override
  Future<void> initialize() => gate;
}
