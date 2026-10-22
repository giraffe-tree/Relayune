import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:relayune_mobile/src/ui/theme.dart';
import 'package:relayune_mobile/src/widgets/device_route_card.dart';
import '../ui/agent_task_visual_test.dart' as visual;
import 'package:relayune_mobile/src/state/device_connection.dart';

void main() {
  test(
    'server node distinguishes initial negotiation, reachable server and reconnect failure',
    () {
      const initial = DeviceConnectionSnapshot.initial();
      expect(serverNodeColor(initial), RelayTheme.muted);
      expect(
        serverNodeColor(
          initial.withTransport(RealtimeTransportState.connecting),
        ),
        RelayTheme.muted,
      );
      expect(
        serverNodeColor(
          initial.withTransport(RealtimeTransportState.connected),
        ),
        RelayTheme.greenStrong,
      );
      expect(
        serverNodeColor(
          initial.withTransport(RealtimeTransportState.reconnecting),
        ),
        RelayTheme.red,
      );
      final observed = initial.observeWebSocketHeartbeat(
        receivedAt: '2026-09-15T00:00:00Z',
        roundTripMs: 800,
      );
      expect(
        serverNodeColor(
          observed.withTransport(RealtimeTransportState.connected),
        ),
        RelayTheme.greenStrong,
      );
      expect(
        serverNodeColor(observed.withTransport(RealtimeTransportState.idle)),
        RelayTheme.red,
      );
    },
  );
  testWidgets(
    'metrics disappear on fallback and offline; diagram is accessible',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final semantics = tester.ensureSemantics();

      for (final state in [
        'direct',
        'connecting',
        'fallback',
        'server',
        'offline',
      ]) {
        await tester.pumpWidget(screen(state));
        await tester.pumpAndSettle();
        expect(
          find.text('往返 · 23 ms'),
          state == 'direct' ? findsOneWidget : findsNothing,
        );
        expect(
          find.text('建连 · 9.4 s'),
          state == 'direct' ? findsOneWidget : findsNothing,
        );
        expect(
          tester
              .getSemantics(find.byKey(const ValueKey('device-route-svg')))
              .label,
          contains(
            state == 'direct'
                ? 'WebRTC 直连'
                : state == 'offline'
                ? '等待电脑上线'
                : state == 'connecting'
                ? '连接中'
                : '服务器中转',
          ),
        );
        expect(tester.takeException(), isNull);
      }
      semantics.dispose();
    },
  );
  testWidgets('narrow screens, large text and RTL do not overflow', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final locale in [
      const Locale('zh'),
      const Locale('en'),
      const Locale('ar'),
    ]) {
      await tester.pumpWidget(screen('direct', locale: locale, large: true));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    }
  });
  testWidgets(
    'connected paths share a balanced cadence and stop with reduced motion',
    (tester) async {
      RouteTrafficPainter painter() =>
          tester
                  .widget<CustomPaint>(
                    find.byKey(const ValueKey('device-route-motion')),
                  )
                  .painter!
              as RouteTrafficPainter;
      await tester.pumpWidget(screen('direct', reduceMotion: false));
      await tester.pump(const Duration(milliseconds: 600));
      expect(painter().directProgress, isNotNull);
      expect(painter().webProgress, equals(painter().desktopProgress));
      final first = painter().directProgress;
      await tester.pump(const Duration(seconds: 6));
      expect(painter().directProgress, closeTo(first!, .001));
      await tester.pumpWidget(screen('offline', reduceMotion: false));
      expect(painter().directProgress, isNull);
      expect(painter().desktopProgress, isNull);
      await tester.pumpWidget(screen('connecting', reduceMotion: false));
      expect(painter().negotiation, isNotNull);
      expect(painter().directProgress, isNull);
      await tester.pumpWidget(screen('connecting'));
      await tester.pumpAndSettle();
      expect(painter().negotiation, isNull);
      expect(painter().webProgress, isNull);
    },
  );

  testWidgets('route visual preview', (tester) async {
    const output = String.fromEnvironment('ROUTE_SCREENSHOTS');
    const font = String.fromEnvironment('ROUTE_FONT');
    if (font.isNotEmpty) {
      await tester.runAsync(() async {
        final bytes = ByteData.sublistView(await File(font).readAsBytes());
        for (final family in [
          'RoutePreview',
          'Ahem',
          'Roboto',
          '.SF UI Text',
          '.SF UI Display',
        ]) {
          await (FontLoader(family)..addFont(Future.value(bytes))).load();
        }
      });
    }
    tester.view.physicalSize = const Size(390, 860);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final boundary = GlobalKey();
    for (final state in ['direct', 'connecting', 'fallback']) {
      await tester.pumpWidget(screen(state, boundary: boundary));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await visual.capture(tester, boundary, output, state);
    }
    const motionOutput = String.fromEnvironment('ROUTE_MOTION_SCREENSHOTS');
    if (motionOutput.isNotEmpty) {
      await tester.pumpWidget(
        screen('direct', boundary: boundary, reduceMotion: false),
      );
      await tester.pump();
      await tester.pumpWidget(
        screen('direct', boundary: boundary, reduceMotion: false),
      );
      for (var i = 0; i < 20; i++) {
        await tester.pump(const Duration(milliseconds: 100));
        await visual.capture(
          tester,
          boundary,
          motionOutput,
          i.toString().padLeft(3, '0'),
        );
      }
      await tester.pumpWidget(screen('direct', boundary: boundary));
    }
  });
}

Widget screen(
  String state, {
  Locale locale = const Locale('zh'),
  bool large = false,
  GlobalKey? boundary,
  bool reduceMotion = true,
}) => MaterialApp(
  theme: const String.fromEnvironment('ROUTE_FONT').isEmpty
      ? RelayTheme.web
      : RelayTheme.web.copyWith(
          textTheme: RelayTheme.web.textTheme.apply(fontFamily: 'RoutePreview'),
        ),
  locale: locale,
  supportedLocales: const [Locale('zh'), Locale('en'), Locale('ar')],
  localizationsDelegates: GlobalMaterialLocalizations.delegates,
  home: RepaintBoundary(
    key: boundary,
    child: Builder(
      builder: (context) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(large ? 1.6 : 1),
          disableAnimations: reduceMotion,
        ),
        child: Scaffold(
          appBar: AppBar(title: const Text('设备')),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              DeviceRouteCard(
                status: state,
                online: state != 'offline',
                automatic: state != 'server',
                roundTripMs: 23,
                connectionMs: 9400,
                webSocketColor: RelayTheme.greenStrong,
                serverColor: RelayTheme.greenStrong,
                desktopColor: state == 'offline'
                    ? RelayTheme.red
                    : RelayTheme.greenStrong,
                webSocketConnected: true,
                desktopConnected: state != 'offline',
                webSocketLines: const [
                  'WebSocket',
                  '心跳正常',
                  '52 ms',
                  '上次心跳',
                  '24 秒前',
                  '2026/9/15 09:54',
                ],
                desktopLines: [
                  'Desktop Relay',
                  state == 'offline' ? '离线' : '在线',
                  '',
                  '电脑心跳',
                  '刚刚',
                  '2026/9/15 09:54',
                ],
              ),
            ],
          ),
        ),
      ),
    ),
  ),
);
