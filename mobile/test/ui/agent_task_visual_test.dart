import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import '../support/workbench_fixture.dart';

void main() {
  testWidgets(
    'task overview and detail present results before technical information',
    (tester) async {
      const output = String.fromEnvironment('AGENT_TASK_SCREENSHOTS');
      const font = String.fromEnvironment('AGENT_TASK_FONT');
      if (font.isNotEmpty) {
        await tester.runAsync(() async {
          final bytes = await File(font).readAsBytes();
          for (final family in [
            'Ahem',
            'Roboto',
            '.SF UI Text',
            '.SF UI Display',
          ]) {
            await (FontLoader(
              family,
            )..addFont(Future.value(ByteData.sublistView(bytes)))).load();
          }
        });
      }
      const icons = String.fromEnvironment('AGENT_TASK_ICONS');
      if (icons.isNotEmpty) {
        await tester.runAsync(() async {
          final bytes = await File(icons).readAsBytes();
          await (FontLoader(
            'MaterialIcons',
          )..addFont(Future.value(ByteData.sublistView(bytes)))).load();
        });
      }
      final boundary = GlobalKey();
      final controller = workbenchController(
        agents: [
          task(
            'optics',
            '研究光学与扫描效果',
            'completed',
            result:
                '找到 **4 个可复用案例**，推荐先验证其中 2 个。\n\n- 用柔和光晕衬托标志，保持文字可读。\n- 扫描效果仅在入场时播放一次。\n\n[查看参考资料](https://example.com/reference)',
          ),
          task('motion', '研究艺术家官网动效', 'running', activity: '正在查看第三个参考网站'),
          task('layout', '整理创意工作室页面布局', 'running', activity: '正在比较作品页的阅读顺序'),
          task('contrast', '检查深色界面的可读性', 'unknown'),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(
        tester,
        controller,
        captureKey: boundary,
        testFontFamily: font.isNotEmpty ? 'Roboto' : null,
      );
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
      );
      await settle(tester);
      await capture(tester, boundary, output, 'tray');
      await tester.tap(find.byKey(const ValueKey('agent-tasks-view-all')));
      await settle(tester);
      expect(find.text('进行中'), findsOneWidget);
      expect(find.text('已完成'), findsWidgets);
      await capture(tester, boundary, output, 'overview');
      await tester.tap(
        find
            .byKey(const ValueKey('composer-agent-status-agent-optics'))
            .hitTestable(),
      );
      await settle(tester);
      expect(find.text('最新回复'), findsOneWidget);
      expect(find.text('运行信息'), findsNothing);
      expect(find.text('活动时间线'), findsNothing);
      expect(find.text('任务原文'), findsNothing);
      expect(find.textContaining('example-model'), findsOneWidget);
      expect(find.text('查看参考资料', findRichText: true), findsOneWidget);
      await capture(tester, boundary, output, 'detail');
      expect(tester.takeException(), isNull);
    },
  );
}

RelayAgent task(
  String id,
  String title,
  String status, {
  String? result,
  String? activity,
}) => RelayAgent(
  id: id,
  threadId: id,
  parentSessionId: 'root',
  name: title,
  nickname: 'Researcher',
  task: title,
  status: status,
  progress: 55,
  summary: result,
  activity: activity,
  model: 'example-model',
  updatedAt: '2026-09-09T09:30:00Z',
  toolCount: 5,
  tokenCount: 2400,
);
Future<void> settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 350));
}

Future<void> capture(
  WidgetTester tester,
  GlobalKey key,
  String output,
  String name,
) async {
  if (output.isEmpty) return;
  final boundary =
      key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 2);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await Directory(output).create(recursive: true);
    await File('$output/$name.png').writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}
