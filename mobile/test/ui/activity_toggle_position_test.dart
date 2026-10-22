import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/widgets/conversation_scroll_controller.dart';
import '../support/workbench_fixture.dart';

void main() {
  for (final count in [3, 12]) {
    for (final status in ['completed', 'failed', 'running']) {
      for (final historical in [false, true]) {
        final failed = status == 'failed';
        final targetIndex = count - (historical ? 2 : 1);
        testWidgets(
          'activity title stays in place across frames: count=$count status=$status historical=$historical',
          (tester) async {
            final controller = workbenchController();
            addTearDown(controller.dispose);
            controller.messages['root'] = [
              for (var i = 0; i < count; i++) ...[
                RelayMessage(
                  id: 'u$i',
                  role: 'user',
                  content: 'Task $i',
                  createdAt: '2026-09-15T10:00:00Z',
                  kind: 'user.message',
                  turnId: 't$i',
                ),
                RelayMessage(
                  id: 'p$i',
                  role: 'codex',
                  content: List.filled(
                    18,
                    'Synthetic progress paragraph for expansion and reading position.',
                  ).join('\n\n'),
                  createdAt: '2026-09-15T10:00:01Z',
                  kind: 'message.completed',
                  messagePhase: 'commentary',
                  turnId: 't$i',
                ),
                if (failed)
                  RelayMessage(
                    id: 'e$i',
                    role: 'system',
                    content: 'Synthetic failure',
                    createdAt: '2026-09-15T10:00:02Z',
                    kind: 'turn.failed',
                    turnId: 't$i',
                  ),
                RelayMessage(
                  id: 'f$i',
                  role: 'codex',
                  content: 'Final result $i.\n\nA short summary.',
                  createdAt: '2026-09-15T10:00:03Z',
                  kind: 'message.completed',
                  messagePhase: 'final',
                  turnId: 't$i',
                ),
              ],
            ];
            if (status == 'running') {
              controller.applyEventForTesting(
                RelayEvent(
                  cursor: 1,
                  eventId: 'start',
                  sessionId: 'root',
                  agentId: null,
                  createdAt: '2026-09-15T10:00:00Z',
                  event: {'kind': 'turn.started', 'turn_id': 't${count - 1}'},
                ),
              );
            }
            await pumpWorkbench(tester, controller, size: const Size(390, 844));
            for (var i = 0; i < 8; i++) {
              await tester.pump(const Duration(milliseconds: 32));
            }
            final list = find.byKey(
              const ValueKey('conversation-message-list'),
            );
            final scroll =
                tester.widget<ListView>(list).controller!
                    as ConversationScrollController;
            final header = find.byKey(
              ValueKey('turn-activity-header-turn:t$targetIndex'),
            );
            if (historical) {
              await tester.scrollUntilVisible(
                header,
                350,
                scrollable: find
                    .descendant(of: list, matching: find.byType(Scrollable))
                    .first,
                maxScrolls: 30,
              );
              await tester.ensureVisible(header);
              await tester.pump();
              scroll.jumpTo(
                (scroll.offset - 150).clamp(
                  scroll.position.minScrollExtent,
                  scroll.position.maxScrollExtent,
                ),
              );
              await tester.pump();
            }
            if (status == 'running' && !historical) {
              await tester.ensureVisible(header);
              await tester.pump();
              await tester.tap(header);
              await tester.pump();
            }
            void record(String stage) {
              debugPrint(
                'JUMP failed=$failed stage=$stage headerY=${header.evaluate().isEmpty ? 'UNMOUNTED' : tester.getTopLeft(header).dy.toStringAsFixed(1)} viewport=${tester.getRect(list)} offset=${scroll.offset.toStringAsFixed(1)} extent=${scroll.position.maxScrollExtent.toStringAsFixed(1)} follows=${scroll.followsLatest}',
              );
            }

            record('before');
            final before = tester.getTopLeft(header).dy;
            expect(header.hitTestable(), findsOneWidget);
            await tester.tap(header);
            if (status == 'running') {
              controller.messages['root'] = [
                for (final message in controller.messages['root']!)
                  message.id == 'p$targetIndex'
                      ? message.copyWith(
                          content:
                              '${message.content}\n\nAn update arriving during expansion.',
                        )
                      : message,
              ];
              controller.notifyListeners();
            }
            await tester.pump();
            record('expanded-frame1');
            expect(tester.getTopLeft(header).dy, closeTo(before, 1));
            await tester.pump();
            record('expanded-frame2');
            expect(tester.getTopLeft(header).dy, closeTo(before, 1));
            await tester.pump(const Duration(milliseconds: 250));
            record('expanded-settled');
            for (var frame = 0; frame < 40; frame++) {
              await tester.pump(const Duration(milliseconds: 16));
              expect(tester.getTopLeft(header).dy, closeTo(before, 1));
            }
            record('expanded-later');
            expect(tester.getTopLeft(header).dy, closeTo(before, 1));
            expect(header.hitTestable(), findsOneWidget);
            await tester.tap(header);
            await tester.pump();
            record('collapsed-frame1');
            expect(header, findsOneWidget);
            expect(tester.getTopLeft(header).dy, closeTo(before, 1));
            await tester.pump();
            record('collapsed-frame2');
            await tester.pump(const Duration(milliseconds: 250));
            record('collapsed-settled');
            for (var frame = 0; frame < 40; frame++) {
              await tester.pump(const Duration(milliseconds: 16));
              expect(tester.getTopLeft(header).dy, closeTo(before, 1));
            }
            record('collapsed-later');
            expect(tester.getTopLeft(header).dy, closeTo(before, 1));
            expect(tester.takeException(), isNull);
          },
        );
      }
    }
  }
}
