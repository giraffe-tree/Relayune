import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/ui/local_web_preview.dart';

import '../support/workbench_fixture.dart';

class PreviewController extends AppController {
  int opens = 0;
  Completer<Map<String, dynamic>>? pending;

  @override
  Future<Map<String, dynamic>> requestLocalWeb(
    String sessionId,
    Map<String, dynamic> payload, {
    bool open = false,
    DownloadProgressCallback? onProgress,
  }) async {
    if (!open) return {};
    opens++;
    if (pending != null) return pending!.future;
    throw StateError('synthetic unavailable desktop');
  }
}

void main() {
  Future<PreviewController> enter(
    WidgetTester tester, {
    bool supported = true,
    bool pending = false,
  }) async {
    rootBundle.evict('assets/local_web/font-fallback.js');
    tester.binding.defaultBinaryMessenger.setMockMessageHandler(
      'flutter/assets',
      (data) async {
        if (data != null &&
            utf8.decode(
                  data.buffer.asUint8List(
                    data.offsetInBytes,
                    data.lengthInBytes,
                  ),
                ) ==
                'assets/local_web/font-fallback.js') {
          return ByteData.sublistView(
            Uint8List.fromList(utf8.encode('// test asset')),
          );
        }
        return null;
      },
    );
    addTearDown(() {
      rootBundle.evict('assets/local_web/font-fallback.js');
      tester.binding.defaultBinaryMessenger.setMockMessageHandler(
        'flutter/assets',
        null,
      );
    });
    final base = PreviewController();
    if (pending) base.pending = Completer<Map<String, dynamic>>();
    final controller = workbenchController(baseController: base);
    addTearDown(controller.dispose);
    controller.desktopInfo = RelayDesktopInfo(supportsLocalWeb: supported);
    controller.messages['root'] = [
      RelayMessage(
        id: 'local-link',
        role: 'codex',
        content: '[接手指南](http://127.0.0.1:8766/chapter#auth)',
        createdAt: '2026-09-24T00:00:00Z',
        kind: 'message.completed',
      ),
    ];
    await pumpWorkbench(tester, controller, disableAnimations: true);
    await tester.pumpAndSettle();
    await tester.tap(find.text('接手指南'));
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    return base;
  }

  testWidgets(
    'link starts opening once without a confirmation, retry is explicit',
    (tester) async {
      final controller = await enter(tester);
      expect(controller.opens, 1);
      expect(find.byType(LocalWebPreview), findsOneWidget);
      expect(find.text('打开网页'), findsNothing);
      expect(find.textContaining('此页面可以加载资源'), findsNothing);
      expect(find.text('127.0.0.1:8766'), findsNWidgets(2));
      expect(
        tester
            .widget<IconButton>(
              find.byWidgetPredicate(
                (w) => w is IconButton && w.tooltip == '上一页',
              ),
            )
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<IconButton>(
              find.byWidgetPredicate(
                (w) => w is IconButton && w.tooltip == '下一页',
              ),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byType(FilledButton));
      await tester.pumpAndSettle();
      expect(controller.opens, 2);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'unsupported desktop makes no request; address details and close work',
    (tester) async {
      final controller = await enter(tester, supported: false);
      expect(controller.opens, 0);
      expect(find.text('请更新桌面端后再预览电脑网页。'), findsOneWidget);
      expect(find.byType(FilledButton), findsNothing);
      await tester.tap(find.text('127.0.0.1:8766').last);
      await tester.pumpAndSettle();
      expect(find.text('http://127.0.0.1:8766/chapter#auth'), findsOneWidget);
      expect(find.byType(SelectableText), findsOneWidget);
      Navigator.of(tester.element(find.byType(SelectableText))).pop();
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('关闭'));
      await tester.pumpAndSettle();
      expect(find.byType(LocalWebPreview), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'background cancels pending open; returning does not silently reopen',
    (tester) async {
      final controller = await enter(tester, pending: true);
      expect(controller.opens, 1);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      controller.pending!.complete({'preview_id': 'stale'});
      await tester.pumpAndSettle();
      expect(controller.opens, 1);
      expect(find.text('应用离开前台后已关闭预览，重新打开即可继续。'), findsOneWidget);
      expect(find.text('打开网页'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
