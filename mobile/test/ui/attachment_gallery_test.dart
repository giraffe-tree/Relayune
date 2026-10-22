import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/widgets/photo_deck.dart';

import '../support/workbench_fixture.dart';

final _pixel = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);

class _Images extends AppController {
  final requests = <(String, RelayAttachmentVariant)>[];
  @override
  Future<Uint8List> loadAttachment(
    String sessionId,
    RelayAttachment attachment, {
    RelayAttachmentVariant variant = RelayAttachmentVariant.original,
    DownloadProgressCallback? onProgress,
  }) async {
    requests.add((attachment.id, variant));
    return _pixel;
  }
}

List<RelayAttachment> _attachments(int count, {int files = 0}) => [
  for (var i = 0; i < count; i++)
    RelayAttachment(
      id: 'image-$i',
      type: 'image',
      name: '$i.png',
      mimeType: 'image/png',
      url: '/image-$i',
    ),
  for (var i = 0; i < files; i++)
    RelayAttachment(
      id: 'file-$i',
      type: 'file',
      name: '$i.md',
      mimeType: 'text/markdown',
      url: '/file-$i',
      previewSupported: true,
      localBytes: Uint8List.fromList(utf8.encode('# File $i')),
    ),
];

void _set(AppController c, int count, {int files = 0}) {
  c.messages['root'] = [
    RelayMessage(
      id: 'album',
      role: 'codex',
      content: '图片和文件',
      createdAt: '2026-09-25T00:00:00Z',
      kind: 'message.completed',
      turnId: 'album-turn',
      attachments: _attachments(count, files: files),
    ),
  ];
}

