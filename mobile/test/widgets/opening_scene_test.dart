import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/ui/auth_screen.dart';
import 'package:relayune_mobile/src/ui/theme.dart';
import 'package:relayune_mobile/src/widgets/opening_scene.dart';

Widget host(Widget child, {bool reduced = false, double scale = 1}) =>
    MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      theme: RelayTheme.webFor(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          disableAnimations: reduced,
          textScaler: TextScaler.linear(scale),
        ),
        child: child!,
      ),
      home: child,
    );

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets('first visit plays once and never delays the action', (
    tester,
  ) async {
    var seen = false;
    var actions = 0;
    Widget scene() => host(
      Scaffold(
        body: OpeningScene(
          welcome: true,
          readSeen: () async => seen,
          markSeen: () async {
            seen = true;
          },
          child: Center(
            child: FilledButton(
              onPressed: () => actions++,
              child: const Text('Continue'),
            ),
          ),
        ),
      ),
    );
    await tester.pumpWidget(scene());
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Skip animation'), findsOneWidget);
    await tester.tap(find.text('Continue'));
    await tester.pump();
    expect(actions, 1);
    expect(find.text('Skip animation'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(scene());
    await tester.pump();
    expect(find.text('Skip animation'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'slow cosmetic storage and disposed scenes cannot block navigation',
    (tester) async {
      final read = Completer<bool>();
      await tester.pumpWidget(
        host(
          Scaffold(
            body: OpeningScene(
              welcome: true,
              readSeen: () => read.future,
              markSeen: () async {},
              child: const Center(child: Text('Login is ready')),
            ),
          ),
        ),
      );
      expect(find.text('Login is ready'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 250));
      expect(find.text('Skip animation'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      read.complete(false);
      await tester.pump();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'reduced motion presents the final frame without a skip control',
    (tester) async {
      await tester.pumpWidget(
        host(
          Scaffold(
            body: OpeningScene(
              welcome: true,
              readSeen: () async => false,
              markSeen: () async {},
              child: const Center(child: OpeningHero()),
            ),
          ),
          reduced: true,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Skip animation'), findsNothing);
      expect(tester.binding.transientCallbackCount, 0);
    },
  );

  testWidgets(
    'backgrounding finishes the opening and resume never replays it',
    (tester) async {
      await tester.pumpWidget(
        host(
          Scaffold(
            body: OpeningScene(
              welcome: true,
              readSeen: () async => false,
              markSeen: () async {},
              child: const Center(child: OpeningHero()),
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('Skip animation'), findsNothing);
      expect(tester.binding.transientCallbackCount, 0);
    },
  );

  testWidgets(
    'welcome login keeps typed email when keyboard collapses the hero',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);
      final controller = AppController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(host(AuthScreen(controller: controller)));
      await tester.pump(const Duration(milliseconds: 100));
      expect(tester.testTextInput.isVisible, isFalse);
      await tester.enterText(find.byType(TextFormField), 'hello@example.com');
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pump();
      expect(find.byType(OpeningHero), findsNothing);
      expect(find.text('hello@example.com'), findsOneWidget);
      expect(tester.takeException(), isNull);
      tester.view.resetViewInsets();
      await tester.pump();
      expect(find.byType(OpeningHero), findsOneWidget);
      expect(find.text('hello@example.com'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'small screen and large text keep the form scrollable without overflow',
    (tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = AppController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        host(AuthScreen(controller: controller), scale: 1.8),
      );
      await tester.pump(const Duration(milliseconds: 3000));
      await tester.ensureVisible(find.byType(TextFormField));
      await tester.pump();
      await tester.enterText(find.byType(TextFormField), 'hello@example.com');
      expect(find.text('hello@example.com'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
