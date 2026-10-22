import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/widgets/incremental_markdown_body.dart';

void main() {
  testWidgets(
    'large unsplittable streaming documents render the latest frame and flush completion',
    (tester) async {
      final style = MarkdownStyleSheet(p: const TextStyle(fontSize: 14));
      final prefix = '```text\n${'line\n' * 1800}';
      Future<void> pump(String data, {bool streaming = true}) =>
          tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: SingleChildScrollView(
                  child: IncrementalMarkdownBody(
                    data: data,
                    streaming: streaming,
                    styleSheet: style,
                  ),
                ),
              ),
            ),
          );
      await pump(prefix);
      MarkdownBody rendered() =>
          tester.widgetList<MarkdownBody>(find.byType(MarkdownBody)).first;
      final first = rendered();
      for (var i = 1; i <= 3; i++) {
        await pump('$prefix${'new' * i}');
        await tester.pump(const Duration(milliseconds: 40));
        expect(rendered(), same(first));
      }
      await tester.pump(const Duration(milliseconds: 40));
      expect(rendered().data, '${prefix}newnewnew');
      await pump('${prefix}final\n```', streaming: false);
      expect(rendered().data, '${prefix}final\n```');
      await tester.pumpWidget(const SizedBox());
      await tester.pump(IncrementalMarkdownBody.largeDocumentInterval);
      expect(tester.takeException(), isNull);
    },
  );

  test('nested blocks and document references are not split', () {
    for (final block in [
      '```dart\nfirst\n\nsecond\n```',
      '~~~\nfirst\n\nsecond\n~~~',
      '- first\n\n  continuation\n\n- second',
      '1. first\n\n   continuation\n\n2. second',
      '> first\n\n> second',
      '    first\n\n    second',
      '<div>\nfirst\n\nsecond\n</div>',
    ]) {
      expect(streamingMarkdownBlocks('intro\n\n$block'), ['intro', block]);
    }
    const refs =
        '[Read][target]\n\nAnother paragraph\n\n[target]: https://example.com';
    expect(streamingMarkdownBlocks(refs), [refs]);
    expect(streamingMarkdownBlocks('Heading\n---\n\nBody'), [
      'Heading\n---',
      'Body',
    ]);
  });

  testWidgets(
    'only the growing paragraph is rebuilt and completion unifies rendering',
    (tester) async {
      final style = MarkdownStyleSheet(p: const TextStyle(fontSize: 14));
      Future<void> pump(String data, {bool streaming = true}) =>
          tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: IncrementalMarkdownBody(
                  data: data,
                  streaming: streaming,
                  styleSheet: style,
                ),
              ),
            ),
          );
      await pump('**Stable** paragraph\n\n逐');
      final first = tester
          .widgetList<MarkdownBody>(find.byType(MarkdownBody))
          .first;
      for (final text in ['逐字', '逐字输出', '逐字输出完成']) {
        await pump('**Stable** paragraph\n\n$text');
        expect(
          identical(
            tester.widgetList<MarkdownBody>(find.byType(MarkdownBody)).first,
            first,
          ),
          isTrue,
        );
        expect(find.text(text), findsOneWidget);
      }
      await pump('**Stable** paragraph\n\n逐字输出完成', streaming: false);
      expect(find.byType(MarkdownBody), findsOneWidget);
      expect(
        tester.widget<MarkdownBody>(find.byType(MarkdownBody)).data,
        '**Stable** paragraph\n\n逐字输出完成',
      );
      // A corrected authoritative result must not retain old cached paragraphs.
      await pump('Corrected', streaming: false);
      expect(find.text('Stable paragraph'), findsNothing);
      expect(find.text('Corrected'), findsOneWidget);
    },
  );

  testWidgets(
    'link callbacks and theme changes remain current in cached blocks',
    (tester) async {
      var tapped = '';
      final style = MarkdownStyleSheet(p: const TextStyle(fontSize: 14));
      Future<void> pump(
        String suffix,
        ValueChanged<String> onTap,
        MarkdownStyleSheet sheet,
      ) => tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: IncrementalMarkdownBody(
              data: '[Link](https://example.com)\n\n$suffix',
              streaming: true,
              styleSheet: sheet,
              onTapLink: (_, href, _) => onTap(href!),
            ),
          ),
        ),
      );
      await pump('A', (_) => tapped = 'old', style);
      await pump('AB', (href) => tapped = href, style);
      await tester.tap(find.text('Link'));
      expect(tapped, 'https://example.com');
      final changed = MarkdownStyleSheet(p: const TextStyle(fontSize: 22));
      await pump('ABC', (_) {}, changed);
      expect(
        tester
            .widgetList<MarkdownBody>(find.byType(MarkdownBody))
            .first
            .styleSheet,
        changed,
      );
    },
  );
}
