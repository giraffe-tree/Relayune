import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/widgets/conversation_scroll_controller.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets(
    '[MOB-MSG-004][flutter] scrolling toward older records requests one page without tapping',
    (tester) async {
      final controller = _PagingController();
      workbenchController(baseController: controller);
      addTearDown(controller.dispose);
      controller.historyHasMore['root'] = true;
      controller.messages['root'] = List.generate(
        8,
        (i) => RelayMessage(
          id: 'm-$i',
          role: 'codex',
          content: 'Reply $i. ' * 40,
          createdAt: '2026-09-08T10:00:00Z',
          kind: 'message.completed',
          turnId: 't-$i',
        ),
      );
      await pumpWorkbench(tester, controller);
      await tester.pump();
      expect(controller.earlierReads, 0);
      final list = find.byKey(const ValueKey('conversation-message-list'));
      for (var i = 0; i < 25 && controller.earlierReads == 0; i++) {
        await tester.drag(list, const Offset(0, 400));
        await tester.pump(const Duration(milliseconds: 30));
      }
      expect(controller.earlierReads, 1);
      await tester.drag(list, const Offset(0, 200));
      await tester.pump();
      expect(
        controller.earlierReads,
        1,
        reason: 'Do not duplicate an in-flight page.',
      );
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  for (final reversed in [false, true]) {
    testWidgets(
      'late image dimensions stay at the tail until reading history (reversed=$reversed)',
      (tester) async {
        final controller = ConversationScrollController(tailAtStart: reversed);
        addTearDown(controller.dispose);
        controller.addListener(() {
          controller.followsLatest = controller.distanceFromLatest <= 72;
        });
        Future<void> render(double imageHeight) => tester.pumpWidget(
          MaterialApp(
            home: CustomScrollView(
              controller: controller,
              reverse: reversed,
              slivers: [
                SliverToBoxAdapter(child: SizedBox(height: imageHeight)),
                const SliverToBoxAdapter(
                  child: SizedBox(height: 1200, child: Text('Latest reply')),
                ),
              ],
            ),
          ),
        );
        await render(100);
        expect(controller.distanceFromLatest, 0);
        await render(800);
        expect(controller.distanceFromLatest, 0);
        // Small upward gestures must accumulate instead of snapping back while
        // they are still inside the 72px follow tolerance.
        for (var step = 0; step < 5; step++) {
          final target = controller.offset + (reversed ? 20 : -20);
          controller.jumpTo(target);
          await tester.pump();
          expect(controller.offset, target);
        }
        expect(controller.followsLatest, isFalse);
        controller.jumpTo(controller.offset + (reversed ? 400 : -400));
        final readingOffset = controller.offset;
        await render(1600);
        expect(controller.offset, readingOffset);
        expect(controller.followsLatest, isFalse);
      },
    );
  }

  testWidgets(
    '[MOB-MSG-002][flutter] a long conversation opens at the last reply on its first frame',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = List.generate(
        100,
        (index) => RelayMessage(
          id: 'message-$index',
          role: 'codex',
          content: List.filled(
            index % 9 + 1,
            'History message $index.',
          ).join('\n'),
          createdAt: '2026-09-08T10:00:00Z',
          kind: 'message.completed',
          turnId: 'turn-$index',
        ),
      );
      await pumpWorkbench(tester, controller);
      final scroll = tester
          .widget<ScrollView>(
            find.byKey(const ValueKey('conversation-message-list')),
          )
          .controller!;
      expect(scroll.position.extentBefore, lessThanOrEqualTo(1));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}

class _PagingController extends AppController {
  int earlierReads = 0;

  @override
  Future<void> loadHistory(
    String sessionId, {
    bool earlier = false,
    bool silent = false,
    bool localOnly = false,
  }) async {
    if (!earlier) return;
    earlierReads += 1;
    historyLoading.add(sessionId);
    notifyListeners();
  }
}
