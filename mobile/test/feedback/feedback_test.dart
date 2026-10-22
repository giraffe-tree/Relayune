import 'dart:convert';
import 'dart:typed_data';
import 'package:image/image.dart' as img;
import 'package:relayune_mobile/src/feedback/feedback_image.dart';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/feedback/feedback_info.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/ui/feedback_page.dart';
import 'package:relayune_mobile/src/ui/theme.dart';

void main() {
  test(
    'image preparation bounds size, strips metadata and rejects invalid input',
    () {
      final source = img.Image(width: 2400, height: 30);
      source.exif.imageIfd.make = 'Private camera';
      final prepared = prepareFeedbackImage(
        Uint8List.fromList(img.encodeJpg(source)),
      );
      final decoded = img.decodeJpg(prepared)!;
      expect(decoded.width, 2048);
      expect(prepared.length, lessThanOrEqualTo(maxFeedbackImageBytes));
      expect(decoded.exif.imageIfd.make, isNull);
      expect(
        () => prepareFeedbackImage(Uint8List.fromList([1, 2, 3])),
        throwsFormatException,
      );
    },
  );

  testWidgets(
    'three attachments, removal, contact autofill and optional clearing survive retry',
    (tester) async {
      tester.view.physicalSize = const Size(420, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = _FeedbackApi();
      final image = FeedbackImage(
        Uint8List.fromList(img.encodeJpg(img.Image(width: 8, height: 8))),
      );
      final requested = <int>[];
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('zh', 'CN'),
          supportedLocales: relayuneSupportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          theme: RelayTheme.web,
          home: FeedbackPage(
            api: api,
            email: 'hello@example.com',
            loadInfo: () async => const FeedbackInfo(),
            pickImages: (remaining) async {
              requested.add(remaining);
              return List.filled(remaining, image);
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      final email = find.byKey(const ValueKey('feedback-email'));
      expect(
        tester.widget<TextField>(email).controller!.text,
        'hello@example.com',
      );
      await tester.tap(find.byKey(const ValueKey('feedback-add-image')));
      await tester.pumpAndSettle();
      expect(requested, [3]);
      expect(find.byKey(const ValueKey('feedback-add-image')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('feedback-remove-image-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('feedback-add-image')));
      await tester.pumpAndSettle();
      expect(requested, [3, 1]);
      await tester.enterText(
        find.byKey(const ValueKey('feedback-description')),
        '截图中的问题',
      );
      await tester.enterText(email, 'bad-email');
      await tester.tap(find.byKey(const ValueKey('feedback-submit')));
      await tester.pumpAndSettle();
      expect(api.sent, isEmpty);
      expect(find.text('请填写有效邮箱，或留空。'), findsOneWidget);
      await tester.enterText(email, '');
      await tester.enterText(
        find.byKey(const ValueKey('feedback-wechat')),
        ' wechat_123 ',
      );
      await tester.tap(find.byKey(const ValueKey('feedback-submit')));
      await tester.pumpAndSettle();
      expect(api.sent.single['contact'], {'email': '', 'wechat': 'wechat_123'});
      expect(api.sent.single['images'], hasLength(3));
      await tester.tap(find.byKey(const ValueKey('feedback-submit')));
      await tester.pumpAndSettle();
      expect(jsonEncode(api.sent[0]), jsonEncode(api.sent[1]));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'visible metadata, blank validation, failure retention and idempotent retry',
    (tester) async {
      tester.view.physicalSize = const Size(420, 1100);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = _FeedbackApi();
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('zh', 'CN'),
          supportedLocales: relayuneSupportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          theme: RelayTheme.web,
          home: FeedbackPage(
            api: api,
            loadInfo: () async => const FeedbackInfo(
              appVersion: '0.3.19+29',
              model: 'iPhone (iPhone17,3)',
              system: 'iOS 18.5.1',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('0.3.19+29'), findsOneWidget);
      expect(find.text('iPhone (iPhone17,3)'), findsOneWidget);
      expect(find.text('iOS 18.5.1'), findsOneWidget);
      Future<void> submit() async {
        final button = find.byKey(const ValueKey('feedback-submit'));
        await tester.ensureVisible(button);
        await tester.tap(button);
        await tester.pumpAndSettle();
      }

      await submit();
      expect(api.sent, isEmpty);
      expect(find.text('请先填写反馈描述。'), findsOneWidget);
      await tester.ensureVisible(
        find.byKey(const ValueKey('feedback-description')),
      );
      await tester.tap(find.widgetWithText(ChoiceChip, 'Bug 问题'));
      await tester.enterText(
        find.byKey(const ValueKey('feedback-description')),
        '切换任务时界面卡住',
      );
      await submit();
      expect(api.sent, hasLength(1));
      expect(api.sent.single['category'], 'bug');
      expect(api.sent.single['description'], '切换任务时界面卡住');
      expect(api.sent.single['environment'], {
        'app_version': '0.3.19+29',
        'device_model': 'iPhone (iPhone17,3)',
        'os_version': 'iOS 18.5.1',
      });
      expect(api.sent.single.keys.toSet(), {
        'id',
        'category',
        'description',
        'environment',
        'client',
        'contact',
        'images',
      });
      expect(find.text('切换任务时界面卡住'), findsOneWidget);
      expect(find.text('提交失败，内容已保留。请检查网络后重试。'), findsOneWidget);
      await submit();
      expect(api.sent, hasLength(2));
      expect(jsonEncode(api.sent[0]), jsonEncode(api.sent[1]));
      expect(find.text('反馈已收到，感谢你的帮助。'), findsOneWidget);
      expect(find.text(api.sent[0]['id'] as String), findsOneWidget);
      expect(find.byKey(const ValueKey('feedback-description')), findsNothing);
    },
  );

  testWidgets(
    'metadata failure displays unavailable fields without blocking feedback',
    (tester) async {
      tester.view.physicalSize = const Size(420, 1100);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = _FeedbackApi();
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('zh', 'CN'),
          supportedLocales: relayuneSupportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: FeedbackPage(
            api: api,
            loadInfo: () async => throw StateError('plugin unavailable'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('未获取'), findsNWidgets(3));
      expect(
        tester
            .widget<FilledButton>(find.byKey(const ValueKey('feedback-submit')))
            .onPressed,
        isNotNull,
      );
    },
  );

  testWidgets('feedback stays usable on a narrow screen with larger text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('zh', 'CN'),
        supportedLocales: relayuneSupportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        theme: RelayTheme.web,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.3)),
          child: child!,
        ),
        home: FeedbackPage(
          api: _FeedbackApi(),
          loadInfo: () async => const FeedbackInfo(
            appVersion: '0.3.19+29',
            model: 'iPhone 16 (iPhone17,3)',
            system: 'iOS 18.5.1',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('feedback-submit')),
      180,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const ValueKey('feedback-submit')))
          .onPressed,
      isNotNull,
    );
  });
}

class _FeedbackApi extends RelayApi {
  final sent = <Map<String, dynamic>>[];
  @override
  Future<String> submitFeedback(Map<String, dynamic> submission) async {
    sent.add(submission);
    if (sent.length == 1) {
      throw const RelayApiException('failed', 500, 'failed');
    }
    return submission['id'] as String;
  }
}
