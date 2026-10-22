import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/history_load_progress.dart';
import 'package:relayune_mobile/src/widgets/history_text_light.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets('file access guidance remains visible on a narrow conversation', (
    tester,
  ) async {
    final controller = workbenchController()..catalogFileAccessLimited = true;
    addTearDown(controller.dispose);
    await pumpWorkbench(
      tester,
      controller,
      size: const Size(320, 700),
      textScale: 1.3,
    );
    expect(find.textContaining('文件与文件夹'), findsOneWidget);
    controller.clearBanners();
    await tester.pump();
    expect(find.textContaining('文件与文件夹'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('first history read uses the centered branded loading state', (
    tester,
  ) async {
    final controller = workbenchController();
    addTearDown(controller.dispose);
    controller.historyLoading.add('root');

    await pumpWorkbench(
      tester,
      controller,
      size: const Size(320, 700),
      textScale: 1.3,
    );
    await tester.pump(const Duration(milliseconds: 80));

    final loading = find.byKey(const ValueKey('history-loading-state'));
    expect(loading, findsOneWidget);
    expect(tester.getSize(loading).height, greaterThan(200));
    expect(find.text('正在读取历史消息'), findsOneWidget);
    expect(find.byType(HistoryTextLight), findsOneWidget);
    expect(find.textContaining('每次最多 500 条'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'recovered uncertain send shows confirmation guidance rather than a spinner',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = const [
        RelayMessage(
          id: 'pending',
          role: 'user',
          content: '保存的输入',
          createdAt: '2026-08-10T10:00:00Z',
          kind: 'local.user.message',
          clientMessageId: 'pending',
          deliveryState: MessageDeliveryState.unconfirmed,
        ),
      ];
      await pumpWorkbench(tester, controller);
      expect(
        find.byKey(const ValueKey('message-delivery-unconfirmed')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('message-delivery-sending')),
        findsNothing,
      );
      expect(find.byTooltip('尚未确认消息的处理状态，请刷新会话查看。'), findsOneWidget);
    },
  );

  testWidgets(
    'current request stages stay visible on a narrow initial load and leave immediately',
    (tester) async {
      final controller = workbenchController(
        baseController: _ProgressController(),
      );
      addTearDown(controller.dispose);
      controller.historyLoading.add('root');
      for (final scale in [1.3, 2.0]) {
        await pumpWorkbench(
          tester,
          controller,
          size: const Size(320, 700),
          textScale: scale,
        );
        expect(find.text('正在读取历史消息'), findsOneWidget);
        expect(find.text('等待电脑回应'), findsOneWidget);
        expect(tester.takeException(), isNull);
      }
      controller.historyLoading.clear();
      controller.messages['root'] = const [
        RelayMessage(
          id: 'ready',
          role: 'codex',
          content: '内容已经准备好',
          createdAt: '2026-08-10T10:00:00Z',
          kind: 'message.completed',
        ),
      ];
      controller.notifyListeners();
      await tester.pump();
      expect(find.byKey(const ValueKey('history-loading-state')), findsNothing);
      expect(find.text('内容已经准备好'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'cached conversation remains visible with no loader during background refresh',
    (tester) async {
      final controller = workbenchController(
        baseController: _ProgressController(),
      );
      addTearDown(controller.dispose);
      controller.messages['root'] = const [
        RelayMessage(
          id: 'saved',
          role: 'codex',
          content: '本地内容',
          createdAt: '2026-08-10T10:00:00Z',
          kind: 'message.completed',
        ),
      ];
      controller.historyLoading.add('root');
      await pumpWorkbench(tester, controller);
      expect(find.text('本地内容'), findsOneWidget);
      expect(find.byKey(const ValueKey('history-loading-state')), findsNothing);
      expect(find.byType(HistoryTextLight), findsNothing);
    },
  );

  testWidgets('earlier history read stays compact above existing messages', (
    tester,
  ) async {
    final controller = workbenchController();
    addTearDown(controller.dispose);
    controller.messages['root'] = const [
      RelayMessage(
        id: 'existing-message',
        role: 'codex',
        content: '已经显示的消息',
        createdAt: '2026-08-10T10:00:00Z',
        kind: 'message.completed',
        turnId: 'turn-1',
      ),
    ];
    controller.historyLoading.add('root');
    controller.historyEarlierLoading.add('root');

    await pumpWorkbench(
      tester,
      controller,
      size: const Size(320, 700),
      textScale: 1.3,
    );
    await tester.pump(const Duration(milliseconds: 80));

    final loading = find.byKey(const ValueKey('history-loading-state'));
    expect(tester.getSize(loading).height, 54);
    expect(find.text('正在读取更早记录…'), findsOneWidget);
    expect(find.text('已经显示的消息'), findsOneWidget);
    expect(
      tester.widget<HistoryTextLight>(find.byType(HistoryTextLight)).compact,
      isTrue,
    );
    controller.historyLoading.clear();
    controller.notifyListeners();
    await tester.pump();
    expect(find.byType(HistoryTextLight), findsNothing);
    expect(find.text('已经显示的消息'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

class _ProgressController extends AppController {
  @override
  HistoryLoadProgress? historyProgressFor(String sessionId) =>
      HistoryLoadProgress(
        requestId: 'request',
        phase: HistoryLoadPhase.waiting,
        readElapsed: () => const Duration(seconds: 2),
      );
}
