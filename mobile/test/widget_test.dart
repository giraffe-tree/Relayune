import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/ui/theme.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/ui/pairing_screen.dart';
import 'package:relayune_mobile/src/widgets/brand_mark.dart';

void main() {
  testWidgets(
    'manual pairing failure stays visible beside the connect button',
    (tester) async {
      tester.view.physicalSize = const Size(402, 874);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = AppController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: RelayTheme.web,
          home: PairingScreen(controller: controller),
        ),
      );
      await tester.ensureVisible(
        find.byKey(const ValueKey('toggle-manual-pairing')),
      );
      await tester.tap(find.byKey(const ValueKey('toggle-manual-pairing')));
      await tester.pump();
      controller.error = '配对失败，请重新连接。';
      await tester.pumpWidget(
        MaterialApp(
          theme: RelayTheme.web,
          home: PairingScreen(controller: controller),
        ),
      );
      await tester.ensureVisible(find.text('安全连接'));
      await tester.pump();
      expect(find.text(controller.error).hitTestable(), findsOneWidget);
      expect(find.text(controller.error), findsOneWidget);
    },
  );

  testWidgets('pairing progress is visible with manual entry collapsed', (
    tester,
  ) async {
    final controller = AppController()
      ..pairingPhase = PairingPhase.waitingForDesktop;
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: RelayTheme.web,
        home: PairingScreen(controller: controller),
      ),
    );
    expect(find.byKey(const ValueKey('manual-pairing')), findsNothing);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const ValueKey('scan-pairing-qr')))
          .onPressed,
      isNull,
    );
  });

  testWidgets('Relayune brand renders with its accessible name', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: RelayTheme.light,
        home: const Scaffold(body: BrandMark(withName: true)),
      ),
    );

    expect(find.text('Relayune'), findsOneWidget);
    expect(find.byType(CustomPaint), findsWidgets);
  });

  testWidgets(
    'pairing prioritizes scanning and expands code-only manual entry',
    (tester) async {
      final controller = AppController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: RelayTheme.light,
          home: PairingScreen(
            controller: controller,
            loadVersion: () async => '0.3.18+28',
          ),
        ),
      );

      expect(find.byKey(const ValueKey('scan-pairing-qr')), findsOneWidget);
      expect(find.text('扫码连接'), findsOneWidget);
      expect(find.text('二维码在哪里？'), findsOneWidget);
      expect(find.byKey(const ValueKey('manual-pairing-code')), findsNothing);
      expect(
        find.byKey(const ValueKey('scan-pairing-qr')).hitTestable(),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('toggle-manual-pairing')));
      await tester.pump();
      expect(find.byKey(const ValueKey('manual-pairing')), findsOneWidget);
      expect(find.byKey(const ValueKey('manual-pairing-code')), findsOneWidget);
      expect(find.text('Relayune 连接链接'), findsNothing);
      expect(find.text('粘贴并识别链接'), findsNothing);
      await tester.pump();
      expect(
        find.text('Relayune Mobile 0.3.18+28 · 电脑端最低兼容版本：0.3.9'),
        findsOneWidget,
      );
    },
  );

  testWidgets('RTL pairing keeps the eight-character code field LTR', (
    tester,
  ) async {
    final controller = AppController(locale: const Locale('ar'));
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('ar'),
        supportedLocales: relayuneSupportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        theme: RelayTheme.light,
        home: PairingScreen(controller: controller),
      ),
    );

    await tester.ensureVisible(
      find.byKey(const ValueKey('toggle-manual-pairing')),
    );
    await tester.tap(find.byKey(const ValueKey('toggle-manual-pairing')));
    await tester.pump();
    expect(
      Directionality.of(
        tester.element(find.byKey(const ValueKey('manual-pairing'))),
      ),
      TextDirection.rtl,
    );
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('manual-pairing-code')))
          .textDirection,
      TextDirection.ltr,
    );
  });

  testWidgets('manual pairing asks for a computer only when several wait', (
    tester,
  ) async {
    final firstPairingId = 'pair_${List.filled(43, 'A').join()}';
    final secondPairingId = 'pair_${List.filled(43, 'B').join()}';
    final controller = AppController()
      ..pendingBrowserPairings = [
        PendingBrowserPairing(
          pairingId: firstPairingId,
          deviceId: 'dev_${List.filled(32, 'a').join()}',
          deviceName: '书房 Mac',
          expiresAt: '2026-08-12T16:00:00.000Z',
        ),
        PendingBrowserPairing(
          pairingId: secondPairingId,
          deviceId: 'dev_${List.filled(32, 'b').join()}',
          deviceName: '办公室 Windows',
          expiresAt: '2026-08-12T16:00:00.000Z',
        ),
      ];
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: RelayTheme.light,
        home: AnimatedBuilder(
          animation: controller,
          builder: (context, _) => PairingScreen(controller: controller),
        ),
      ),
    );

    await tester.ensureVisible(
      find.byKey(const ValueKey('toggle-manual-pairing')),
    );
    await tester.tap(find.byKey(const ValueKey('toggle-manual-pairing')));
    await tester.pump();
    await tester.ensureVisible(
      find.byKey(const ValueKey('pending-pairing-device')),
    );
    expect(
      find.byKey(const ValueKey('pending-pairing-device')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('pending-pairing-device')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.text('办公室 Windows').last);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(controller.pendingPairingId, secondPairingId);
    expect(find.text('Relayune 连接链接'), findsNothing);
  });

  test(
    'account discovery automatically selects the only waiting computer',
    () async {
      final pairing = PendingBrowserPairing(
        pairingId: 'pair_${List.filled(43, 'A').join()}',
        deviceId: 'dev_${List.filled(32, 'a').join()}',
        deviceName: '书房 Mac',
        expiresAt: '2026-08-12T16:00:00.000Z',
      );
      final controller = AppController(
        api: _PendingPairingApi(
          PendingBrowserPairingDiscovery(
            hasBoundComputer: true,
            pairings: [pairing],
          ),
        ),
      );
      addTearDown(controller.dispose);

      expect(await controller.discoverPendingBrowserPairings(), isTrue);
      expect(controller.pendingPairingId, pairing.pairingId);
      expect(controller.pendingBrowserPairings.single.deviceName, '书房 Mac');
    },
  );
}

class _PendingPairingApi extends RelayApi {
  _PendingPairingApi(this.discovery);

  final PendingBrowserPairingDiscovery discovery;

  @override
  Future<PendingBrowserPairingDiscovery> pendingBrowserPairings() async =>
      discovery;
}
