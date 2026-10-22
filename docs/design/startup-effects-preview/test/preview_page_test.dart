import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_startup_studies/main.dart';
import 'package:relayune_startup_studies/eclipse_formation.dart';
import 'package:relayune_startup_studies/startup_morph.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late StartupMorphData data;
  setUpAll(() async => data = await StartupMorphData.load());
  StartupMorphPainter painter(WidgetTester tester) => tester
      .widgetList<CustomPaint>(find.byType(CustomPaint))
      .map((w) => w.painter)
      .whereType<StartupMorphPainter>()
      .single;

  testWidgets(
    'all six choices replay independently, with slow playback and scrubbing',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(home: StudyPage(loadMorph: () async => data)),
      );
      await tester.pump();
      for (final effect in EclipseFormation.values) {
        await tester.tap(find.byKey(ValueKey('effect-${effect.name}')));
        await tester.pump();
        expect(painter(tester).formation, effect);
        expect(painter(tester).progress, 0);
        await tester.pump(const Duration(milliseconds: 1600));
        expect(painter(tester).progress, inExclusiveRange(0, 1));
        await tester.pump(const Duration(seconds: 2));
        expect(painter(tester).progress, 1);
        expect(find.text('等待加载 · 图标呼吸'), findsOneWidget);
      }
      await tester.tap(find.byKey(const ValueKey('original-eclipse')));
      await tester.pump();
      expect(painter(tester).formation, isNull);
      await tester.tap(find.byKey(const ValueKey('original-eclipse')));
      await tester.pump();
      expect(painter(tester).formation, EclipseFormation.elastic);
      await tester.tap(find.text('慢放 × 0.5'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1600));
      expect(painter(tester).progress, lessThan(.2));
      final slider = tester.widget<Slider>(
        find.byKey(const ValueKey('timeline')),
      );
      slider.onChanged!(.55);
      await tester.pump();
      final paused = painter(tester).progress;
      await tester.pump(const Duration(seconds: 1));
      expect(painter(tester).progress, paused);
      await tester.tap(find.byKey(const ValueKey('replay')));
      await tester.pump();
      expect(painter(tester).progress, 0);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('narrow layout remains usable with large text', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.5)),
          child: child!,
        ),
        home: StudyPage(loadMorph: () async => data),
      ),
    );
    await tester.pump();
    await tester.ensureVisible(find.byKey(const ValueKey('effect-elastic')));
    await tester.tap(find.byKey(const ValueKey('effect-elastic')));
    await tester.pump();
    expect(painter(tester).formation, EclipseFormation.elastic);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
