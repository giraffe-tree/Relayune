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
      'wide ${dark ? 'dark' : 'light'} chart keeps readable size, colors and pan/fullscreen',
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
                  child: RepaintBoundary(
                    key: boundaryKey,
                    child: MermaidDiagramPreview(svg: svg, source: source),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('左右滑动查看完整图表'), findsOneWidget);
        final picture = find.byType(SvgPicture);
        final size = tester.getSize(picture);
        expect(size.width, greaterThan(600));
        expect(size.height, lessThan(180));
        final boundary =
            boundaryKey.currentContext!.findRenderObject()!
                as RenderRepaintBoundary;
        final image = (await tester.runAsync(() => boundary.toImage()))!;
        final pixels = (await tester.runAsync(
          () => image.toByteData(format: ui.ImageByteFormat.rawRgba),
        ))!.buffer.asUint8List();
        var visibleNodePixels = 0;
        for (var offset = 0; offset < pixels.length; offset += 4) {
          // Mermaid's standard node fill: lost styles produce black instead.
          if (dark
              ? pixels[offset] == 31 &&
                    pixels[offset + 1] == 32 &&
                    pixels[offset + 2] == 32
              : pixels[offset] == 236 &&
                    pixels[offset + 1] == 236 &&
                    pixels[offset + 2] == 255) {
            visibleNodePixels++;
          }
        }
        expect(visibleNodePixels, greaterThan(1000));
        var labelPixelsInsideNode = 0;
        for (var y = 65; y < 95; y++) {
          for (var x = 30; x < 140; x++) {
            final offset = (y * image.width + x) * 4;
            if (pixels[offset + 3] > 200 &&
                (dark ? pixels[offset] > 150 : pixels[offset] < 100)) {
              labelPixelsInsideNode++;
            }
          }
        }
        // Nested tspan transforms used to place the label outside this node.
        expect(labelPixelsInsideNode, greaterThan(30));
        final screenshotDirectory =
            Platform.environment['MERMAID_QA_SCREENSHOTS'];
        if (screenshotDirectory != null) {
          final png = await tester.runAsync(
            () => image.toByteData(format: ui.ImageByteFormat.png),
          );
          File(
            '$screenshotDirectory/mermaid-${dark ? 'dark' : 'light'}.png',
          ).writeAsBytesSync(png!.buffer.asUint8List());
        }
        image.dispose();
        final before = tester.getTopLeft(picture);
        await tester.drag(
          find.byType(InteractiveViewer),
          const Offset(-200, 0),
        );
        await tester.pumpAndSettle();
        expect(tester.getTopLeft(picture).dx, lessThan(before.dx - 100));
        expect(tester.getSize(picture), size);
        await tester.tap(find.byTooltip('全屏查看图表'));
        await tester.pumpAndSettle();
        expect(find.byType(Dialog), findsOneWidget);
        expect(tester.getSize(find.byType(SvgPicture).last).width, size.width);
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
