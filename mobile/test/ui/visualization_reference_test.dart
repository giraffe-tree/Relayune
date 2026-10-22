import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/ui/visualization_reference.dart';

import '../support/workbench_fixture.dart';

void main() {
  const marker =
      '\uE200visualize\uE202{"path":"/private/design.html","mode":"wide"}\uE201';
  String display(String value, {bool links = true}) =>
      displayVisualizationReferences(value, label: '可视化', links: links);

  test(
    'visualization markers become concise attachment links without hiding surrounding prose',
    () {
      expect(
        display('之前\n$marker\n之后'),
        '之前\n[可视化](</private/design.html>)\n之后',
      );
      expect(display(marker, links: false), '可视化');
    },
  );

  test(
    'partial and malformed streaming markers never expose internal JSON',
    () {
      for (final value in [
        '\uE200visualize',
        '\uE200visualize\uE202{"path":"/private/des',
        '\uE200visualize\uE202not-json\uE201',
        '\uE200visualize\uE202{"path":"https://example.com/design.html"}\uE201',
        '\uE200visualize\uE202{"path":"/private/secret.txt"}\uE201',
      ]) {
        expect(display(value), '可视化');
      }
    },
  );

  test('literal code examples and unrelated markdown remain intact', () {
    final source = '```text\n$marker\n```\n[文件](/tmp/readme.md)';
    expect(display(source), source);
  });

  testWidgets(
    'cached assistant visualization no longer displays the host marker or path',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = [
        const RelayMessage(
          id: 'visualization',
          role: 'codex',
          content: '设计方案\n\n$marker\n\n说明文字',
          createdAt: '2026-09-07T14:00:00Z',
          kind: 'message.completed',
        ),
      ];
      await pumpWorkbench(tester, controller, disableAnimations: true);
      await tester.pumpAndSettle();
      final markdown = tester.widget<MarkdownBody>(find.byType(MarkdownBody));
      expect(markdown.data, contains('[可视化](</private/design.html>)'));
      expect(markdown.data, isNot(contains('\uE200')));
      expect(find.textContaining('"path"', findRichText: true), findsNothing);
      expect(
        find.textContaining('/private/design.html', findRichText: true),
        findsNothing,
      );
      expect(find.textContaining('可视化', findRichText: true), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
