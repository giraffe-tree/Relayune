import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/widgets/incremental_markdown_body.dart';

void main() {
  testWidgets('long reply reuses parsed paragraphs across 48 character frames', (
    tester,
  ) async {
    final style = MarkdownStyleSheet(p: const TextStyle(fontSize: 14));
    final prefix = List.generate(
      24,
      (i) => '**段落 $i**：${'已经显示的内容不应随着新字反复解析。' * 4}',
    ).join('\n\n');
    final results = <String, ({int characters, int micros})>{};
    for (final incremental in [false, true]) {
      Future<void> pump(String tail) => tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: incremental
                  ? IncrementalMarkdownBody(
                      data: '$prefix\n\n$tail',
                      streaming: true,
                      styleSheet: style,
                    )
                  : MarkdownBody(
                      data: '$prefix\n\n$tail',
                      selectable: true,
                      styleSheet: style,
                    ),
            ),
          ),
        ),
      );
      await tester.pumpWidget(const SizedBox());
      await pump('逐');
      var previous = tester
          .widgetList<MarkdownBody>(find.byType(MarkdownBody))
          .toSet();
      var parsedCharacters = 0;
      final watch = Stopwatch()..start();
      for (var frame = 1; frame <= 48; frame++) {
        await pump('逐${'字' * frame}');
        final current = tester
            .widgetList<MarkdownBody>(find.byType(MarkdownBody))
            .toSet();
        parsedCharacters += current
            .difference(previous)
            .fold<int>(0, (total, body) => total + body.data.length);
        previous = current;
      }
      watch.stop();
      results[incremental ? 'incremental' : 'full'] = (
        characters: parsedCharacters,
        micros: watch.elapsedMicroseconds,
      );
    }
    // Assert work reduction, not wall-clock timing: shared CI load is variable.
    expect(
      results['incremental']!.characters,
      lessThan(results['full']!.characters ~/ 10),
    );
    // Diagnostic pump timings are not device frame rates.
    // ignore: avoid_print
    print(
      '48 reveal frames, Markdown input characters / widget-test microseconds: $results',
    );
  });
}
