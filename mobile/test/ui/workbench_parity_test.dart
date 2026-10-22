import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as image;
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/ui/image_thumbnail.dart';
import 'package:relayune_mobile/src/ui/theme.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets('user messages render Markdown links and entities', (
    tester,
  ) async {
    final controller = workbenchController();
    addTearDown(controller.dispose);
    controller.messages['root'] = [
      RelayMessage(
        id: 'user-markdown',
        role: 'user',
        kind: 'user.message',
        content:
            'GitHub Issue #4 &#x20;\n[查看 Issue](https://github.com/org/repo/issues/4)\n\n**认领这个**',
        createdAt: '2026-09-15T00:00:00Z',
      ),
    ];
    await pumpWorkbench(tester, controller);
    final body = tester.widget<MarkdownBody>(find.byType(MarkdownBody));
    expect(
      find.ancestor(of: find.byType(MarkdownBody), matching: find.byType(SelectionArea)),
      findsOneWidget,
    );
    expect(body.onTapLink, isNotNull);
    expect(find.textContaining('&#x20;', findRichText: true), findsNothing);
    expect(find.textContaining('查看 Issue', findRichText: true), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  for (final recovery in ['tap', 'source', 'online']) {
    testWidgets('failed thumbnail recovers after $recovery', (tester) async {
      final delayed = _DelayedAttachmentController();
      final controller = workbenchController(
        baseController: delayed,
        online: recovery != 'online',
      );
      addTearDown(controller.dispose);
      void setImage(String url) {
        controller.messages['root'] = [
          RelayMessage(
            id: 'recover-message',
            role: 'user',
            content: '',
            createdAt: '2026-09-09T00:00:00Z',
            kind: 'user.message',
            attachments: [
              RelayAttachment(
                id: 'recover',
                type: 'image',
                name: 'recover.png',
                mimeType: 'image/png',
                url: url,
              ),
            ],
          ),
        ];
      }

      setImage('/first');
      await pumpWorkbench(tester, controller);
      delayed.failNext(
        const RelayApiException('offline', 0, 'network_unavailable'),
      );
      await tester.pump();
      expect(find.textContaining('图片读取失败'), findsOneWidget);
      if (recovery == 'tap') {
        await tester.tap(
          find.byKey(const ValueKey('message-image-thumbnail-recover')),
        );
        await tester.pump();
      } else {
        if (recovery == 'source') setImage('/updated');
        if (recovery == 'online') {
          workbenchController(baseController: controller);
          setImage('/first');
        }
        await pumpWorkbench(tester, controller);
      }
      expect(delayed.loadCalls, 2);
      expect(find.textContaining('图片读取失败'), findsNothing);
      final bytes = image.encodePng(image.Image(width: 16, height: 16));
      delayed.completeNext(bytes);
      await tester.pump();
      expect(find.textContaining('图片读取失败'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }

  for (final dimensions in [(600, 1200), (1200, 600)]) {
    testWidgets(
      '[MOB-ATT-009][flutter] image previews preserve the complete decoded aspect ratio $dimensions',
      (tester) async {
        final controller = workbenchController();
        addTearDown(controller.dispose);
        final bytes = image.encodePng(
          image.Image(width: dimensions.$1, height: dimensions.$2),
        );
        controller.messages['root'] = [
          RelayMessage(
            id: 'crop-message',
            role: 'user',
            content: '',
            createdAt: '2026-09-05T00:00:00Z',
            kind: 'user.message',
            attachments: [
              RelayAttachment(
                id: 'crop-image',
                type: 'image',
                name: 'crop.png',
                mimeType: 'image/png',
                url: '',
                thumbnailBytes: bytes,
              ),
            ],
          ),
        ];
        await pumpWorkbench(tester, controller);
        await tester.pump();
        final thumbnail = find.byKey(
          const ValueKey('message-image-thumbnail-crop-image'),
        );
        final rendered = tester.widget<Image>(
          find.descendant(of: thumbnail, matching: find.byType(Image)),
        );
        final decoded = await tester.runAsync(() async {
          final ready = Completer<ImageInfo>();
          final stream = rendered.image.resolve(ImageConfiguration.empty);
          final listener = ImageStreamListener(
            (info, _) => ready.complete(info),
            onError: ready.completeError,
          );
          stream.addListener(listener);
          final info = await ready.future;
          stream.removeListener(listener);
          return info;
        });
        expect(
          decoded!.image.width / decoded.image.height,
          dimensions.$1 / dimensions.$2,
        );
        expect(rendered.fit, BoxFit.contain);
        expect(rendered.alignment, Alignment.center);
        expect(tester.getSize(thumbnail), const Size(196, 196));
        decoded.dispose();
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets(
    'active reply keeps authoritative text immediate while presenting it smoothly',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      final createdAt = DateTime.now().toUtc().toIso8601String();
      controller.applyEventForTesting(
        _eventAt('smooth-turn', createdAt, {
          'kind': 'turn.started',
          'turn_id': 'smooth-turn',
        }),
      );
      controller.applyEventForTesting(
        _eventAt('smooth-delta', createdAt, {
          'kind': 'message.delta',
          'turn_id': 'smooth-turn',
          'item_id': 'smooth-answer',
          'text': '逐字平滑输出完成',
          'message_phase': 'commentary',
        }),
      );

      await pumpWorkbench(tester, controller);

      final message = controller.messages['root']!.single;
      final presentation = controller.liveReplyText('root', message.id)!;
      expect(message.content, '逐字平滑输出完成');
      expect(presentation.value, '逐');
      expect(find.text('逐字平滑输出完成'), findsNothing);
      expect(find.byKey(const ValueKey('live-reply-markdown')), findsOneWidget);
      expect(find.byType(MarkdownBody), findsOneWidget);

      await tester.pump(const Duration(milliseconds: 360));

      expect(presentation.value, '逐字平滑输出完成');
      expect(find.text('逐字平滑输出完成'), findsOneWidget);
      expect(find.byKey(const ValueKey('live-reply-markdown')), findsOneWidget);
      expect(find.byType(MarkdownBody), findsOneWidget);
    },
  );

  testWidgets('reduced motion shows the authoritative reply immediately', (
    tester,
  ) async {
    final controller = workbenchController();
    addTearDown(controller.dispose);
    final createdAt = DateTime.now().toUtc().toIso8601String();
    controller.applyEventForTesting(
      _eventAt('reduced-turn', createdAt, {
        'kind': 'turn.started',
        'turn_id': 'reduced-turn',
      }),
    );
    controller.applyEventForTesting(
      _eventAt('reduced-delta', createdAt, {
        'kind': 'message.delta',
        'turn_id': 'reduced-turn',
        'item_id': 'reduced-answer',
        'text': '减少动态效果时立即显示',
        'message_phase': 'commentary',
      }),
    );

    await pumpWorkbench(tester, controller, disableAnimations: true);

    expect(find.text('减少动态效果时立即显示'), findsOneWidget);
  });

  testWidgets('smooth reply survives the processing-to-final layout change', (
    tester,
  ) async {
    final controller = workbenchController();
    addTearDown(controller.dispose);
    final createdAt = DateTime.now().toUtc().toIso8601String();
    controller.applyEventForTesting(
      _eventAt('transition-turn', createdAt, {
        'kind': 'turn.started',
        'turn_id': 'transition-turn',
      }),
    );
    controller.applyEventForTesting(
      _eventAt('transition-delta', createdAt, {
        'kind': 'message.delta',
        'turn_id': 'transition-turn',
        'item_id': 'transition-answer',
        'text': '平滑切换到最终答案',
        'message_phase': 'final_answer',
      }),
    );
    await pumpWorkbench(tester, controller);
    final messageId = controller.messages['root']!.single.id;
    final presentation = controller.liveReplyText('root', messageId)!;
    expect(presentation.value, '平');

    controller.applyEventForTesting(
      _eventAt('transition-completed', createdAt, {
        'kind': 'message.completed',
        'turn_id': 'transition-turn',
        'item_id': 'transition-answer',
        'text': '平滑切换到最终答案。',
        'message_phase': 'final_answer',
      }),
    );
    controller.applyEventForTesting(
      _eventAt('transition-turn-completed', createdAt, {
        'kind': 'turn.completed',
        'turn_id': 'transition-turn',
      }),
    );
    controller.replaceSessionsForTesting([
      RelaySession.fromJson({
        ...controller.sessions.single.raw,
        'status': 'idle',
      }),
    ]);
    await tester.pump();

    expect(
      find.byKey(ValueKey('assistant-message-$messageId')),
      findsOneWidget,
    );
    expect(presentation.value, isNot('平滑切换到最终答案。'));

    await tester.pump(const Duration(milliseconds: 360));

    expect(presentation.value, '平滑切换到最终答案。');
    expect(find.text('平滑切换到最终答案。'), findsOneWidget);
    expect(find.byType(MarkdownBody), findsOneWidget);
  });

  testWidgets(
    'active Codex answer stays inside processing until the turn completes',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.applyEventForTesting(
        _event('turn-active', {
          'kind': 'turn.started',
          'turn_id': 'turn-active',
        }),
      );
      controller.applyEventForTesting(
        _event('answer-delta-1', {
          'kind': 'message.delta',
          'turn_id': 'turn-active',
          'item_id': 'answer-active',
          'text': '真实',
          'message_phase': 'commentary',
        }),
      );

      await pumpWorkbench(tester, controller);

      expect(find.text('真实'), findsOneWidget);
      expect(find.text('处理中'), findsOneWidget);
      final activeMessageId = controller.messages['root']!.single.id;
      expect(
        find.byKey(ValueKey('assistant-message-$activeMessageId')),
        findsNothing,
      );
      expect(
        find.byKey(ValueKey('turn-activity-message-$activeMessageId')),
        findsOneWidget,
      );
      expect(
        find.ancestor(
          of: find.byKey(ValueKey('turn-activity-message-$activeMessageId')),
          matching: find.byKey(
            const ValueKey('turn-activity-timeline-turn:turn-active'),
          ),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('assistant-live-activity')),
        findsNothing,
      );

      controller.applyEventForTesting(
        _event('answer-delta-2', {
          'kind': 'message.delta',
          'turn_id': 'turn-active',
          'item_id': 'answer-active',
          'text': '流式输出',
          'message_phase': 'commentary',
        }),
      );
      controller.replaceSessionsForTesting(controller.sessions);
      await tester.pump();
      expect(find.text('真实流式输出'), findsOneWidget);

      controller.applyEventForTesting(
        _event('answer-complete', {
          'kind': 'message.completed',
          'turn_id': 'turn-active',
          'item_id': 'answer-active',
          'text': '真实流式输出完成',
          'message_phase': 'final_answer',
        }),
      );
      controller.replaceSessionsForTesting(controller.sessions);
      await tester.pump();

      expect(find.text('真实流式输出完成'), findsOneWidget);
      expect(
        find.byKey(ValueKey('turn-activity-message-$activeMessageId')),
        findsOneWidget,
      );

      controller.applyEventForTesting(
        _event('turn-complete', {
          'kind': 'turn.completed',
          'turn_id': 'turn-active',
        }),
      );
      controller.replaceSessionsForTesting([
        RelaySession.fromJson({
          ...controller.sessions.single.raw,
          'status': 'idle',
        }),
      ]);
      await tester.pump();

      expect(find.text('处理中'), findsNothing);
      expect(
        find.byKey(ValueKey('turn-activity-message-$activeMessageId')),
        findsNothing,
      );
      expect(
        find.byKey(ValueKey('assistant-message-$activeMessageId')),
        findsOneWidget,
      );
      expect(controller.messages['root']!.where((m) => m.role == 'codex').single.content, '真实流式输出完成');
      expect(controller.messages['root']!.where((m) => m.kind == 'turn.completed').single.turnStatus, 'completed');
    },
  );

  testWidgets(
    'restored Codex commentary stays inside processing without runtime state',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = const [
        RelayMessage(
          id: 'restored-commentary',
          role: 'codex',
          content: '这是恢复后的阶段性回复。',
          createdAt: '2026-08-30T10:00:00Z',
          kind: 'message.completed',
          turnId: 'restored-turn',
          messagePhase: 'commentary',
        ),
      ];

      await pumpWorkbench(tester, controller);

      expect(find.text('处理记录'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('assistant-message-restored-commentary')),
        findsNothing,
      );
      await tester.tap(find.text('处理记录'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      final commentary = find.byKey(
        const ValueKey('turn-activity-message-restored-commentary'),
      );
      expect(commentary, findsOneWidget);
      expect(
        find.ancestor(
          of: commentary,
          matching: find.byKey(
            const ValueKey('turn-activity-timeline-turn:restored-turn'),
          ),
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    '[MOB-ATT-009][flutter] message images, previewable files, and unsupported files stay distinct',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = [
        RelayMessage(
          id: 'user-attachments',
          role: 'user',
          content: '请汇总附件。',
          createdAt: '2026-08-28T10:00:00Z',
          kind: 'user.message',
          turnId: 'turn-attachments',
          attachments: [
            RelayAttachment(
              id: 'preview-image',
              type: 'image',
              name: 'preview.png',
              mimeType: 'image/png',
              url: '/api/sessions/root/attachments/preview-image',
              localBytes: base64Decode(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC'
                'AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              ),
            ),
            const RelayAttachment(
              id: 'report-file',
              type: 'file',
              name: '月度账单.xlsx',
              mimeType:
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              url: '',
            ),
            RelayAttachment(
              id: 'notes-file',
              type: 'file',
              name: '说明.md',
              mimeType: 'text/markdown',
              url: '/api/sessions/root/attachments/notes-file',
              previewSupported: true,
              localBytes: Uint8List.fromList(
                utf8.encode('# 预览标题\n\n> 调研日期：2026-09-01\n> 这是加密读取的 Markdown。'),
              ),
            ),
          ],
        ),
      ];

      await pumpWorkbench(tester, controller);
      await tester.pump();

      final thumbnail = find.byKey(
        const ValueKey('message-image-thumbnail-preview-image'),
      );
      expect(thumbnail, findsOneWidget);
      expect(tester.getSize(thumbnail), const Size(196, 196));

      final file = find.byKey(const ValueKey('message-file-report-file'));
      expect(file, findsOneWidget);
      expect(find.text('月度账单.xlsx'), findsOneWidget);
      expect(
        find.descendant(of: file, matching: find.byType(InkWell)),
        findsNothing,
      );
      await tester.tap(file);
      await tester.pump();
      expect(find.byType(Dialog), findsNothing);

      final notes = find.byKey(const ValueKey('message-file-notes-file'));
      expect(notes, findsOneWidget);
      expect(
        find.descendant(of: notes, matching: find.byType(InkWell)),
        findsOneWidget,
      );
      await tester.tap(notes);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(
        find.byKey(const ValueKey('message-file-preview-notes-file')),
        findsOneWidget,
      );
      expect(find.text('预览标题'), findsOneWidget);
      final previewMarkdown = tester.widget<MarkdownBody>(
        find.descendant(
          of: find.byKey(const ValueKey('message-file-preview-notes-file')),
          matching: find.byType(MarkdownBody),
        ),
      );
      final blockquoteDecoration =
          previewMarkdown.styleSheet!.blockquoteDecoration! as BoxDecoration;
      expect(blockquoteDecoration.color, RelayTheme.panelSoft);
      expect(
        (blockquoteDecoration.border! as Border).left.color,
        RelayTheme.green,
      );
      expect(
        previewMarkdown.styleSheet!.blockquote!.color,
        RelayTheme.mutedBright,
      );
    },
  );

  testWidgets(
    '[MOB-ATT-009][flutter] image cards fetch previews before originals and show original progress',
    (tester) async {
      final delayed = _DelayedAttachmentController();
      final controller = workbenchController(baseController: delayed);
      addTearDown(controller.dispose);
      controller.messages['root'] = const [
        RelayMessage(
          id: 'remote-image-message',
          role: 'user',
          content: '请检查图片。',
          createdAt: '2026-08-30T10:00:00Z',
          kind: 'user.message',
          turnId: 'remote-image-turn',
          attachments: [
            RelayAttachment(
              id: 'remote-image',
              type: 'image',
              name: 'remote.png',
              mimeType: 'image/png',
              url: '/api/sessions/root/attachments/remote-image',
            ),
          ],
        ),
      ];
      final imageBytes = base64Decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC'
        'AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      );

      await pumpWorkbench(tester, controller);
      expect(delayed.loadCalls, 1);
      expect(delayed.variants, [RelayAttachmentVariant.preview]);
      final tile = find.byKey(
        const ValueKey('message-image-thumbnail-remote-image'),
      );
      final card = find
          .ancestor(of: tile, matching: find.byType(InkWell))
          .first;
      final occupiedSize = tester.getSize(card);
      delayed.onDownloadProgress?.call(
        const DownloadProgress(0, null, waiting: true),
      );
      await tester.pump();
      expect(find.text('等待加载'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(tester.getSize(tile), const Size(196, 196));

      delayed.onDownloadProgress?.call(const DownloadProgress(200, 1000));
      await tester.pump();
      expect(find.text('20%'), findsOneWidget);
      expect(
        tester
            .widget<LinearProgressIndicator>(
              find.byType(LinearProgressIndicator),
            )
            .value,
        .2,
      );
      delayed.completeNext(imageBytes);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      final thumbnailImage = tester.widget<Image>(
        find.descendant(of: tile, matching: find.byType(Image)),
      );
      await tester.runAsync(
        () => precacheImage(thumbnailImage.image, tester.element(tile)),
      );
      await tester.pump();
      expect(tester.getSize(card), occupiedSize);
      expect(find.byKey(const ValueKey('image-loading-sweep')), findsNothing);

      await tester.tap(
        find.byKey(const ValueKey('message-image-thumbnail-remote-image')),
      );
      await tester.pump();
      expect(
        find.byKey(const ValueKey('attachment-image-gallery')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('message-image-dialog-preview-remote-image')),
        findsOneWidget,
      );
      expect(delayed.loadCalls, 1);

      await tester.tap(
        find.byKey(const ValueKey('message-image-load-original-remote-image')),
      );
      await tester.pump();
      expect(delayed.loadCalls, 2);
      expect(delayed.variants.last, RelayAttachmentVariant.original);
      expect(
        find.byKey(
          const ValueKey('message-image-original-progress-remote-image'),
        ),
        findsOneWidget,
      );

      delayed.onDownloadProgress?.call(const DownloadProgress(200, 1000));
      await tester.pump();
      expect(find.text('20%'), findsOneWidget);
      expect(
        tester
            .widget<LinearProgressIndicator>(
              find.byType(LinearProgressIndicator),
            )
            .value,
        .2,
      );
      delayed.failNext(
        const RelayApiException('Failed', 0, 'network_unavailable'),
      );
      await tester.pump();
      expect(
        find.byKey(
          const ValueKey('message-image-original-progress-remote-image'),
        ),
        findsNothing,
      );
      await tester.tap(
        find.byKey(const ValueKey('message-image-load-original-remote-image')),
      );
      await tester.pump();
      expect(
        tester
            .widget<LinearProgressIndicator>(
              find.byType(LinearProgressIndicator),
            )
            .value,
        0,
      );
      delayed.onDownloadProgress?.call(const DownloadProgress(700, 1000));
      await tester.pump();
      expect(find.text('70%'), findsOneWidget);
      delayed.completeNext(imageBytes);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      expect(
        find.byKey(const ValueKey('message-image-original-remote-image')),
        findsOneWidget,
      );
      expect(
        find.byKey(
          const ValueKey('message-image-original-progress-remote-image'),
        ),
        findsNothing,
      );
      await tester.tap(find.byTooltip('关闭'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(
        find.byKey(const ValueKey('message-image-thumbnail-remote-image')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(
        find.byKey(const ValueKey('message-image-load-original-remote-image')),
      );
      await tester.pump();
      await tester.tap(find.byTooltip('关闭'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      delayed.onDownloadProgress?.call(const DownloadProgress(700, 1000));
      delayed.completeNext(imageBytes);
      await tester.pump();
      expect(tester.takeException(), isNull);
    },
  );

  test(
    '[MOB-ATT-009][flutter] live completed replies retain referenced file attachments',
    () {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.applyEventForTesting(
        _event('referenced-file-completed', {
          'kind': 'message.completed',
          'turn_id': 'referenced-file-turn',
          'item_id': 'referenced-file-answer',
          'text': '已整理：[打开报告](</tmp/private/说明.md>)',
          'message_phase': 'final_answer',
          'attachments': [
            {
              'id': 'referenced-notes',
              'type': 'file',
              'name': '说明.md',
              'mime_type': 'text/markdown',
              'url': '/api/sessions/root/attachments/referenced-notes',
              'preview_supported': true,
            },
          ],
        }),
      );

      final message = controller.messages['root']!.single;
      expect(message.attachments, hasLength(1));
      expect(message.attachments.single.name, '说明.md');
      expect(message.attachments.single.previewSupported, isTrue);
    },
  );

  test(
    '[MOB-ATT-009][flutter] authoritative user events retain the local thumbnail only',
    () {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      final thumbnail = Uint8List.fromList([1, 2, 3]);
      controller.messages['root'] = [
        RelayMessage(
          id: 'local_client-image',
          role: 'user',
          content: '检查图片',
          createdAt: '2026-08-30T10:00:00Z',
          kind: 'local.user.message',
          clientMessageId: 'client-image',
          attachments: [
            RelayAttachment(
              id: 'mobile-image',
              type: 'image',
              name: 'mobile.png',
              mimeType: 'image/png',
              url: '',
              localBytes: Uint8List.fromList([4, 5, 6]),
              thumbnailBytes: thumbnail,
            ),
          ],
        ),
      ];

      controller.applyEventForTesting(
        _event('authoritative-user-image', {
          'kind': 'user.message',
          'client_message_id': 'client-image',
          'item_id': 'authoritative-image-message',
          'text': '检查图片',
          'attachments': [
            {
              'id': 'mobile-image',
              'type': 'image',
              'name': 'mobile.png',
              'mime_type': 'image/png',
              'url': '/api/sessions/root/attachments/mobile-image',
            },
          ],
        }),
      );

      final attachment = controller.messages['root']!.single.attachments.single;
      expect(attachment.thumbnailBytes, same(thumbnail));
      expect(attachment.localBytes, isNull);
      expect(attachment.url, contains('mobile-image'));
    },
  );

  testWidgets(
    '[MOB-ATT-009][flutter] inline Markdown file links open their encrypted preview',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = [
        RelayMessage(
          id: 'inline-file-answer',
          role: 'codex',
          content: '[打开报告](/tmp/private/说明.md:12)',
          createdAt: '2026-08-30T10:00:00Z',
          kind: 'message.completed',
          turnId: 'inline-file-turn',
          messagePhase: 'final_answer',
          attachments: [
            RelayAttachment(
              id: 'inline-notes',
              type: 'file',
              name: '说明.md',
              mimeType: 'text/markdown',
              url: '/api/sessions/root/attachments/inline-notes',
              previewSupported: true,
              localBytes: Uint8List.fromList(
                utf8.encode('# 链接预览成功\n\n正文通过端到端加密读取。'),
              ),
            ),
          ],
        ),
      ];

      await pumpWorkbench(tester, controller);
      final inlineLink = find.byType(MarkdownBody);
      expect(inlineLink, findsOneWidget);
      await tester.ensureVisible(inlineLink);
      await tester.pump();
      await tester.tapAt(tester.getTopLeft(inlineLink) + const Offset(16, 12));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));

      expect(
        find.byKey(const ValueKey('message-file-preview-inline-notes')),
        findsOneWidget,
      );
      expect(find.text('链接预览成功'), findsOneWidget);
    },
  );

  for (final scenario in [
    (
      type: 'image',
      mime: 'image/png',
      extension: 'png',
      link: true,
      valid: true,
    ),
    (
      type: 'file',
      mime: 'IMAGE/JPEG',
      extension: 'jpg',
      link: false,
      valid: true,
    ),
    (
      type: 'file',
      mime: 'image/png',
      extension: 'png',
      link: true,
      valid: false,
    ),
  ]) {
    testWidgets(
      '[MOB-ATT-009][flutter] image file previews render images instead of binary text $scenario',
      (tester) async {
        final controller = workbenchController();
        addTearDown(controller.dispose);
        final source = image.Image(width: 32, height: 16);
        final bytes = scenario.valid
            ? scenario.extension == 'jpg'
                  ? image.encodeJpg(source)
                  : image.encodePng(source)
            : Uint8List.fromList(utf8.encode('corrupt image payload'));
        final name = 'preview.${scenario.extension}';
        controller.messages['root'] = [
          RelayMessage(
            id: 'inline-image-answer',
            role: 'codex',
            content: '[打开图片](/tmp/private/$name)',
            createdAt: '2026-08-30T10:00:00Z',
            kind: 'message.completed',
            turnId: 'inline-image-turn',
            messagePhase: 'final_answer',
            attachments: [
              RelayAttachment(
                id: 'inline-image',
                type: scenario.type,
                name: name,
                mimeType: scenario.mime,
                url: '/api/sessions/root/attachments/inline-image',
                previewSupported: true,
                localBytes: bytes,
                thumbnailBytes: scenario.type == 'image' ? bytes : null,
              ),
            ],
          ),
        ];

        await pumpWorkbench(tester, controller);
        if (scenario.link) {
          final link = find.byType(MarkdownBody);
          await tester.ensureVisible(link);
          await tester.pump();
          await tester.tapAt(tester.getTopLeft(link) + const Offset(16, 12));
        } else {
          await tester.tap(
            find.byKey(const ValueKey('message-file-inline-image')),
          );
        }
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 350));

        final preview = find.byKey(
          const ValueKey('file-preview-image-inline-image'),
        );
        expect(preview, findsOneWidget);
        expect(tester.widget(preview), isA<InteractiveViewer>());
        final rendered = find.descendant(
          of: preview,
          matching: find.byType(Image),
        );
        expect(tester.widget<Image>(rendered).fit, BoxFit.contain);
        await tester.runAsync(
          () => precacheImage(
            tester.widget<Image>(rendered).image,
            tester.element(rendered),
            onError: (error, stackTrace) {
              expect(scenario.valid, isFalse);
            },
          ),
        );
        await tester.pump();
        expect(
          find.byKey(const ValueKey('file-preview-text-inline-image')),
          findsNothing,
        );
        if (scenario.valid) {
          final decoded = tester
              .widget<RawImage>(
                find.descendant(of: preview, matching: find.byType(RawImage)),
              )
              .image!;
          expect(decoded.width, 32);
          expect(decoded.height, 16);
        } else {
          expect(find.text('corrupt image payload'), findsNothing);
          expect(find.text('$name\n图片读取失败'), findsOneWidget);
        }
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    '[MOB-TXT-001][flutter] iOS simulator strips unsupported decorative emoji without changing the message',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = const [
        RelayMessage(
          id: 'emoji-cjk-answer',
          role: 'codex',
          content: '- 🔍 看看这些改动做了什么、有没有问题\n- 🧪 跑一下测试\n- ✍️ 帮你提交代码',
          createdAt: '2026-09-04T15:25:07Z',
          kind: 'message.completed',
          turnId: 'emoji-cjk-turn',
          messagePhase: 'final_answer',
        ),
      ];

      await pumpWorkbench(tester, controller);
      var markdown = tester.widget<MarkdownBody>(find.byType(MarkdownBody));
      expect(markdown.data, contains('🔍 看看这些改动'));

      await pumpWorkbench(
        tester,
        controller,
        usesIosSimulatorEmojiFallback: true,
      );
      await tester.pump(const Duration(milliseconds: 250));

      markdown = tester.widget<MarkdownBody>(find.byType(MarkdownBody));
      expect(markdown.data, '- 看看这些改动做了什么、有没有问题\n- 跑一下测试\n- 帮你提交代码');
      expect(
        controller.messages['root']!.single.content,
        contains('🔍 看看这些改动'),
      );
      expect(markdown.styleSheet?.p?.fontFamily, isNull);
      expect(markdown.styleSheet?.p?.fontFamilyFallback, isNull);
      final bodyStyle = Theme.of(
        tester.element(find.byType(Scaffold).first),
      ).textTheme.bodyMedium;
      expect(bodyStyle?.fontFamily, isNot('SF Pro Text'));
      expect(bodyStyle?.fontFamilyFallback, isNull);
    },
  );

  testWidgets(
    '[MOB-ATT-009][flutter] remote JSON previews open immediately with loading animation',
    (tester) async {
      final delayed = _DelayedAttachmentController();
      final controller = workbenchController(baseController: delayed);
      addTearDown(controller.dispose);
      controller.messages['root'] = [
        const RelayMessage(
          id: 'json-answer',
          role: 'codex',
          content: 'JSON 结果如下。',
          createdAt: '2026-08-30T10:00:00Z',
          kind: 'message.completed',
          turnId: 'json-turn',
          messagePhase: 'final_answer',
          attachments: [
            RelayAttachment(
              id: 'json-file',
              type: 'file',
              name: 'result.json',
              mimeType: 'application/json',
              url: '/api/sessions/root/attachments/json-file',
              previewSupported: true,
            ),
          ],
        ),
      ];

      await pumpWorkbench(
        tester,
        controller,
        size: const Size(320, 700),
        textScale: 1.3,
      );
      expect(find.text('JSON'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('message-file-json-file')));
      await tester.pump();

      expect(delayed.loadCalls, 1);
      expect(
        find.byKey(const ValueKey('message-file-preview-json-file')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('file-preview-loading-json-file')),
        findsOneWidget,
      );
      expect(find.text('正在从电脑安全读取…'), findsWidgets);

      delayed.completeNext(utf8.encode('{"status":"ok","count":2}'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));

      expect(
        find.byKey(const ValueKey('file-preview-loading-json-file')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('file-preview-content-json-file')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('file-preview-text-json-file')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('file-preview-horizontal-scroll')),
        findsOneWidget,
      );
      expect(find.textContaining('"status": "ok"'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-ATT-009][flutter] file preview errors stay in place and retry succeeds',
    (tester) async {
      final delayed = _DelayedAttachmentController();
      final controller = workbenchController(baseController: delayed);
      addTearDown(controller.dispose);
      controller.messages['root'] = [
        const RelayMessage(
          id: 'yaml-answer',
          role: 'codex',
          content: '配置如下。',
          createdAt: '2026-08-30T10:00:00Z',
          kind: 'message.completed',
          turnId: 'yaml-turn',
          messagePhase: 'final_answer',
          attachments: [
            RelayAttachment(
              id: 'yaml-file',
              type: 'file',
              name: 'config.yaml',
              mimeType: 'application/yaml',
              url: '/api/sessions/root/attachments/yaml-file',
              previewSupported: true,
            ),
          ],
        ),
      ];

      await pumpWorkbench(tester, controller);
      await tester.tap(find.byKey(const ValueKey('message-file-yaml-file')));
      await tester.pump();
      delayed.failNext(
        const RelayApiException('文件已失效或已从电脑移除。', 0, 'attachment_gone'),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));

      expect(
        find.byKey(const ValueKey('file-preview-error-yaml-file')),
        findsOneWidget,
      );
      expect(find.text('文件已失效或已从电脑移除。'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('file-preview-retry')));
      await tester.pump();
      expect(delayed.loadCalls, 2);
      expect(
        find.byKey(const ValueKey('file-preview-loading-yaml-file')),
        findsOneWidget,
      );

      delayed.completeNext(utf8.encode('enabled: true\n'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      expect(
        find.byKey(const ValueKey('file-preview-text-yaml-file')),
        findsOneWidget,
      );
      expect(find.textContaining('enabled: true'), findsOneWidget);
    },
  );

  testWidgets(
    '[MOB-ATT-009][flutter] safe SVG files use a zoomable vector preview',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = [
        RelayMessage(
          id: 'svg-answer',
          role: 'codex',
          content: '图示如下。',
          createdAt: '2026-08-30T10:00:00Z',
          kind: 'message.completed',
          turnId: 'svg-turn',
          messagePhase: 'final_answer',
          attachments: [
            RelayAttachment(
              id: 'svg-file',
              type: 'file',
              name: 'diagram.svg',
              mimeType: 'image/svg+xml',
              url: '/api/sessions/root/attachments/svg-file',
              previewSupported: true,
              localBytes: Uint8List.fromList(
                utf8.encode(
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
                  '<path d="M0 0h10v10z"/></svg>',
                ),
              ),
            ),
          ],
        ),
      ];

      await pumpWorkbench(tester, controller);
      expect(find.text('SVG'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('message-file-svg-file')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pump();

      final preview = find.byKey(const ValueKey('file-preview-svg-svg-file'));
      expect(preview, findsOneWidget);
      expect(
        find.descendant(of: preview, matching: find.byType(InteractiveViewer)),
        findsOneWidget,
      );
      expect(
        find.descendant(of: preview, matching: find.byType(SvgPicture)),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    '[MOB-CMP-001][flutter] composer hides unsupported runtime settings',
    (tester) async {
      final base = relaySession(provider: 'codex');
      final session = RelaySession.fromJson({
        ...base.raw,
        'session_config_options': [
          {
            'type': 'select',
            'id': 'model',
            'name': '模型',
            'currentValue': 'custom-orchid-v9',
            'options': [
              {'value': 'custom-orchid-v9', 'name': 'Orchid 9'},
              {'value': 'custom-cedar-v2', 'name': 'Cedar 2'},
            ],
          },
          {
            'type': 'select',
            'id': 'reasoning',
            'name': '推理强度',
            'currentValue': 'ultra',
            'options': [
              {'value': 'medium', 'name': '中'},
              {'value': 'ultra', 'name': 'Ultra'},
            ],
          },
          {
            'type': 'select',
            'id': 'speed',
            'name': '速度',
            'currentValue': 'default',
            'options': [
              {'value': 'default', 'name': '标准'},
              {
                'value': 'priority',
                'name': 'Fast',
                'description': '使用更快的 service tier',
              },
            ],
          },
        ],
      });
      final controller = workbenchController(sessions: [session]);
      addTearDown(controller.dispose);

      await pumpWorkbench(
        tester,
        controller,
        size: const Size(320, 700),
        textScale: 1.4,
      );

      expect(
        find.byKey(const ValueKey('composer-runtime-settings')),
        findsNothing,
      );
      expect(find.text('Orchid 9 · Ultra · 标准'), findsNothing);
      expect(find.byType(TextField), findsWidgets);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('[MOB-ATT-009][flutter] generated previews use balanced 720p', (
    tester,
  ) async {
    final source = _largeBmp(width: 1600, height: 900);
    expect(source.lengthInBytes, greaterThan(maxImageThumbnailBytes));

    final thumbnail = (await tester.runAsync(
      () => createImageThumbnail(source),
    ))!;
    expect(thumbnail.lengthInBytes, lessThanOrEqualTo(maxImageThumbnailBytes));

    final decoded = image.decodeImage(thumbnail);
    expect(decoded, isNotNull);
    expect(decoded!.width, imageThumbnailWidth);
    expect(decoded.height, imageThumbnailHeight);
  });

  for (final layout in [(320.0, 1.0), (390.0, 1.6)]) {
    testWidgets(
      '[MOB-MSG-008][flutter] wide Markdown tables scroll independently at $layout',
      (tester) async {
        final controller = workbenchController();
        addTearDown(controller.dispose);
        controller.messages['root'] = const [
          RelayMessage(
            id: 'wide-table',
            role: 'codex',
            content:
                '表格前的正文\n\n'
                '| 项目 | 状态 | 说明 | 文档 | 时间 | 负责人 |\n'
                '| --- | :---: | --- | --- | ---: | --- |\n'
                '| 移动端 | 完成 | 多列表格中的长说明应当自然换行，保持清晰易读，不要挤成逐字竖排。 | '
                '[文档](https://example.com) | 09:30 | 最后一列 |\n'
                '| API | 进行中 | `very_long_identifier_without_spaces_abcdefghijklmnopqrstuvwxyz` | | 10:00 | 小林 |',
            createdAt: '2026-09-08T00:00:00Z',
            kind: 'message.completed',
          ),
        ];
        await pumpWorkbench(
          tester,
          controller,
          size: Size(layout.$1, 850),
          textScale: layout.$2,
        );
        final markdown = find.byType(MarkdownBody);
        final tableFinder = find.descendant(
          of: markdown,
          matching: find.byType(Table),
        );
        final table = tester.widget<Table>(tableFinder);
        final horizontal = find.descendant(
          of: markdown,
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is Scrollable &&
                axisDirectionToAxis(widget.axisDirection) == Axis.horizontal,
          ),
        );
        expect(horizontal, findsOneWidget);
        final position = tester.state<ScrollableState>(horizontal).position;
        expect(position.maxScrollExtent, greaterThan(0));
        for (final cell in table.children.first.children) {
          final width = tester.getSize(find.byWidget(cell)).width;
          expect(width, greaterThanOrEqualTo(88 * layout.$2 - 1));
          expect(width, lessThanOrEqualTo(240 * layout.$2 + 1));
        }
        final bodyBefore = tester.getTopLeft(markdown);
        final lastCell = find.byWidget(table.children.first.children.last);
        final lastBefore = tester.getTopLeft(lastCell).dx;
        await tester.drag(horizontal, const Offset(-220, 0));
        await tester.pump(const Duration(milliseconds: 350));
        expect(position.pixels, greaterThan(0));
        expect(tester.getTopLeft(lastCell).dx, lessThan(lastBefore));
        expect(tester.getTopLeft(markdown), bodyBefore);
        position.jumpTo(position.maxScrollExtent);
        await tester.pump();
        expect(
          tester.getBottomRight(lastCell).dx,
          lessThanOrEqualTo(tester.getBottomRight(horizontal).dx + 1),
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    '[MOB-MSG-008][flutter] short two-column tables fit a narrow phone',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = const [
        RelayMessage(
          id: 'short-table',
          role: 'codex',
          content: '| 项目 | 状态 |\n| --- | --- |\n| A | 完成 |',
          createdAt: '2026-09-08T00:00:00Z',
          kind: 'message.completed',
        ),
      ];
      await pumpWorkbench(tester, controller, size: const Size(320, 700));
      final horizontal = find.descendant(
        of: find.byType(MarkdownBody),
        matching: find.byWidgetPredicate(
          (widget) =>
              widget is Scrollable &&
              axisDirectionToAxis(widget.axisDirection) == Axis.horizontal,
        ),
      );
      expect(
        tester.state<ScrollableState>(horizontal).position.maxScrollExtent,
        0,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-MSG-007][flutter] Markdown quotes use the native dark treatment',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = const [
        RelayMessage(
          id: 'quote-message',
          role: 'codex',
          content: '> 核心用户路径必须完整走通。',
          createdAt: '2026-08-30T10:00:00Z',
          kind: 'message.completed',
          turnId: 'turn-quote',
        ),
      ];

      await pumpWorkbench(tester, controller);

      final quoteDecorations = tester
          .widgetList<DecoratedBox>(find.byType(DecoratedBox))
          .map((widget) => widget.decoration)
          .whereType<BoxDecoration>()
          .where((decoration) {
            final border = decoration.border;
            return border is Border &&
                border.left.width == 3 &&
                border.left.color == RelayTheme.line;
          });
      expect(quoteDecorations, hasLength(1));
      expect(quoteDecorations.single.color, Colors.transparent);
      expect(quoteDecorations.single.color, isNot(Colors.blue.shade100));
    },
  );

  testWidgets(
    '[MOB-MSG-001][flutter] completed turn activity and system reminders stay collapsed until requested',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = const [
        RelayMessage(
          id: 'user-1',
          role: 'user',
          content: '检查项目',
          createdAt: '2026-08-10T10:00:00Z',
          kind: 'user.message',
          turnId: 'turn-1',
        ),
        RelayMessage(
          id: 'tool-1',
          role: 'system',
          content: '本机工具：flutter test',
          createdAt: '2026-08-10T10:00:01Z',
          kind: 'command.started',
          turnId: 'turn-1',
        ),
        RelayMessage(
          id: 'progress-1',
          role: 'codex',
          content: '先确认模拟器与工程入口。\n再构建并安装应用。',
          createdAt: '2026-08-10T10:00:02Z',
          kind: 'message.delta',
          turnId: 'turn-1',
          messagePhase: 'commentary',
        ),
        RelayMessage(
          id: 'answer-1',
          role: 'codex',
          content: '已完成。\n<system-reminder>这是仅在展开后显示的系统提醒。</system-reminder>',
          createdAt: '2026-08-10T10:00:04Z',
          kind: 'message.completed',
          turnId: 'turn-1',
          messagePhase: 'final_answer',
        ),
      ];

      await pumpWorkbench(tester, controller);

      expect(find.text('本轮完成'), findsOneWidget);
      expect(find.text('本机工具：flutter test'), findsNothing);
      expect(find.text('系统提醒'), findsOneWidget);
      expect(find.text('这是仅在展开后显示的系统提醒。'), findsNothing);
      final reminderLabel = tester.widget<Text>(find.text('系统提醒'));
      expect(reminderLabel.style?.fontSize, 10);
      expect(reminderLabel.style?.fontWeight, FontWeight.w400);
      expect(
        tester.getSize(find.byKey(const ValueKey('system-reminder:1'))).height,
        lessThanOrEqualTo(44),
      );
      expect(find.byIcon(Icons.info_outline_rounded), findsNothing);

      await tester.tap(find.text('本轮完成'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.text('本机工具：flutter test'), findsOneWidget);
      expect(find.textContaining('先确认模拟器与工程入口。'), findsOneWidget);
      expect(find.textContaining('再构建并安装应用。'), findsOneWidget);
      final progress = find.byKey(
        const ValueKey('turn-activity-message-progress-1'),
      );
      expect(
        find.descendant(of: progress, matching: find.byType(InkWell)),
        findsNothing,
      );

      await tester.tap(find.text('系统提醒'));
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.text('这是仅在展开后显示的系统提醒。'), findsOneWidget);
    },
  );

  testWidgets(
    '[MOB-KIM-001][flutter] Kimi strip exposes quick commands settings usage swarm and dangerous confirmation',
    (tester) async {
      final session = RelaySession.fromJson({
        ...relaySession(provider: 'kimi').raw,
        'model': 'kimi-k2',
        'reasoning_effort': 'high',
        'permission_mode': 'manual',
        'swarm_mode': true,
        'usage': {'used': 32000, 'size': 128000},
        'kimi_commands': [
          {
            'name': 'review',
            'description': 'Review changes',
            'input_hint': 'path',
          },
        ],
        'kimi_config_options': [
          {
            'type': 'select',
            'id': 'mode',
            'name': '权限模式',
            'description': '控制本机工具审批。',
            'currentValue': 'manual',
            'options': [
              {'value': 'manual', 'name': 'Manual'},
              {'value': 'auto', 'name': 'Auto'},
              {'value': 'yolo', 'name': 'YOLO'},
            ],
          },
        ],
      });
      final controller = workbenchController(sessions: [session]);
      addTearDown(controller.dispose);

      await pumpWorkbench(tester, controller);

      expect(find.text('kimi-k2'), findsOneWidget);
      expect(find.text('Thinking high'), findsOneWidget);
      expect(find.text('Swarm'), findsOneWidget);
      expect(find.text('上下文 25% · 32k/128k'), findsOneWidget);

      await tester.tap(find.text('kimi-k2'));
      await tester.pump();
      expect(find.text('快捷命令'), findsOneWidget);
      expect(find.text('会话设置'), findsOneWidget);

      await tester.tap(find.text('快捷命令'));
      await tester.pump();
      await tester.enterText(find.byType(TextField).last, '/rev');
      await tester.pump();
      expect(find.text('/review'), findsOneWidget);

      await tester.tap(find.text('会话设置'));
      await tester.pump();
      await tester.tap(find.text('YOLO'));
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.text('启用 YOLO 模式？'), findsOneWidget);
      expect(find.text('确认启用'), findsOneWidget);
    },
  );

  testWidgets(
    '[MOB-AGT-008][flutter] inline Agent detail opens child workbench with its own model',
    (tester) async {
      final agent = RelayAgent.fromJson({
        'id': 'agent-1',
        'thread_id': 'thread-1',
        'parent_session_id': 'root',
        'name': 'Reviewer',
        'role': 'reviewer',
        'task': 'Review mobile parity',
        'status': 'running',
        'progress': 72,
        'summary': 'All parity checks passed.',
        'model': 'gpt-5',
        'reasoning_effort': 'high',
        'tool_count': 4,
        'token_count': 12500,
        'context_tokens': 42000,
        'activity_log': [
          {
            'id': 'activity-1',
            'kind': 'tool',
            'label': 'Ran Flutter tests',
            'occurred_at': '2026-08-10T10:01:00Z',
          },
        ],
      });
      final controller = workbenchController(agents: [agent]);
      addTearDown(controller.dispose);
      controller.messages['thread-1'] = [
        RelayMessage(
          id: 'child-reply',
          role: 'codex',
          kind: 'message.completed',
          content: 'Stored child conversation reply',
          createdAt: '2026-08-10T10:02:00Z',
        ),
      ];
      controller.markHistoryLoadedForTesting('thread-1');

      await pumpWorkbench(tester, controller);
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 240));
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-agent-agent-1')),
      );
      await tester.pumpAndSettle();

      expect(find.text('gpt-5'), findsNothing);
      expect(find.text('最新结果'), findsOneWidget);
      expect(
        find.text('All parity checks passed.', findRichText: true),
        findsWidgets,
      );
      expect(find.text('模型配置: gpt-5 · high'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('agent-task-runtime-agent-1')),
        findsNothing,
      );
      expect(find.text('4 个工具'), findsNothing);
      expect(find.text('12.5k tok'), findsNothing);
      expect(find.text('上下文 42k'), findsNothing);

      expect(find.byKey(const ValueKey('agent-task-activity-agent-1')), findsNothing);
      expect(find.text('任务原文'), findsNothing);
      expect(find.text('Ran Flutter tests'), findsNothing);
      expect(find.byType(LinearProgressIndicator), findsNothing);

      await tester.tap(
        find.byKey(const ValueKey('agent-task-open-conversation')),
      );
      // The running parent keeps an activity animation alive in the workbench.
      // Complete the route transition without waiting for that animation.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(controller.activeSessionId, 'thread-1');
      expect(controller.activeSession!.isSubagent, isTrue);
      expect(controller.activeSession!.rootSessionId, 'root');
      expect(controller.activeSession!.raw['model'], 'gpt-5');
      expect(controller.activeSession!.raw['reasoning_effort'], 'high');
      expect(controller.activeSession!.supportsSteering, isFalse);
      expect(controller.activeSession!.canInterrupt, isFalse);
      expect(
        find.byKey(const ValueKey('session-model-settings-button')),
        findsNothing,
      );
      expect(
        find.text('Stored child conversation reply', findRichText: true),
        findsOneWidget,
      );
      expect(find.text('最新结果'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-ATT-005][flutter] switching sessions isolates pending composer state',
    (tester) async {
      final controller = workbenchController(
        sessions: [
          relaySession(id: 'root', name: 'Root'),
          relaySession(id: 'other', name: 'Other'),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);

      final composer = find.byType(TextField).last;
      await tester.enterText(composer, '只属于 Root 的草稿');
      expect(find.text('只属于 Root 的草稿'), findsOneWidget);

      await controller.selectSession('other');
      await tester.pump();

      expect(find.text('只属于 Root 的草稿'), findsNothing);
      expect(
        tester.widget<TextField>(find.byType(TextField).last).controller?.text,
        isEmpty,
      );
    },
  );

  testWidgets(
    '[MOB-AGT-009][flutter] non-openable Agent never exposes thread navigation',
    (tester) async {
      final agent = RelayAgent.fromJson({
        'id': 'agent-closed',
        'thread_id': 'thread-private',
        'parent_session_id': 'root',
        'name': 'Private worker',
        'task': 'Internal coordination only',
        'status': 'running',
        'progress': 60,
        'can_open': false,
      });
      final controller = workbenchController(agents: [agent]);
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);

      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-toggle')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 240));
      await tester.tap(
        find.byKey(const ValueKey('composer-agent-status-agent-agent-closed')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 240));
      expect(controller.activeSessionId, 'root');

      expect(find.text('活动时间线'), findsNothing);
      expect(find.text('任务原文'), findsNothing);
      expect(find.text('打开子线程'), findsNothing);
    },
  );
}

RelayEvent _event(String eventId, Map<String, dynamic> event) => RelayEvent(
  cursor: 0,
  eventId: eventId,
  sessionId: 'root',
  agentId: null,
  createdAt: '2026-08-30T10:00:00Z',
  event: event,
);

RelayEvent _eventAt(
  String eventId,
  String createdAt,
  Map<String, dynamic> event,
) => RelayEvent(
  cursor: 0,
  eventId: eventId,
  sessionId: 'root',
  agentId: null,
  createdAt: createdAt,
  event: event,
);

Uint8List _largeBmp({int width = 256, int height = 256}) {
  const headerBytes = 54;
  final rowBytes = width * 3;
  final bytes = Uint8List(headerBytes + rowBytes * height);
  final header = ByteData.sublistView(bytes);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  header
    ..setUint32(2, bytes.length, Endian.little)
    ..setUint32(10, headerBytes, Endian.little)
    ..setUint32(14, 40, Endian.little)
    ..setInt32(18, width, Endian.little)
    ..setInt32(22, height, Endian.little)
    ..setUint16(26, 1, Endian.little)
    ..setUint16(28, 24, Endian.little)
    ..setUint32(34, rowBytes * height, Endian.little);
  for (var y = 0; y < height; y += 1) {
    final rowOffset = headerBytes + y * rowBytes;
    for (var x = 0; x < width; x += 1) {
      final pixelOffset = rowOffset + x * 3;
      bytes[pixelOffset] = x * 255 ~/ width;
      bytes[pixelOffset + 1] = y * 255 ~/ height;
      bytes[pixelOffset + 2] = (x + y) * 255 ~/ (width + height);
    }
  }
  return bytes;
}

class _DelayedAttachmentController extends AppController {
  final List<Completer<Uint8List>> _pendingReads = [];
  final List<RelayAttachmentVariant> variants = [];
  int loadCalls = 0;
  DownloadProgressCallback? onDownloadProgress;

  @override
  Future<Uint8List> loadAttachment(
    String sessionId,
    RelayAttachment attachment, {
    RelayAttachmentVariant variant = RelayAttachmentVariant.original,
    DownloadProgressCallback? onProgress,
  }) {
    onDownloadProgress = onProgress;
    loadCalls += 1;
    variants.add(variant);
    final completer = Completer<Uint8List>();
    _pendingReads.add(completer);
    return completer.future;
  }

  void completeNext(List<int> bytes) {
    _pendingReads.removeAt(0).complete(Uint8List.fromList(bytes));
  }

  void failNext(Object error) {
    _pendingReads.removeAt(0).completeError(error);
  }
}
