import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/ui/secure_html_preview.dart';
import 'package:relayune_mobile/src/ui/visualization_document.dart';

import '../support/workbench_fixture.dart';

void main() {
  test(
    '[MOB-ATT-011][flutter] HTML remains inside an opaque frame even when it contains document breakout markup',
    () {
      const fragment =
          '</iframe><script>window.attack=1</script><img src="https://example.com">';
      final document = buildVisualizationPreviewDocument(fragment);
      expect(document, contains('sandbox="allow-scripts"'));
      expect(document, isNot(contains('allow-same-origin')));
      expect(document, isNot(contains(fragment)));
      expect(document, contains('&lt;&#47;iframe&gt;'));
      expect(document, contains("connect-src 'none'"));
      expect(document, contains("form-action 'none'"));
      expect(document, contains("base-uri 'none'"));
      expect(document, contains("worker-src 'none'"));
      expect(document, isNot(contains('addJavaScriptChannel')));
    },
  );

  test(
    'preview permits only its own document and local fragment navigation',
    () {
      for (final value in [
        'about:blank',
        'about:srcdoc',
        'about:srcdoc#section',
      ]) {
        expect(isLocalVisualizationNavigation(value), isTrue);
      }
      for (final value in [
        'https://example.com',
        'http://127.0.0.1',
        'file:///private/file',
        'data:text/html,hello',
        'javascript:alert(1)',
        'relayune://connect',
        'about:blank?payload=content',
        'about://example.com/srcdoc',
      ]) {
        expect(isLocalVisualizationNavigation(value), isFalse, reason: value);
      }
    },
  );

  testWidgets(
    'HTML attachment opens a visualization preview instead of displaying its source',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = [
        RelayMessage(
          id: 'html-answer',
          role: 'codex',
          content: '设计图',
          createdAt: '2026-09-07T14:00:00Z',
          kind: 'message.completed',
          attachments: [
            RelayAttachment(
              id: 'html',
              type: 'file',
              name: 'design.html',
              mimeType: 'text/html',
              url: '',
              previewSupported: true,
              localBytes: utf8.encode('<div id="private-source">Hello</div>'),
            ),
          ],
        ),
      ];
      await pumpWorkbench(tester, controller, disableAnimations: true);
      await tester.pumpAndSettle();
      expect(find.textContaining('可视化'), findsOneWidget);
      await tester.tap(find.text('design.html'));
      await tester.pumpAndSettle();
      expect(find.byType(SecureHtmlPreview), findsOneWidget);
      expect(find.textContaining('private-source'), findsNothing);
      expect(
        find.byKey(const ValueKey('message-file-preview-html')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
