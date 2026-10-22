import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/widgets/startup_loading_screen.dart';
import 'package:relayune_mobile/src/widgets/startup_morph.dart';

Widget host(Widget child, {bool reduced = false}) => MaterialApp(
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(disableAnimations: reduced),
    child: child!,
  ),
  home: child,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late StartupMorphData data;
  setUpAll(() async => data = await StartupMorphData.load());
  Future<StartupMorphData> load() async => data;
  final overlay = find.byKey(const ValueKey('startup-morph-overlay'));
  StartupMorphPainter painter(WidgetTester tester) => tester
      .widgetList<CustomPaint>(find.byType(CustomPaint))
      .map((w) => w.painter)
      .whereType<StartupMorphPainter>()
      .single;

  testWidgets(
    'ready content is immediately tappable without loading animation assets',
    (tester) async {
      var taps = 0;
      var loads = 0;
      await tester.pumpWidget(
        host(
          StartupLoadingScreen(
            loading: false,
            loadMorph: () async {
              loads++;
              return data;
            },
            child: Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () => taps++,
                  child: const Text('Ready'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Ready'), findsOneWidget);
      expect(overlay, findsNothing);
      expect(loads, 0);
      await tester.tap(find.text('Ready'));
      expect(taps, 1);
      await tester.pumpAndSettle();
      expect(tester.binding.transientCallbackCount, 0);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'loading updates do not start optional asset work before readiness',
    (tester) async {
      var loads = 0;
      Future<StartupMorphData> countedLoad() async {
        loads++;
        return data;
      }

      Future<void> render(bool loading) => tester.pumpWidget(
        host(
          StartupLoadingScreen(
            loading: loading,
            loadMorph: countedLoad,
            child: const Text('Ready'),
          ),
        ),
      );
      await render(true);
      await tester.pump(const Duration(milliseconds: 100));
      await render(true);
      expect(loads, 0);
      await render(false);
      await tester.pump(const Duration(seconds: 1));
      expect(loads, 0);
      expect(overlay, findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  for (final slowAsset in [false, true]) {
    testWidgets(
      'readiness interrupts ${slowAsset ? 'asset load' : 'entrance'} immediately',
      (tester) async {
        final loading = ValueNotifier(true);
        final asset = Completer<StartupMorphData>();
        addTearDown(loading.dispose);
        var taps = 0;
        await tester.pumpWidget(
          host(
            ValueListenableBuilder<bool>(
              valueListenable: loading,
              builder: (_, value, _) => StartupLoadingScreen(
                loading: value,
                loadMorph: slowAsset ? () => asset.future : load,
                child: TextButton(
                  onPressed: () => taps++,
                  child: const Text('Ready'),
                ),
              ),
            ),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        await tester.pump(const Duration(milliseconds: 100));
        expect(overlay, findsOneWidget);
        loading.value = false;
        await tester.pump();
        expect(overlay, findsNothing);
        await tester.tap(find.text('Ready'));
        expect(taps, 1);
        if (slowAsset) asset.complete(data);
        await tester.pumpAndSettle();
        expect(overlay, findsNothing);
        expect(tester.binding.transientCallbackCount, 0);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets('slow startup keeps the formed moon animated without a bar', (
    tester,
  ) async {
    final loading = ValueNotifier(true);
    addTearDown(loading.dispose);
    await tester.pumpWidget(
      host(
        ValueListenableBuilder<bool>(
          valueListenable: loading,
          builder: (_, value, _) => StartupLoadingScreen(
            loading: value,
            loadMorph: load,
            child: const Scaffold(body: Text('Ready')),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 3300));
    expect(painter(tester).progress, 1);
    expect(find.byType(LinearProgressIndicator), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    await tester.pump(const Duration(seconds: 30));
    expect(overlay, findsOneWidget);
    expect(painter(tester).progress, 1);
    expect(tester.binding.transientCallbackCount, greaterThan(0));
    loading.value = false;
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));
    expect(overlay, findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('reduced motion skips the entrance and does not keep a ticker', (
    tester,
  ) async {
    await tester.pumpWidget(
      host(StartupLoadingScreen(loadMorph: load), reduced: true),
    );
    await tester.pumpAndSettle();
    expect(overlay, findsOneWidget);
    expect(tester.binding.transientCallbackCount, 0);
    await tester.pumpWidget(
      host(
        StartupLoadingScreen(
          loading: false,
          loadMorph: load,
          child: const Scaffold(body: Text('Ready')),
        ),
        reduced: true,
      ),
    );
    await tester.pumpAndSettle();
    expect(overlay, findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'startup error bypasses the animation and retry does not replay it',
    (tester) async {
      final phase = ValueNotifier('loading');
      addTearDown(phase.dispose);
      await tester.pumpWidget(
        host(
          ValueListenableBuilder<String>(
            valueListenable: phase,
            builder: (_, value, _) => StartupLoadingScreen(
              loading: value == 'loading',
              bypass: value == 'error',
              loadMorph: load,
              child: const Scaffold(body: Text('Retry')),
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      phase.value = 'error';
      await tester.pump();
      expect(overlay, findsNothing);
      phase.value = 'loading';
      await tester.pump();
      await tester.pump();
      expect(overlay, findsOneWidget);
      expect(painter(tester).progress, 1);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('a missing optional animation asset cannot trap ready content', (
    tester,
  ) async {
    await tester.pumpWidget(
      host(
        StartupLoadingScreen(
          loading: false,
          loadMorph: () => Future.error(StateError('missing asset')),
          child: const Scaffold(body: Text('Ready')),
        ),
      ),
    );
    await tester.pump();
    expect(overlay, findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('backgrounding and tapping skip motion but retain real loading', (
    tester,
  ) async {
    await tester.pumpWidget(
      host(
        StartupLoadingScreen(
          loading: true,
          loadMorph: load,
          child: const Scaffold(body: Text('Ready')),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    expect(overlay, findsOneWidget);
    expect(painter(tester).progress, 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(
      host(StartupLoadingScreen(loading: true, loadMorph: load)),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    await tester.tap(overlay);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));
    expect(overlay, findsOneWidget);
    expect(painter(tester).progress, 1);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
