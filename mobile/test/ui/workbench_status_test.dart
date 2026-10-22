import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/network/realtime_client.dart';
import 'package:relayune_mobile/src/widgets/device_connection_icon.dart';

import '../support/workbench_fixture.dart';
import 'package:relayune_mobile/src/models.dart';

void main() {
  for (final live in [true, false]) {
    testWidgets('stream failure stays visible after final text (live: $live)', (
      tester,
    ) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = [
        RelayMessage.fromHistory({
          'id': 'answer',
          'role': 'codex',
          'content': '已保存当前进度',
          'created_at': '2026-10-08T01:00:00Z',
          'turn_id': 'failed-turn',
          'message_phase': 'final_answer',
        }),
      ];
      const failure =
          'stream disconnected before completion: error sending request';
      if (live) {
        controller.runningSessions.add('root');
        controller.applyEventForTesting(
          const RelayEvent(
            cursor: 1,
            eventId: 'stream-failed',
            sessionId: 'root',
            agentId: null,
            createdAt: '2026-10-08T01:01:00Z',
            event: {
              'kind': 'turn.failed',
              'turn_id': 'failed-turn',
              'status': 'failed',
              'error': failure,
            },
          ),
        );
      } else {
        controller.messages['root']!.add(
          RelayMessage.fromHistory({
            'id': 'turn-terminal:failed-turn',
            'role': 'system',
            'kind': 'turn.failed',
            'content': failure,
            'created_at': '2026-10-08T01:01:00Z',
            'turn_id': 'failed-turn',
            'turn_status': 'failed',
          }),
        );
      }
      await pumpWorkbench(tester, controller);
      expect(controller.runningSessions, isNot(contains('root')));
      expect(find.text('本次处理未完成'), findsOneWidget);
      expect(find.text('本轮完成'), findsNothing);
      expect(find.text('已保存当前进度'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('turn-activity-header-turn:failed-turn')),
      );
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.text(failure), findsOneWidget);
    });
  }

  for (final active in [true, false]) {
    testWidgets('tool failure does not fail a turn (active: $active)', (
      tester,
    ) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = [
        const RelayMessage(
          id: 'user',
          role: 'user',
          content: 'inspect project',
          createdAt: '2026-09-11T17:33:44Z',
          kind: 'user.message',
          turnId: 'retry-turn',
        ),
        const RelayMessage(
          id: 'failed-command',
          role: 'system',
          content: 'exit code 1',
          createdAt: '2026-09-11T17:33:48Z',
          kind: 'tool.completed',
          turnId: 'retry-turn',
          toolActivityType: 'command',
          toolActivityLabel: 'first attempt',
          toolActivityCommand: 'first attempt',
          toolActivityStatus: 'failed',
        ),
        const RelayMessage(
          id: 'recovered-command',
          role: 'system',
          content: '',
          createdAt: '2026-09-11T17:33:50Z',
          kind: 'tool.completed',
          turnId: 'retry-turn',
          toolActivityType: 'command',
          toolActivityLabel: 'second attempt',
          toolActivityCommand: 'second attempt',
          toolActivityStatus: 'completed',
        ),
      ];
      if (active) controller.runningSessions.add('root');
      await pumpWorkbench(tester, controller);
      expect(find.text('任务失败'), findsNothing);
      expect(find.text('本次处理未完成'), findsNothing);
      expect(find.text(active ? '处理中' : '处理记录'), findsOneWidget);
      if (!active) {
        await tester.tap(
          find.byKey(const ValueKey('turn-activity-header-turn:retry-turn')),
        );
        await tester.pump(const Duration(milliseconds: 350));
      }
      expect(find.text('已执行 2 个命令'), findsOneWidget);
      expect(find.textContaining('命令时有失败'), findsNothing);
      await tester.tap(find.text('已执行 2 个命令'));
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.textContaining('first attempt'), findsWidgets);
      expect(find.byIcon(Icons.error_outline_rounded), findsWidgets);
    });
  }

  testWidgets(
    'interrupted tool turn shows stopped with its full elapsed time',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = [
        const RelayMessage(
          id: 'user-stop',
          role: 'user',
          content: 'sleep 90',
          createdAt: '2026-09-11T17:33:44Z',
          kind: 'user.message',
          turnId: 'stop-turn',
        ),
        const RelayMessage(
          id: 'tool-stop',
          role: 'system',
          content: '',
          createdAt: '2026-09-11T17:33:48Z',
          kind: 'tool.completed',
          turnId: 'stop-turn',
          toolActivityLabel: 'sleep 90',
          toolActivityStatus: 'failed',
        ),
      ];
      controller.applyEventForTesting(
        const RelayEvent(
          cursor: 1,
          eventId: 'stop-complete',
          sessionId: 'root',
          agentId: null,
          createdAt: '2026-09-11T17:34:40Z',
          event: {
            'kind': 'turn.completed',
            'turn_id': 'stop-turn',
            'status': 'interrupted',
          },
        ),
      );
      await pumpWorkbench(tester, controller);
      expect(find.text('已停止'), findsOneWidget);
      expect(find.text('任务失败'), findsNothing);
      expect(find.textContaining('56 秒'), findsOneWidget);
      expect(controller.messages['root']!.last.kind, 'turn.stopped');
      expect(controller.runningSessions, isNot(contains('root')));
    },
  );

  testWidgets(
    'recovered command failure shows turn completed and preserves details',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = const [
        RelayMessage(
          id: 'cmd',
          role: 'system',
          content: '',
          createdAt: '2026-09-11T01:00:00Z',
          kind: 'tool_activity',
          turnId: 'recovered',
          toolActivityLabel: 'Run command',
          toolActivityType: 'command',
          toolActivityStatus: 'failed',
          toolActivityDetail: 'exit code 1',
        ),
        RelayMessage(
          id: 'reply',
          role: 'codex',
          content: '安装完成',
          createdAt: '2026-09-11T01:03:09Z',
          kind: 'message',
          turnId: 'recovered',
          messagePhase: 'final_answer',
        ),
      ];
      await pumpWorkbench(tester, controller);
      expect(find.text('本轮完成'), findsOneWidget);
      expect(find.text('任务失败'), findsNothing);
      expect(find.text('安装完成'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('turn-activity-header-turn:recovered')),
      );
      await tester.pump(const Duration(milliseconds: 350));
      expect(
        find.byKey(const ValueKey('tool-activity-failed-icon-cmd')),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    '[MOB-STA-004][flutter] failed submissions show an error and explain unavailable sessions',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = [
        const RelayMessage(
          id: 'failure',
          role: 'system',
          content:
              'Session old-session is not available in any configured local agent.',
          createdAt: '2026-08-10T10:00:00Z',
          kind: 'turn.failed',
        ),
      ];
      await pumpWorkbench(tester, controller);
      expect(find.text('本次处理未完成'), findsOneWidget);
      final header = find.byKey(
        const ValueKey('turn-activity-header-message:failure'),
      );
      expect(
        find.descendant(
          of: header,
          matching: find.byIcon(Icons.error_outline_rounded),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: header, matching: find.byIcon(Icons.check_rounded)),
        findsNothing,
      );
      await tester.tap(header);
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.textContaining('当前电脑暂时无法打开这个会话'), findsOneWidget);
      expect(
        find.textContaining('not available in any configured'),
        findsNothing,
      );
    },
  );

  testWidgets(
    '[MOB-STA-004][flutter] context header keeps the online state visible',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);

      expect(
        find.byKey(const ValueKey('workbench-online-status')),
        findsOneWidget,
      );
      expect(
        tester
            .widget<DeviceConnectionIcon>(
              find.byKey(const ValueKey('workbench-device-status-svg')),
            )
            .online,
        isTrue,
      );
      expect(find.text('在线'), findsNothing);
    },
  );

  testWidgets(
    '[MOB-OFF-002][flutter] offline conversation is cached-only and disables composer actions',
    (tester) async {
      final controller = workbenchController(online: false);
      controller.historyHasMore['root'] = true;
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);

      expect(
        tester
            .widget<DeviceConnectionIcon>(
              find.byKey(const ValueKey('workbench-device-status-svg')),
            )
            .online,
        isFalse,
      );
      expect(find.text('电脑离线 · 仅显示手机缓存记录'), findsOneWidget);
      expect(find.text('电脑离线 · 暂时无法发送消息'), findsOneWidget);
      expect(find.text('加载更早记录'), findsNothing);
      expect(
        tester.widget<TextField>(find.byType(TextField).last).enabled,
        isFalse,
      );
      expect(
        tester
            .widget<IconButton>(
              find.byKey(const ValueKey('attachment-picker-button')),
            )
            .onPressed,
        isNull,
      );

      await controller.applyRealtimeSignalForTesting(
        const RealtimeSignal(
          type: 'presence',
          deviceId: 'device',
          online: true,
          lastSeenAt: '2026-08-10T10:01:00Z',
          revision: 8,
        ),
      );
      await tester.pump();

      expect(
        tester
            .widget<DeviceConnectionIcon>(
              find.byKey(const ValueKey('workbench-device-status-svg')),
            )
            .online,
        isTrue,
      );
      expect(find.text('在线'), findsNothing);
      expect(find.text('发送指令到电脑…'), findsOneWidget);
      expect(find.text('加载更早记录'), findsOneWidget);
      expect(find.textContaining('暂时无法发送'), findsNothing);
    },
  );
}
