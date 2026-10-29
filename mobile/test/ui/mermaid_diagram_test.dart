import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:relayune_mobile/src/ui/secure_svg_preview.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/widgets/incremental_markdown_body.dart';
import 'package:relayune_mobile/src/widgets/mermaid_diagram.dart';

void main() {
  const source = 'flowchart TD\nA[用户账号] --> B[原始记录]\nB --> C[记录修订版本]';
  testWidgets(
    'real Mermaid Chinese flowchart is accepted and renders as native SVG',
    (tester) async {
      final svg = File(
        'test/fixtures/mermaid/flowchart.svg',
      ).readAsStringSync();
      expect(isSafeSvgPreviewSource(svg), isTrue);
      await tester.pumpWidget(
        MaterialApp(home: Scaffold(body: SvgPicture.string(svg))),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
  for (final dark in [true, false]) {
    testWidgets(
      'wide ${dark ? 'dark' : 'light'} chart fits completely and supports inline controls',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final svg = File(
          'test/fixtures/mermaid/wide-flowchart-${dark ? 'dark' : 'light'}.svg',
        ).readAsStringSync();
        expect(isSafeSvgPreviewSource(svg), isTrue);
        final boundaryKey = GlobalKey();
        await tester.pumpWidget(
          MaterialApp(
            theme: dark ? ThemeData.dark() : ThemeData.light(),
            home: Scaffold(
              body: SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: DiagramSelectionArea(
                    child: RepaintBoundary(
                      key: boundaryKey,
                      child: MermaidDiagramPreview(svg: svg, source: source),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byType(InteractiveViewer), findsNothing);
        expect(
          tester.getSize(find.byType(SvgPicture)).width,
          lessThanOrEqualTo(358),
        );
        final boundary =
            boundaryKey.currentContext!.findRenderObject()!
                as RenderRepaintBoundary;
        final image = (await tester.runAsync(() => boundary.toImage()))!;
        final pixels = (await tester.runAsync(
          () => image.toByteData(format: ui.ImageByteFormat.rawRgba),
        ))!.buffer.asUint8List();
        var nodePixels = 0;
        for (var offset = 0; offset < pixels.length; offset += 4) {
          if (dark
              ? pixels[offset] == 31 &&
                    pixels[offset + 1] == 32 &&
                    pixels[offset + 2] == 32
              : pixels[offset] == 236 &&
                    pixels[offset + 1] == 236 &&
                    pixels[offset + 2] == 255) {
            nodePixels++;
          }
        }
        expect(nodePixels, greaterThan(200));
        image.dispose();
        await tester.tap(find.text('放大操作'));
        await tester.pumpAndSettle();
        expect(find.byType(SelectionArea), findsNothing);
        final viewer = find.byType(InteractiveViewer);
        final transform = tester
            .widget<InteractiveViewer>(viewer)
            .transformationController!;
        expect(transform.value.getMaxScaleOnAxis(), greaterThan(1));
        final before = transform.value.storage[12];
        await tester.drag(viewer, const Offset(-100, 0));
        await tester.pumpAndSettle();
        expect(transform.value.storage[12], lessThan(before - 50));
        await tester.tap(find.byTooltip('适应全图'));
        await tester.pumpAndSettle();
        expect(transform.value, Matrix4.identity());
        await tester.tap(find.text('完成'));
        await tester.pumpAndSettle();
        expect(find.byType(SelectionArea), findsOneWidget);
        expect(find.byType(InteractiveViewer), findsNothing);
        await tester.tap(find.byTooltip('全屏查看图表'));
        await tester.pumpAndSettle();
        final fullscreen = tester.widget<InteractiveViewer>(
          find.byType(InteractiveViewer),
        );
        expect(fullscreen.transformationController!.value, Matrix4.identity());
        await tester.tap(find.byTooltip('放大图表'));
        await tester.pump();
        expect(
          fullscreen.transformationController!.value.getMaxScaleOnAxis(),
          greaterThan(1),
        );
        await tester.tap(find.byType(CloseButton));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Mermaid'));
        await tester.pump();
        expect(find.byType(SvgPicture), findsNothing);
        expect(find.text(source), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets(
    'wide and tall chart supports both pan axes and pinch inside a message',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 1600"><rect width="1400" height="1600" fill="#abcdef"/></svg>';
      final scroll = ScrollController();
      addTearDown(scroll.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: DiagramScrollRegion(
              child: SingleChildScrollView(
                controller: scroll,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: DiagramSelectionArea(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text('Before diagram'),
                        const MermaidDiagramPreview(svg: svg, source: source),
                        const Text('After diagram'),
                        const SizedBox(height: 1000),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final diagram = find.byType(MermaidDiagramPreview);
      final picture = find.byType(SvgPicture);
      expect(
        tester
            .getRect(diagram)
            .inflate(.01)
            .contains(tester.getTopLeft(picture)),
        isTrue,
      );
      expect(
        tester
            .getRect(diagram)
            .inflate(.01)
            .contains(tester.getBottomRight(picture)),
        isTrue,
      );
      await tester.drag(picture, const Offset(0, -60));
      await tester.pumpAndSettle();
      expect(scroll.offset, greaterThan(30));
      scroll.jumpTo(0);
      await tester.pumpAndSettle();
      await tester.tap(find.text('放大操作'));
      await tester.pumpAndSettle();
      final viewer = find.byType(InteractiveViewer);
      final transform = tester
          .widget<InteractiveViewer>(viewer)
          .transformationController!;
      final scrollBeforePan = scroll.offset;
      final x = transform.value.storage[12];
      final y = transform.value.storage[13];
      await tester.drag(viewer, const Offset(-100, -100));
      await tester.pumpAndSettle();
      expect(transform.value.storage[12], lessThan(x - 50));
      expect(transform.value.storage[13], lessThan(y - 50));
      expect(scroll.offset, scrollBeforePan);
      final scale = transform.value.getMaxScaleOnAxis();
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
      expect(transform.value.getMaxScaleOnAxis(), lessThan(scale * .8));
      await tester.tap(find.byTooltip('适应全图'));
      await tester.pumpAndSettle();
      expect(transform.value, Matrix4.identity());
      expect(
        tester
            .getRect(viewer)
            .inflate(.01)
            .contains(tester.getTopLeft(picture)),
        isTrue,
      );
      expect(
        tester
            .getRect(viewer)
            .inflate(.01)
            .contains(tester.getBottomRight(picture)),
        isTrue,
      );
      await tester.tap(find.text('完成'));
      await tester.pumpAndSettle();
      expect(find.byType(SelectionArea), findsOneWidget);
      await tester.drag(picture, const Offset(0, -60));
      await tester.pumpAndSettle();
      expect(scroll.offset, greaterThan(30));
      scroll.jumpTo(0);
      await tester.pumpAndSettle();
      await tester.longPress(find.text('After diagram'));
      await tester.pumpAndSettle();
      expect(find.text('Copy'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'narrow large-text preview and resized fullscreen keep the complete diagram',
    (tester) async {
      tester.view.physicalSize = const Size(320, 780);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 4000"><rect width="100" height="4000" fill="#abcdef"/></svg>';
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: const Scaffold(
            body: SingleChildScrollView(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: DiagramSelectionArea(
                  child: MermaidDiagramPreview(svg: svg, source: source),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('放大操作'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.byTooltip('全屏查看图表'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('放大图表'));
      await tester.pumpAndSettle();
      tester.view.physicalSize = const Size(780, 320);
      await tester.pumpAndSettle();
      final viewer = find.byType(InteractiveViewer).last;
      final transform = tester
          .widget<InteractiveViewer>(viewer)
          .transformationController!;
      expect(transform.value, Matrix4.identity());
      final picture = find.byType(SvgPicture).last;
      final bounds = tester.getRect(viewer).inflate(.01);
      expect(bounds.contains(tester.getTopLeft(picture)), isTrue);
      expect(bounds.contains(tester.getBottomRight(picture)), isTrue);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('removing an active diagram restores conversation scrolling', (
    tester,
  ) async {
    final visible = ValueNotifier(true);
    final scroll = ScrollController();
    addTearDown(visible.dispose);
    addTearDown(scroll.dispose);
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><rect width="400" height="600" fill="#abcdef"/></svg>';
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: DiagramScrollRegion(
            child: SingleChildScrollView(
              controller: scroll,
              child: Column(
                children: [
                  ValueListenableBuilder<bool>(
                    valueListenable: visible,
                    builder: (_, show, _) => show
                        ? const DiagramSelectionArea(
                            child: MermaidDiagramPreview(
                              svg: svg,
                              source: source,
                            ),
                          )
                        : const SizedBox(
                            height: 400,
                            child: Text('Replacement message'),
                          ),
                  ),
                  const SizedBox(height: 1000),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('放大操作'));
    await tester.pumpAndSettle();
    visible.value = false;
    await tester.pumpAndSettle();
    await tester.drag(find.text('Replacement message'), const Offset(0, -100));
    await tester.pumpAndSettle();
    expect(scroll.offset, greaterThan(50));
    expect(tester.takeException(), isNull);
  });
  test(
    'recognizes explicit Mermaid and bare flowcharts without stealing code',
    () {
      expect(isMermaidBlock(source, null), isTrue);
      expect(isMermaidBlock(source, 'language-mermaid'), isTrue);
      expect(
        isMermaidBlock('sequenceDiagram\nA->>B: Hi', 'language-mermaid'),
        isTrue,
      );
      expect(isMermaidBlock(source, 'language-dart'), isFalse);
      expect(isMermaidBlock('ordinary text', null), isFalse);
      expect(isMermaidBlock('x' * 20001, 'mermaid'), isFalse);
    },
  );
  test(
    'document treats source as data and blocks network and configuration',
    () {
      final document = buildMermaidDocument(
        '</script><img src="https://bad.test">',
        '',
        dark: true,
      );
      expect(document, isNot(contains('<img')));
      expect(document, contains("connect-src 'none'"));
      expect(document, contains("securityLevel:'strict'"));
      expect(document, contains('htmlLabels:false'));
      expect(document, contains('maxEdges:200'));
    },
  );
  testWidgets(
    'complete code blocks render; streaming, inline and ordinary code stay text',
    (tester) async {
      Future<void> pump(String data, {bool streaming = false}) =>
          tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: SingleChildScrollView(
                  child: IncrementalMarkdownBody(
                    data: data,
                    streaming: streaming,
                    styleSheet: MarkdownStyleSheet(),
                  ),
                ),
              ),
            ),
          );
      for (final tag in ['mermaid', '', 'flowchart']) {
        await pump('Before\n\n```$tag\n$source\n```\n\nAfter');
        expect(find.byType(MermaidDiagram), findsOneWidget);
        expect(
          find.text(source),
          findsNothing,
        ); // Markdown adds a trailing newline.
        expect(
          find.text('$source\n'),
          findsOneWidget,
        ); // Unsupported WebView fallback.
        expect(find.text('After'), findsOneWidget);
      }
      await pump('```mermaid\n$source', streaming: true);
      expect(find.byType(MermaidDiagram), findsNothing);
      expect(find.text(source), findsOneWidget);
      await pump('```dart\n$source\n```');
      expect(find.byType(MermaidDiagram), findsNothing);
      expect(find.text(source), findsOneWidget);
      for (final streaming in [true, false]) {
        for (final tag in ['bash', 'python', 'unknown', '']) {
          const command =
              'gh auth refresh --hostname github.com --scopes project';
          await pump(
            'Before\n\n```$tag\n$command\n```\n\nAfter',
            streaming: streaming,
          );
          expect(find.text(command), findsOneWidget);
          expect(find.text('After'), findsOneWidget);
        }
      }
      const embedded = '```bash\n<code> & `literal`\n```';
      await pump('````markdown\n$embedded\n````');
      expect(find.text(embedded), findsOneWidget);
      const verify = 'gh project list --owner byome-online';
      await pump('完成后可验证：\n\n```bash\n$verify\n```');
      expect(find.text(verify), findsOneWidget);
      await pump('    print("indented")');
      expect(find.text('print("indented")'), findsOneWidget);
      await pump('`flowchart TD`');
      expect(find.byType(MermaidDiagram), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