Future<void> _ready(WidgetTester tester) async {
  await tester.pump();
  for (final element in find.byType(Image).evaluate().toList()) {
    final image = element.widget as Image;
    await tester.runAsync(() => precacheImage(image.image, element));
  }
  await tester.pump(const Duration(milliseconds: 400));
  for (var frame = 0; frame < 20; frame++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  testWidgets('single photo preview excludes other messages and sessions', (
    tester,
  ) async {
    final loader = _Images();
    final c = workbenchController(baseController: loader);
    addTearDown(c.dispose);
    final attachments = _attachments(3, files: 1);
    c.messages['root'] = [
      for (var i = 0; i < 3; i++)
        RelayMessage(
          id: 'message-$i',
          role: i == 0 ? 'user' : 'codex',
          content: 'Photo $i',
          createdAt: '2026-09-25T00:00:0${i}Z',
          kind: i == 0 ? 'user.message' : 'message.completed',
          turnId: 'turn-$i',
          attachments: [attachments[i], if (i == 2) attachments.last],
        ),
    ];
    c.messages['other-session'] = [
      RelayMessage(
        id: 'unrelated',
        role: 'user',
        kind: 'user.message',
        content: '',
        createdAt: '2026-09-25T00:00:01Z',
        attachments: [
          RelayAttachment(
            id: 'unrelated-image',
            type: 'image',
            name: 'private.png',
            mimeType: 'image/png',
            url: '/private',
          ),
        ],
      ),
    ];
    await pumpWorkbench(tester, c, size: const Size(320, 1800));
    await _ready(tester);
    final thumbnail = find.byKey(
      const ValueKey('message-image-thumbnail-image-1'),
    );
    final size = tester.getSize(thumbnail);
    expect(size.width, size.height);
    expect(size.width, lessThanOrEqualTo(260));
    await tester.tap(thumbnail);
    await _ready(tester);
    String? position() => tester
        .widget<Text>(find.byKey(const ValueKey('attachment-gallery-position')))
        .data;
    expect(position(), '1 / 1');
    expect(
      loader.requests.where((r) => r.$1 == 'image-1').length,
      1,
      reason: 'Opening a ready thumbnail reuses its decoded preview bytes',
    );
    expect(
      find.byKey(const ValueKey('attachment-gallery-overview-toggle')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('message-image-dialog-preview-image-1')),
      findsOneWidget,
    );
    expect(loader.requests.any((r) => r.$1 == 'unrelated-image'), isFalse);
    expect(
      loader.requests.every((r) => r.$2 == RelayAttachmentVariant.preview),
      isTrue,
    );
    await tester.tap(find.byTooltip('关闭'));
    await _ready(tester);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'single image uses fullscreen zoom and three files stay visible',
    (tester) async {
      final c = workbenchController(baseController: _Images());
      addTearDown(c.dispose);
      _set(c, 1, files: 3);
      await pumpWorkbench(tester, c);
      await _ready(tester);
      expect(find.byKey(const ValueKey('message-file-file-2')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('attachment-files-toggle')),
        findsNothing,
      );
      final image = find.byKey(
        const ValueKey('message-image-thumbnail-image-0'),
      );
      expect(tester.getSize(image).width, lessThanOrEqualTo(196));
      await tester.tap(image);
      await _ready(tester);
      expect(
        find.byKey(const ValueKey('attachment-image-gallery')),
        findsOneWidget,
      );
      final viewerFinder = find.byType(InteractiveViewer).hitTestable();
      final viewer = tester.widget<InteractiveViewer>(viewerFinder);
      await tester.tapAt(tester.getCenter(viewerFinder));
      await tester.pump(const Duration(milliseconds: 60));
      await tester.tapAt(tester.getCenter(viewerFinder));
      await tester.pump();
      expect(
        viewer.transformationController!.value.getMaxScaleOnAxis(),
        closeTo(2.5, .01),
      );
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tapAt(tester.getCenter(viewerFinder));
      await tester.pump(const Duration(milliseconds: 60));
      await tester.tapAt(tester.getCenter(viewerFinder));
      await tester.pump();
      expect(viewer.transformationController!.value.getMaxScaleOnAxis(), 1);
      await tester.tap(find.byTooltip('关闭'));
      await _ready(tester);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('two fingers zoom in and out without paging the album', (
    tester,
  ) async {
    final c = workbenchController(baseController: _Images());
    addTearDown(c.dispose);
    _set(c, 3);
    await pumpWorkbench(tester, c);
    await _ready(tester);
    await tester.tap(find.byKey(const ValueKey('attachment-photo-deck-pager')));
    await _ready(tester);
    final finder = find.byType(InteractiveViewer).hitTestable();
    final transform = tester
        .widget<InteractiveViewer>(finder)
        .transformationController!;
    final center = tester.getCenter(finder);
    final left = await tester.startGesture(
      center - const Offset(40, 0),
      pointer: 1,
    );
    final right = await tester.startGesture(
      center + const Offset(40, 0),
      pointer: 2,
    );
    await tester.pump();
    await left.moveTo(center - const Offset(45, 0));
    await right.moveTo(center + const Offset(45, 0));
    await tester.pump();
    await left.moveTo(center - const Offset(100, 0));
    await right.moveTo(center + const Offset(100, 0));
    await tester.pump();
    await left.moveTo(center - const Offset(140, 0));
    await right.moveTo(center + const Offset(140, 0));
    await tester.pump();
    expect(transform.value.getMaxScaleOnAxis(), greaterThan(1.5));
    await left.moveTo(center - const Offset(20, 0));
    await right.moveTo(center + const Offset(20, 0));
    await tester.pump();
    expect(transform.value.getMaxScaleOnAxis(), closeTo(1, .01));
    await left.up();
    await right.up();
    await _ready(tester);
    expect(
      tester
          .widget<Text>(
            find.byKey(const ValueKey('attachment-gallery-position')),
          )
          .data,
      '1 / 3',
    );
    expect(tester.takeException(), isNull);
  });

  for (final outcome in ['saved', 'denied', 'failed']) {
    testWidgets('saving a gallery image: $outcome', (tester) async {
      final loader = _Images();
      final c = workbenchController(baseController: loader);
      addTearDown(c.dispose);
      _set(c, 1);
      final calls = <MethodCall>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        const MethodChannel('gal'),
        (call) async {
          calls.add(call);
          if (call.method == 'hasAccess') return false;
          if (call.method == 'requestAccess') return outcome != 'denied';
          if (outcome == 'failed') throw PlatformException(code: 'unexpected');
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          const MethodChannel('gal'),
          null,
        ),
      );
      await pumpWorkbench(tester, c);
      await _ready(tester);
      await tester.tap(
        find.byKey(const ValueKey('message-image-thumbnail-image-0')),
      );
      await _ready(tester);
      await tester.tap(
        find.byKey(const ValueKey('message-image-save-image-0')),
      );
      await _ready(tester);
      final writes = calls.where((call) => call.method == 'putImageBytes');
      if (outcome == 'denied') {
        expect(writes, isEmpty);
        expect(
          loader.requests.where((r) => r.$2 == RelayAttachmentVariant.original),
          isEmpty,
        );
        expect(find.text('请在系统设置中允许保存图片到相册后重试。'), findsOneWidget);
      } else {
        expect(writes.single.arguments['bytes'], _pixel);
        expect(writes.single.arguments['name'], '0');
        expect(
          loader.requests.where((r) => r.$2 == RelayAttachmentVariant.original),
          [('image-0', RelayAttachmentVariant.original)],
        );
        expect(
          find.text(outcome == 'saved' ? '已保存到相册' : '保存失败，请重试。'),
          findsOneWidget,
        );
      }
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets(
    'album pages inline, lazily reads previews and retains its page on append',
    (tester) async {
      final loader = _Images();
      final c = workbenchController(baseController: loader);
      addTearDown(c.dispose);
      _set(c, 20);
      await pumpWorkbench(tester, c);
      await _ready(tester);
      expect(loader.requests.length, lessThanOrEqualTo(3));
      expect(
        loader.requests.every((r) => r.$2 == RelayAttachmentVariant.preview),
        isTrue,
      );
      final deck = find.byType(PhotoDeck);
      final before = tester.getRect(deck);
      await tester.drag(
        find.byKey(const ValueKey('attachment-photo-deck-pager')),
        const Offset(-270, 0),
      );
      await _ready(tester);
      expect(find.text('2 / 20'), findsOneWidget);
      expect(tester.getRect(deck), before);
      _set(c, 21);
      await pumpWorkbench(tester, c);
      await _ready(tester);
      expect(find.text('2 / 21'), findsOneWidget);
      await tester.drag(
        find.byKey(const ValueKey('attachment-photo-deck-pager')),
        const Offset(270, 0),
      );
      await _ready(tester);
      expect(find.text('1 / 21'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'large gallery swipes, loads originals on demand and returns to the selected photo',
    (tester) async {
      final loader = _Images();
      final c = workbenchController(baseController: loader);
      addTearDown(c.dispose);
      _set(c, 4);
      await pumpWorkbench(tester, c);
      await _ready(tester);
      await tester.tap(
        find.byKey(const ValueKey('attachment-photo-deck-pager')),
      );
      await _ready(tester);
      expect(
        find.byKey(const ValueKey('attachment-image-gallery')),
        findsOneWidget,
      );
      await tester.drag(
        find.byKey(const ValueKey('attachment-gallery-pager')),
        const Offset(-330, 0),
      );
      await _ready(tester);
      expect(
        tester
            .widget<Text>(
              find.byKey(const ValueKey('attachment-gallery-position')),
            )
            .data,
        '2 / 4',
      );
      expect(
        loader.requests.every((r) => r.$2 == RelayAttachmentVariant.preview),
        isTrue,
      );
      await tester.tap(
        find.byKey(const ValueKey('message-image-load-original-image-1')),
      );
      await _ready(tester);
      expect(
        loader.requests
            .where((r) => r.$2 == RelayAttachmentVariant.original)
            .toList(),
        [('image-1', RelayAttachmentVariant.original)],
      );
      final viewer = tester.widget<InteractiveViewer>(
        find.byType(InteractiveViewer).hitTestable().first,
      );
      viewer.transformationController!.value = Matrix4.diagonal3Values(2, 2, 1);
      await tester.pump();
      expect(
        tester
            .widget<PageView>(
              find.byKey(const ValueKey('attachment-gallery-pager')),
            )
            .physics,
        isA<NeverScrollableScrollPhysics>(),
      );
      viewer.transformationController!.value = Matrix4.identity();
      await tester.pump();
      expect(
        tester
            .widget<PageView>(
              find.byKey(const ValueKey('attachment-gallery-pager')),
            )
            .physics,
        isNot(isA<NeverScrollableScrollPhysics>()),
      );
      await tester.tap(find.byTooltip('关闭'));
      await _ready(tester);
      expect(find.text('2 / 4'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'fullscreen overview returns to the same photo position in history',
    (tester) async {
      final c = workbenchController(baseController: _Images());
      addTearDown(c.dispose);
      _set(c, 8);
      final album = c.messages['root']!.single;
      c.messages['root'] = [
        for (var i = 0; i < 8; i++)
          RelayMessage(
            id: 'older-$i',
            role: 'codex',
            kind: 'message.completed',
            turnId: 'older-turn-$i',
            content: 'Earlier reply. ' * 20,
            createdAt: '2026-09-24T00:00:00Z',
          ),
        RelayMessage(
          id: 'old-photo',
          role: 'user',
          kind: 'user.message',
          content: 'Earlier photo',
          createdAt: '2026-09-24T00:00:00Z',
          attachments: [
            RelayAttachment(
              id: 'old-image',
              type: 'image',
              name: 'old.png',
              mimeType: 'image/png',
              url: '/old',
            ),
          ],
        ),
        album,
      ];
      await pumpWorkbench(tester, c);
      await _ready(tester);
      final deck = find.byType(PhotoDeck);
      final before = tester.getTopLeft(deck).dy;
      await tester.tap(
        find.byKey(const ValueKey('attachment-photo-overview-toggle')),
      );
      await _ready(tester);
      expect(
        find.byKey(const ValueKey('attachment-image-gallery')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('attachment-photo-overview')),
        findsOneWidget,
      );
      expect(
        tester
            .widget<GridView>(
              find.byKey(const ValueKey('attachment-photo-overview')),
            )
            .childrenDelegate
            .estimatedChildCount,
        8,
      );
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('attachment-photo-overview')),
          matching: find.byKey(
            const ValueKey('message-image-thumbnail-old-image'),
          ),
        ),
        findsNothing,
      );
      await tester.tap(find.byTooltip('关闭'));
      await _ready(tester);
      expect(tester.getTopLeft(deck).dy, closeTo(before, 1));
      final scroll = tester
          .widget<ScrollView>(
            find.byKey(const ValueKey('conversation-message-list')),
          )
          .controller!;
      final offset = scroll.offset;
      await tester.drag(
        find.byKey(const ValueKey('attachment-photo-deck-pager')),
        const Offset(0, 150),
      );
      await _ready(tester);
      expect(scroll.offset, isNot(offset));
      expect(find.text('1 / 8'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('RTL photos swipe in reading order with reduced motion', (
    tester,
  ) async {
    final c = workbenchController(baseController: _Images());
    addTearDown(c.dispose);
    c.setLocale(const Locale('ar'));
    _set(c, 3);
    await pumpWorkbench(tester, c, disableAnimations: true);
    await _ready(tester);
    await tester.drag(
      find.byKey(const ValueKey('attachment-photo-deck-pager')),
      const Offset(270, 0),
    );
    await _ready(tester);
    expect(find.text('2 / 3'), findsOneWidget);
    await tester.drag(
      find.byKey(const ValueKey('attachment-photo-deck-pager')),
      const Offset(270, 0),
    );
    await _ready(tester);
    expect(find.text('3 / 3'), findsOneWidget);
    final semantic = tester.ensureSemantics();
    expect(find.bySemanticsLabel(RegExp('3 / 3,.*2.png')), findsOneWidget);
    semantic.dispose();
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'file folding, overview selection and reduced motion fit a narrow screen',
    (tester) async {
      final c = workbenchController(baseController: _Images());
      addTearDown(c.dispose);
      _set(c, 3, files: 4);
      await pumpWorkbench(
        tester,
        c,
        size: const Size(320, 1000),
        disableAnimations: true,
        textScale: 1.3,
      );
      await _ready(tester);
      expect(find.byKey(const ValueKey('message-file-file-3')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('attachment-files-toggle')));
      await _ready(tester);
      expect(find.byKey(const ValueKey('message-file-file-3')), findsOneWidget);
      await tester.ensureVisible(
        find.byKey(const ValueKey('attachment-files-toggle')),
      );
      await _ready(tester);
      await tester.tap(find.byKey(const ValueKey('attachment-files-toggle')));
      await _ready(tester);
      expect(find.byKey(const ValueKey('message-file-file-3')), findsNothing);
      await tester.ensureVisible(
        find.byKey(const ValueKey('attachment-photo-overview-toggle')),
      );
      await _ready(tester);
      await tester.tap(
        find.byKey(const ValueKey('attachment-photo-overview-toggle')),
      );
      await _ready(tester);
      final overview = find.byKey(const ValueKey('attachment-photo-overview'));
      expect(overview, findsOneWidget);
      final image = find.descendant(
        of: overview,
        matching: find.byKey(const ValueKey('message-image-thumbnail-image-2')),
      );
      await tester.ensureVisible(image);
      await _ready(tester);
      await tester.tap(image);
      await _ready(tester);
      expect(
        tester
            .widget<Text>(
              find.byKey(const ValueKey('attachment-gallery-position')),
            )
            .data,
        '3 / 3',
      );
      expect(tester.takeException(), isNull);
    },
  );
}
