// Wall times are diagnostics, not device frame rates or CI thresholds.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';

import '../support/workbench_fixture.dart';

void main() {
  for (var run = 0; run < 3; run++) {
    testWidgets('scroll paragraph-heavy history sample $run', (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = List.generate(
        100,
        (i) => RelayMessage(
          id: 'reply-$i',
          role: 'codex',
          content: List.generate(
            20,
            (p) =>
                '**Reply $i paragraph $p**: ${'Synthetic reading content. ' * 3}',
          ).join('\n\n'),
          createdAt: '2026-10-09T00:00:00Z',
          kind: 'message.completed',
          turnId: 'turn-$i',
        ),
      );
      await pumpWorkbench(tester, controller);
      await tester.pump();
      final list = find.byKey(const ValueKey('conversation-message-list'));
      final scroll = tester.widget<ListView>(list).controller!;
      final gesture = await tester.startGesture(tester.getCenter(list));
      await gesture.moveBy(const Offset(0, 30));
      await tester.pump();
      var peakEditable = 0;
      var peakElements = 0;
      var peakBubbles = 0;
      final samples = <int>[];
      for (var frame = 0; frame < 100; frame++) {
        final watch = Stopwatch()..start();
        await gesture.moveBy(const Offset(0, 100));
        await tester.pump(const Duration(milliseconds: 16));
        samples.add(watch.elapsedMicroseconds);
        final editable = find.byType(EditableText).evaluate().length;
        if (editable > peakEditable) peakEditable = editable;
        final elements = find
            .descendant(of: list, matching: find.byWidgetPredicate((_) => true))
            .evaluate()
            .length;
        if (elements > peakElements) peakElements = elements;
        final bubbles = find
            .byWidgetPredicate(
              (w) => w.runtimeType.toString() == '_MessageBubble',
            )
            .evaluate()
            .length;
        if (bubbles > peakBubbles) peakBubbles = bubbles;
      }
      expect(scroll.offset, greaterThan(9000));
      await gesture.up();
      await tester.pump(const Duration(seconds: 2));
      samples.sort();
      debugPrint(
        'SCROLL sample=$run median_us=${samples[50]} p95_us=${samples[94]} max_us=${samples.last} peak_editable=$peakEditable peak_elements=$peakElements peak_bubbles=$peakBubbles',
      );
      expect(
        peakBubbles,
        lessThan(10),
        reason: 'History must remain lazily mounted.',
      );
      expect(
        peakEditable,
        1,
        reason:
            'Only the composer needs an EditableText; reading paragraphs must not create editors.',
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
}
