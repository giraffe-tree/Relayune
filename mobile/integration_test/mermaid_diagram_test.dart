import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relayune_mobile/src/widgets/incremental_markdown_body.dart';
import 'package:relayune_mobile/src/widgets/drawer_swipe_region.dart';
import 'package:relayune_mobile/src/widgets/mermaid_diagram.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  // Synthetic architecture diagram: two columns, joins, branches and enough
  // vertical depth to overflow both axes at the previous native-size default.
  const source = '''flowchart TD
S[来源会话 session] --> A[AutoMemory]
E[外部资料与研究记录] --> R[AutoResearch]
A --> D[daily：来源明确的日常记忆]
R --> D
D --> X[检索索引与目录快照]
D --> G[digest：整理后的长期记忆]
X --> Q[用户问题与相关记忆检索]
G --> Q
Q --> P[Application 应用入口]
P --> J[Job 任务编排]
J --> T[Step 执行与持久化]
T --> F[失败恢复与重试]
F --> V[生成可追溯的最终结果]
classDef accent fill:#12634b,stroke:#68dbb1,color:#ffffff
class D,G accent''';

  testWidgets(
    'real Mermaid message supports overview, gestures, selection and fullscreen',
    (tester) async {
      Future<void> screenshot(String name) async {
        // Native iOS snapshots may precede the final rasterized animation frame
        // even after Flutter has settled. Allow the platform compositor to catch up.
        await tester.pumpAndSettle();
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 400)),
        );
        await binding.takeScreenshot(name);
      }

      for (final dark in [true, false]) {
        final scroll = ScrollController();
        await tester.pumpWidget(
          MaterialApp(
            key: ValueKey(dark),
            theme: dark ? ThemeData.dark() : ThemeData.light(),
            debugShowCheckedModeBanner: false,
            home: Scaffold(
              drawer: const Drawer(child: Text('导航')),
              body: DiagramScrollRegion(
                child: DrawerSwipeRegion(
                  child: SafeArea(
                    child: ListView(
                      key: const ValueKey('conversation-message-list'),
                      controller: scroll,
                      reverse: true,
                      padding: const EdgeInsets.all(16),
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const SizedBox(height: 500),
                            IncrementalMarkdownBody(
                              data:
                                  '架构中的记忆生成、整理与检索：\n\n```mermaid\n$source\n```\n\n文件是持久事实来源。',
                              streaming: false,
                              styleSheet: MarkdownStyleSheet(),
                            ),
                            const SizedBox(height: 200),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        for (
          var i = 0;
          i < 100 && find.byType(SvgPicture).evaluate().isEmpty;
          i++
        ) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(find.byType(SvgPicture), findsOneWidget);
        await Scrollable.ensureVisible(
          tester.element(find.byType(MermaidDiagramPreview)),
          alignment: .5,
        );
        await tester.pumpAndSettle();
        final chart = find.byType(MermaidDiagramPreview);
        final picture = find.byType(SvgPicture);
        void expectFits(Finder container) {
          final bounds = tester.getRect(container).inflate(.1);
          expect(bounds.contains(tester.getTopLeft(picture)), isTrue);
          expect(bounds.contains(tester.getBottomRight(picture)), isTrue);
        }

        expectFits(chart);
        expect(find.byType(InteractiveViewer), findsNothing);
        await screenshot('mermaid-${dark ? 'dark' : 'light'}-overview');
        final listOffset = scroll.offset;
        await tester.drag(picture, const Offset(0, 70));
        await tester.pumpAndSettle();
        expect(scroll.offset, isNot(closeTo(listOffset, 1)));
        await tester.ensureVisible(find.text('放大操作'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('放大操作'));
        await tester.pumpAndSettle();
        expect(find.byType(SelectionArea), findsNothing);
        final viewer = find.byType(InteractiveViewer);
        final screen =
            Offset.zero &
            tester.view.physicalSize / tester.view.devicePixelRatio;
        expect(screen.contains(tester.getTopLeft(viewer)), isTrue);
        expect(screen.contains(tester.getBottomRight(viewer)), isTrue);
        final transform = tester
            .widget<InteractiveViewer>(viewer)
            .transformationController!;
        expect(transform.value.getMaxScaleOnAxis(), greaterThan(1));
        final scrollBeforePan = scroll.offset;
        final x = transform.value.storage[12];
        final y = transform.value.storage[13];
        await tester.drag(viewer, const Offset(-70, -70));
        await tester.pumpAndSettle();
        expect(transform.value.storage[12], lessThan(x - 30));
        expect(transform.value.storage[13], lessThan(y - 30));
        expect(scroll.offset, closeTo(scrollBeforePan, .1));
        await tester.drag(viewer, const Offset(90, 0));
        await tester.pumpAndSettle();
        expect(
          tester.state<ScaffoldState>(find.byType(Scaffold)).isDrawerOpen,
          isFalse,
        );
        final beforePinch = transform.value.getMaxScaleOnAxis();
        final center = tester.getCenter(viewer);
        final left = await tester.createGesture(pointer: 1);
        final right = await tester.createGesture(pointer: 2);
        await left.down(center - const Offset(80, 0));
        await right.down(center + const Offset(80, 0));
        for (var i = 1; i <= 10; i++) {
          await left.moveTo(center - Offset(80 - i * 5, 0));
          await right.moveTo(center + Offset(80 - i * 5, 0));
          await tester.pump(const Duration(milliseconds: 16));
        }
        await left.up();
        await right.up();
        await tester.pumpAndSettle();
        expect(transform.value.getMaxScaleOnAxis(), lessThan(beforePinch * .8));
        await screenshot('mermaid-${dark ? 'dark' : 'light'}-interactive');
        await tester.tap(find.byTooltip('适应全图'));
        await tester.pumpAndSettle();
        expect(transform.value, Matrix4.identity());
        expectFits(viewer);
        await tester.tap(find.text('完成'));
        await tester.pumpAndSettle();
        expect(find.byType(SelectionArea), findsOneWidget);
        await tester.ensureVisible(find.text('文件是持久事实来源。'));
        await tester.pumpAndSettle();
        await tester.longPress(find.text('文件是持久事实来源。'));
        await tester.pumpAndSettle();
        final selection = tester
            .state<SelectionAreaState>(find.byType(SelectionArea))
            .selectableRegion;
        expect(
          selection.contextMenuButtonItems.any(
            (item) => item.type == ContextMenuButtonType.copy,
          ),
          isTrue,
        );
        selection.selectAll(SelectionChangedCause.toolbar);
        await tester.pumpAndSettle();
        selection.contextMenuButtonItems
            .singleWhere((item) => item.type == ContextMenuButtonType.copy)
            .onPressed!();
        await tester.pumpAndSettle();
        final copied = (await Clipboard.getData('text/plain'))?.text ?? '';
        expect(copied, contains('架构中的记忆生成、整理与检索：'));
        expect(copied, contains('文件是持久事实来源。'));
        expect(copied, isNot(contains('放大操作')));
        // Dismiss selection before opening the fullscreen route.
        await tester.ensureVisible(find.text('放大操作'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('放大操作'));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('全屏查看图表'));
        await tester.pumpAndSettle();
        expect(find.byType(Dialog), findsOneWidget);
        final fullscreen = find.byType(InteractiveViewer).last;
        final fullscreenTransform = tester
            .widget<InteractiveViewer>(fullscreen)
            .transformationController!;
        expect(fullscreenTransform.value, Matrix4.identity());
        final fullPicture = find.byType(SvgPicture).last;
        final bounds = tester.getRect(fullscreen).inflate(.1);
        expect(bounds.contains(tester.getTopLeft(fullPicture)), isTrue);
        expect(bounds.contains(tester.getBottomRight(fullPicture)), isTrue);
        await screenshot('mermaid-${dark ? 'dark' : 'light'}-fullscreen');
        await tester.tap(find.byTooltip('放大图表'));
        await tester.pumpAndSettle();
        expect(fullscreenTransform.value.getMaxScaleOnAxis(), greaterThan(1));
        await tester.tap(find.byType(CloseButton));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Mermaid'));
        await tester.pumpAndSettle();
        expect(find.text('$source\n'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        await tester.pumpAndSettle();
        scroll.dispose();
      }
    },
  );
}
