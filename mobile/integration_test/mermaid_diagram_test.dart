import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relayune_mobile/src/widgets/mermaid_diagram.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const source = '''flowchart LR
A[点击本地网页链接] -->|打开预览| B[手机 WebView]
B --> C[加密连接]
C -->|转发请求| D[本机网关]
D --> E[localhost 服务]
classDef accent fill:#12634b,stroke:#68dbb1,color:#ffffff
class C accent''';

  testWidgets('WebView Mermaid export renders readable native diagrams', (
    tester,
  ) async {
    for (final dark in [true, false]) {
      await tester.pumpWidget(
        MaterialApp(
          key: ValueKey(dark),
          theme: dark ? ThemeData.dark() : ThemeData.light(),
          home: Scaffold(
            body: SafeArea(
              child: SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text('当前完整链路是：'),
                      const MermaidDiagram(source: source),
                      const Text('具体分为五步。'),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      for (
        var attempt = 0;
        attempt < 100 && find.byType(SvgPicture).evaluate().isEmpty;
        attempt++
      ) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(find.byType(SvgPicture), findsOneWidget);
      await tester.pumpAndSettle();
      final size = tester.getSize(find.byType(SvgPicture));
      expect(size.width, greaterThan(600));
      expect(size.height, lessThan(180));
      await binding.takeScreenshot('mermaid-${dark ? 'dark' : 'light'}');
      await tester.drag(find.byType(InteractiveViewer), const Offset(-480, 0));
      await tester.pumpAndSettle();
      await binding.takeScreenshot('mermaid-${dark ? 'dark' : 'light'}-panned');
      await tester.tap(find.byTooltip('全屏查看图表'));
      await tester.pumpAndSettle();
      expect(find.byType(Dialog), findsOneWidget);
      expect(tester.getSize(find.byType(SvgPicture).last).width, size.width);
      await tester.tap(find.byType(CloseButton));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Mermaid'));
      await tester.pump();
      expect(find.text(source), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });
}
