import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/widgets/conversation_scroll_controller.dart';
import '../support/workbench_fixture.dart';

void main() {
  for (final layout in [
    (size: const Size(402, 874), textScale: 1.0),
    (size: const Size(320, 700), textScale: 1.6),
  ]) {
    testWidgets(
      'back to latest stays hidden within one viewport at ${layout.size.width}px / ${layout.textScale}x',
      (tester) async {
        final controller = workbenchController(
          sessions: [
            relaySession(),
            relaySession(id: 'other'),
          ],
        );
        addTearDown(controller.dispose);
        controller.messages['root'] = List.generate(
          40,
          (i) => RelayMessage(
            id: 'history-$i',
            role: 'codex',
            content: 'History $i. ' * 40,
            createdAt: '2026-10-09T00:00:00Z',
            kind: 'message.completed',
            turnId: 'history-$i',
          ),
        );
        await pumpWorkbench(
          tester,
          controller,
          size: layout.size,
          textScale: layout.textScale,
        );
        await tester.pump();
        final latest = find.byKey(
          const ValueKey('conversation-back-to-latest'),
        );
        ConversationScrollController scroll() =>
            tester
                    .widget<ListView>(
                      find.byKey(const ValueKey('conversation-message-list')),
                    )
                    .controller!
                as ConversationScrollController;
        final viewport = scroll().position.viewportDimension;
        expect(latest, findsNothing);
        scroll().jumpTo(viewport);
        await tester.pump();
        expect(latest, findsNothing);
        expect(scroll().followsLatest, isFalse);
        scroll().jumpTo(viewport + 1);
        await tester.pump();
        expect(latest, findsOneWidget);
        scroll().jumpTo(viewport - 1);
        await tester.pump();
        expect(latest, findsNothing);

        // Restoring a reading position must use its distance, not just atTail.
        await controller.selectSession('other');
        await tester.pump();
        await controller.selectSession('root');
        await tester.pump();
        await tester.pump();
        expect(scroll().offset, closeTo(viewport - 1, 1));
        expect(scroll().followsLatest, isFalse);
        expect(latest, findsNothing);

        // Resizing the visible message area updates the threshold without a drag.
        tester.view.physicalSize = Size(
          layout.size.width,
          layout.size.height - 100,
        );
        await tester.pump();
        await tester.pump();
        expect(latest, findsOneWidget);
        tester.view.physicalSize = layout.size;
        await tester.pump();
        await tester.pump();
        expect(latest, findsNothing);

        scroll().jumpTo(viewport + 1);
        await tester.pump();
        await tester.tap(latest);
        await tester.pump();
        await tester.pump();
        expect(scroll().distanceFromLatest, closeTo(0, 1));
        expect(scroll().followsLatest, isTrue);
        expect(latest, findsNothing);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets(
    'incoming replies preserve an ongoing fling through history',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = List.generate(
        40,
        (i) => RelayMessage(
          id: 'history-$i',
          role: 'codex',
          content: '**History $i**\n\n${'Reading earlier paragraphs. ' * 20}',
          createdAt: '2026-10-09T00:00:00Z',
          kind: 'message.completed',
          turnId: 'history-$i',
        ),
      );
      await pumpWorkbench(tester, controller);
      await tester.pump();
      final list = find.byKey(const ValueKey('conversation-message-list'));
      final scroll = tester.widget<ListView>(list).controller!;
      await tester.fling(
        list,
        Offset(0, scroll.position.viewportDimension + 80),
        1800,
      );
      await tester
          .pump(); // Start the ballistic ticker before measuring motion.
      var previous = scroll.offset;
      for (var frame = 0; frame < 8; frame++) {
        controller.applyEventForTesting(
          RelayEvent(
            cursor: frame + 1,
            eventId: 'fling-$frame',
            sessionId: 'root',
            agentId: null,
            createdAt: '2026-10-09T00:01:00Z',
            event: {
              'kind': 'message.delta',
              'turn_id': 'live',
              'item_id': 'reply',
              'text': 'New paragraph $frame.\n\n',
            },
          ),
        );
        await tester.pump(const Duration(milliseconds: 16));
        expect(scroll.offset, greaterThan(previous));
        expect(scroll.position.isScrollingNotifier.value, isTrue);
        previous = scroll.offset;
      }
      expect(
        find.byKey(const ValueKey('conversation-back-to-latest')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
    variant: TargetPlatformVariant({
      TargetPlatform.iOS,
      TargetPlatform.android,
    }),
  );

  for (final stream in [false, true]) {
    testWidgets('slow drag while stream=$stream', (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = List.generate(
        10,
        (i) => RelayMessage(
          id: 'history-$i',
          role: 'codex',
          content: 'Synthetic history $i. ' * 20,
          createdAt: '2026-09-11T00:00:00Z',
          kind: 'message.completed',
          turnId: 'history-$i',
        ),
      );
      if (stream) {
        controller.applyEventForTesting(
          RelayEvent(
            cursor: 1,
            eventId: 'probe',
            sessionId: 'root',
            agentId: null,
            createdAt: DateTime.now().toIso8601String(),
            event: {
              'kind': 'message.delta',
              'turn_id': 'live',
              'item_id': 'reply',
              'text': 'Synthetic streaming text. ' * 30,
            },
          ),
        );
      }
      await pumpWorkbench(tester, controller);
      await tester.pump();
      final list = find.byKey(const ValueKey('conversation-message-list'));
      final scroll = tester.widget<ListView>(list).controller!;
      final gesture = await tester.startGesture(tester.getCenter(list));
      await gesture.moveBy(const Offset(0, 40));
      await tester.pump();
      await gesture.moveBy(const Offset(0, 20));
      final before = scroll.offset;
      final beforeActivity = scroll.position.isScrollingNotifier.value;
      await tester.pump(const Duration(milliseconds: 40));
      final after = scroll.offset;
      final afterActivity = scroll.position.isScrollingNotifier.value;
      expect(beforeActivity, isTrue);
      expect(afterActivity, isTrue);
      expect(before, 20);
      expect(after, 20);
      await gesture.moveBy(const Offset(0, 20));
      await tester.pump();
      expect(scroll.offset, 40);
      await gesture.up();
      await tester.pump(const Duration(milliseconds: 100));
      expect(scroll.offset, greaterThan(0));
      expect(
        find.byKey(const ValueKey('conversation-back-to-latest')),
        findsNothing,
      );
      expect((scroll as ConversationScrollController).followsLatest, isFalse);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
}
