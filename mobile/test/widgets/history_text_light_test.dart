import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/state/history_load_progress.dart';
import 'package:relayune_mobile/src/widgets/history_text_light.dart';

Widget host({
  bool reduced = false,
  bool visible = true,
  bool compact = false,
  HistoryLoadPhase? phase,
}) => MaterialApp(
  home: MediaQuery(
    data: MediaQueryData(disableAnimations: reduced),
    child: TickerMode(
      enabled: visible,
      child: Center(
        child: HistoryTextLight(compact: compact, phase: phase),
      ),
    ),
  ),
);

HistoryTextLightPainter painter(WidgetTester tester) => tester
    .widgetList<CustomPaint>(find.byType(CustomPaint))
    .map((w) => w.painter)
    .whereType<HistoryTextLightPainter>()
    .single;

void main() {
  testWidgets(
    'light starts immediately, repeats during long waits, and disposes',
    (tester) async {
      await tester.pumpWidget(host());
      expect(painter(tester).clock.value, 0);
      await tester.pump(const Duration(seconds: 1));
      expect(painter(tester).clock.value, closeTo(.25, .001));
      await tester.pump(const Duration(seconds: 40));
      expect(painter(tester).clock.value, closeTo(.25, .001));
      await tester.pump(const Duration(seconds: 1));
      expect(painter(tester).clock.value, closeTo(.5, .001));
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(seconds: 5));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('reduced motion, hidden routes and background stop ticking', (
    tester,
  ) async {
    await tester.pumpWidget(host());
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpWidget(host(reduced: true));
    expect(painter(tester).clock.value, 0);
    await tester.pump(const Duration(seconds: 5));
    expect(painter(tester).clock.value, 0);
    await tester.pumpWidget(host());
    await tester.pump(const Duration(seconds: 1));
    expect(painter(tester).clock.value, greaterThan(0));
    await tester.pumpWidget(host(visible: false));
    final hidden = painter(tester).clock.value;
    await tester.pump(const Duration(seconds: 5));
    expect(painter(tester).clock.value, hidden);
    await tester.pumpWidget(host());
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    final paused = painter(tester).clock.value;
    await tester.pump(const Duration(seconds: 5));
    expect(painter(tester).clock.value, paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(painter(tester).clock.value, isNot(paused));
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('pagination keeps a small stable wordmark', (tester) async {
    await tester.pumpWidget(host(compact: true));
    expect(tester.getSize(find.byType(HistoryTextLight)), const Size(80, 24));
    await tester.pump(const Duration(seconds: 2));
    expect(tester.getSize(find.byType(HistoryTextLight)), const Size(80, 24));
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('observed phase transitions retain the running light clock', (
    tester,
  ) async {
    await tester.pumpWidget(host(phase: HistoryLoadPhase.waiting));
    await tester.pump(const Duration(seconds: 1));
    final before = painter(tester).clock;
    await tester.pumpWidget(host(phase: HistoryLoadPhase.reading));
    expect(painter(tester).clock, same(before));
    expect(before.value, closeTo(.25, .001));
    await tester.pump(const Duration(milliseconds: 240));
    expect(before.value, closeTo(.31, .001));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
