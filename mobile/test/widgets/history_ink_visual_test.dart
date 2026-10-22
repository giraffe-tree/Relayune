import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/widgets/brand_mark.dart';
import 'package:relayune_mobile/src/widgets/history_ink_painter.dart';
import 'package:relayune_mobile/src/widgets/history_ink_visual.dart';
import 'package:relayune_mobile/src/widgets/startup_morph.dart';

void main() {
  Widget host(Widget child, {bool reduced = false}) => MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(disableAnimations: reduced),
      child: Scaffold(body: Center(child: child)),
    ),
  );

  HistoryInkPainter painter(WidgetTester tester) => tester
      .widgetList<CustomPaint>(find.byType(CustomPaint))
      .map((widget) => widget.painter)
      .whereType<HistoryInkPainter>()
      .single;

  testWidgets('one entrance then breathing while history remains pending', (
    tester,
  ) async {
    final data = (await tester.runAsync(StartupMorphData.load))!;
    await tester.pumpWidget(
      host(HistoryInkVisual(loadMorph: () async => data)),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1200));
    expect(painter(tester).progress, inExclusiveRange(0, 1));
    await tester.pump(const Duration(seconds: 2));
    expect(painter(tester).progress, 1);
    final idle = painter(tester).idle.value;
    await tester.pump(const Duration(milliseconds: 600));
    expect(painter(tester).idle.value, isNot(idle));
    expect(painter(tester).progress, 1);
    // Ordinary parent rebuilds must not restart the branded entrance.
    await tester.pumpWidget(
      host(HistoryInkVisual(loadMorph: () async => data)),
    );
    expect(painter(tester).progress, 1);
    await tester.pumpWidget(const SizedBox.shrink());
    expect(tester.takeException(), isNull);
  });

  testWidgets('a fast read can remove the animation before assets arrive', (
    tester,
  ) async {
    final pending = Completer<StartupMorphData>();
    await tester.pumpWidget(
      host(HistoryInkVisual(loadMorph: () => pending.future)),
    );
    await tester.pumpWidget(const SizedBox.shrink());
    pending.complete((await tester.runAsync(StartupMorphData.load))!);
    await tester.pump();
    expect(find.byType(HistoryInkVisual), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('reduced motion shows final icon and stops both animations', (
    tester,
  ) async {
    final data = (await tester.runAsync(StartupMorphData.load))!;
    final visual = HistoryInkVisual(loadMorph: () async => data);
    await tester.pumpWidget(host(visual));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 900));
    await tester.pumpWidget(host(visual, reduced: true));
    expect(painter(tester).progress, 1);
    expect(painter(tester).idle.value, 0);
    await tester.pump(const Duration(seconds: 5));
    expect(painter(tester).idle.value, 0);
    await tester.pumpWidget(host(visual));
    await tester.pump(const Duration(milliseconds: 500));
    expect(painter(tester).progress, 1);
    expect(painter(tester).idle.value, greaterThan(0));
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('pagination uses a small breathing icon without text entrance', (
    tester,
  ) async {
    final data = (await tester.runAsync(StartupMorphData.load))!;
    await tester.pumpWidget(
      host(HistoryInkVisual(compact: true, loadMorph: () async => data)),
    );
    await tester.pump();
    expect(tester.getSize(find.byType(HistoryInkVisual)), const Size(38, 38));
    expect(painter(tester).progress, 1);
    await tester.pump(const Duration(milliseconds: 500));
    expect(painter(tester).idle.value, greaterThan(0));
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('asset failure keeps a stable branded fallback', (tester) async {
    await tester.pumpWidget(
      host(
        HistoryInkVisual(
          loadMorph: () async => throw const FormatException('fixture'),
        ),
      ),
    );
    await tester.pump();
    expect(find.byType(BrandMark), findsOneWidget);
    expect(tester.widget<BrandMark>(find.byType(BrandMark)).animate, isFalse);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
