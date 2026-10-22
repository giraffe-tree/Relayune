import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';

import '../support/workbench_fixture.dart';

void main() {
  const output = String.fromEnvironment('ATTACHMENT_SCREENSHOTS');
  const input = String.fromEnvironment('ATTACHMENT_PHOTOS');
  const font = String.fromEnvironment('ATTACHMENT_FONT');
  const icons = String.fromEnvironment('ATTACHMENT_ICONS');
  testWidgets(
    'capture attachment deck and gallery with real image dimensions',
    (tester) async {
      final photos = <Uint8List>[];
      await tester.runAsync(() async {
        for (var i = 0; i < 3; i++) {
          photos.add(await File('$input/study-$i.jpg').readAsBytes());
        }
        if (font.isNotEmpty) {
          final bytes = ByteData.sublistView(await File(font).readAsBytes());
          for (final family in [
            'Ahem',
            'Roboto',
            '.SF UI Text',
            '.SF UI Display',
          ]) {
            await (FontLoader(family)..addFont(Future.value(bytes))).load();
          }
        }
        if (icons.isNotEmpty) {
          final bytes = ByteData.sublistView(await File(icons).readAsBytes());
          await (FontLoader(
            'MaterialIcons',
          )..addFont(Future.value(bytes))).load();
        }
      });
      final c = workbenchController();
      addTearDown(c.dispose);
      c.messages['root'] = [
        RelayMessage(
          id: 'visual-album',
          role: 'codex',
          kind: 'message.completed',
          createdAt: '2026-09-25T00:00:00Z',
          content: '整理了这组光影参考，方案与原始资料也放在这里。',
          attachments: [
            for (var i = 0; i < 16; i++)
              RelayAttachment(
                id: 'photo-$i',
                type: 'image',
                name: ['湖畔.jpg', '林间.jpg', '远山.jpg'][i % 3],
                mimeType: 'image/jpeg',
                url: '',
                thumbnailBytes: photos[i % 3],
                localBytes: photos[i % 3],
              ),
            const RelayAttachment(
              id: 'pdf',
              type: 'file',
              name: '2026-09-26_逛西南湖生态_光影参考方案.pdf',
              mimeType: 'application/pdf',
              url: '/pdf',
              previewSupported: true,
            ),
            const RelayAttachment(
              id: 'md',
              type: 'file',
              name: '2026-09-26_基业长青_高瞻远瞩公司_素材说明.md',
              mimeType: 'text/markdown',
              url: '/md',
              previewSupported: true,
            ),
            const RelayAttachment(
              id: 'third',
              type: 'file',
              name: '每日发芽报告.md',
              mimeType: 'text/markdown',
              url: '/third',
              previewSupported: true,
            ),
          ],
        ),
      ];
      final boundary = GlobalKey();
      await pumpWorkbench(
        tester,
        c,
        captureKey: boundary,
        testFontFamily: font.isEmpty ? null : 'Roboto',
      );
      Future<void> ready() async {
        for (var pass = 0; pass < 3; pass++) {
          await tester.pump();
          for (final element in find.byType(Image).evaluate().toList()) {
            await tester.runAsync(
              () => precacheImage((element.widget as Image).image, element),
            );
          }
          for (var i = 0; i < 10; i++) {
            await tester.pump(const Duration(milliseconds: 50));
          }
        }
      }

      Future<void> capture(String name) async {
        await ready();
        await tester.runAsync(() async {
          final render =
              boundary.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary;
          final image = await render.toImage(pixelRatio: 2);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          await Directory(output).create(recursive: true);
          await File(
            '$output/$name.png',
          ).writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }

      await capture('deck');
      await tester.drag(
        find.byKey(const ValueKey('attachment-photo-deck-pager')),
        const Offset(-270, 0),
      );
      await capture('second-photo');
      await tester.tap(
        find.byKey(const ValueKey('attachment-photo-deck-pager')),
      );
      await capture('gallery');
      await tester.tap(
        find.byKey(const ValueKey('attachment-gallery-overview-toggle')),
      );
      await capture('overview');
      await tester.tap(find.byTooltip('关闭'));
      await ready();
      await tester.tap(
        find.byKey(const ValueKey('conversation-composer-input')),
      );
      await capture('focused-input');
      await tester.enterText(
        find.byKey(const ValueKey('conversation-composer-input')),
        '请把湖边这组照片整理成一份报告。\n保留原始的图片和文字。',
      );
      await capture('multiline-input');
      await pumpWorkbench(
        tester,
        c,
        captureKey: boundary,
        testFontFamily: font.isEmpty ? null : 'Roboto',
        size: const Size(320, 844),
        textScale: 1.6,
      );
      await capture('narrow-large-text');
      expect(tester.takeException(), isNull);
    },
    skip: output.isEmpty || input.isEmpty,
  );
}
