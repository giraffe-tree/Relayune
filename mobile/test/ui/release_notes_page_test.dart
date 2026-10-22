import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/ui/release_notes_page.dart';

import '../support/workbench_fixture.dart';

void main() {
  setUp(() {
    PackageInfo.setMockInitialValues(
      appName: 'Relayune',
      packageName: 'cn.giraffetree.relayune',
      version: '0.3.21',
      buildNumber: '31',
      buildSignature: '',
    );
  });

  testWidgets(
    '[MOB-REL-004][flutter] settings expose a low-interruption release notes entry',
    (tester) async {
      tester.platformDispatcher.localeTestValue = const Locale('zh', 'CN');
      addTearDown(tester.platformDispatcher.clearLocaleTestValue);
      final api = _releaseApi();
      final controller = workbenchController(api: api);
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);

      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 320));

      expect(find.text('版本记录'), findsNothing);
      expect(find.byIcon(Icons.refresh), findsNothing);
      expect(
        find.byKey(const ValueKey('drawer-settings-entry')),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('drawer-settings-entry')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.byKey(const ValueKey('settings-release-notes-entry')),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('settings-release-notes-entry')),
      );
      await tester.pumpAndSettle();

      expect(find.text('版本记录'), findsOneWidget);
      expect(find.byType(ReleaseNotesPage), findsOneWidget);
    },
  );

  for (final width in [320.0, 360.0, 390.0]) {
    testWidgets(
      '[MOB-REL-005][flutter] release notes fit ${width.toInt()}px at 1.3 text scale',
      (tester) async {
        tester.view.physicalSize = Size(width, 700);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          MaterialApp(
            locale: const Locale('zh'),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(1.3)),
              child: child!,
            ),
            home: ReleaseNotesPage(
              api: _releaseApi(),
              locale: const Locale('zh'),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        expect(find.text('v0.3.0'), findsOneWidget);
        expect(find.text('Android'), findsOneWidget);
        expect(find.text('iOS'), findsOneWidget);
        expect(find.byIcon(Icons.refresh), findsNothing);
      },
    );
  }

  testWidgets(
    '[MOB-REL-006][flutter] release notes show loading and empty states',
    (tester) async {
      final completer = Completer<http.Response>();
      final api = RelayApi(client: MockClient((_) => completer.future));
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('zh'),
          home: ReleaseNotesPage(api: api, locale: const Locale('zh')),
        ),
      );

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      completer.complete(_jsonResponse({'locale': 'zh-CN', 'releases': []}));
      await tester.pumpAndSettle();

      expect(find.text('暂无版本记录'), findsOneWidget);
      expect(find.text('后续更新会显示在这里。'), findsOneWidget);
    },
  );

  testWidgets(
    '[MOB-REL-007][flutter] release notes show an error and can retry',
    (tester) async {
      var calls = 0;
      final api = RelayApi(
        client: MockClient((_) async {
          calls += 1;
          if (calls == 1) return http.Response('unavailable', 503);
          return _jsonResponse({'locale': 'zh-CN', 'releases': []});
        }),
      );
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('zh'),
          home: ReleaseNotesPage(api: api, locale: const Locale('zh')),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('暂时无法载入版本记录'), findsOneWidget);
      expect(find.text('重试'), findsOneWidget);
      await tester.tap(find.text('重试'));
      await tester.pumpAndSettle();

      expect(calls, 2);
      expect(find.text('暂无版本记录'), findsOneWidget);
    },
  );

  testWidgets('[MOB-REL-008][flutter] release notes follow English locale', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        home: ReleaseNotesPage(api: _releaseApi(), locale: const Locale('en')),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Release notes'), findsOneWidget);
    expect(find.text('Mobile experience update'), findsOneWidget);
    expect(
      find.text(
        'Realtime status and release notes are now available on mobile.',
      ),
      findsOneWidget,
    );
  });

  testWidgets(
    'release API locale distinguishes Chinese scripts and deduplicates equivalents',
    (tester) async {
      final requested = <String>[];
      final api = RelayApi(
        client: MockClient((request) async {
          requested.add(request.url.queryParameters['locale']!);
          return _jsonResponse({'releases': []});
        }),
      );
      for (final locale in const [
        Locale('zh'),
        Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hans'),
        Locale('zh', 'TW'),
        Locale('zh', 'HK'),
        Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant'),
      ]) {
        await tester.pumpWidget(
          MaterialApp(
            home: ReleaseNotesPage(api: api, locale: locale),
          ),
        );
        await tester.pumpAndSettle();
      }

      expect(requested, ['zh-CN', 'en']);
    },
  );

  testWidgets(
    'release content follows the returned locale while the shell keeps its locale',
    (tester) async {
      for (final fixture in const [
        (
          shell: Locale('ar'),
          contentLocale: 'en',
          shellDirection: TextDirection.rtl,
          contentDirection: TextDirection.ltr,
          title: 'English fallback',
        ),
        (
          shell: Locale('en'),
          contentLocale: 'ur',
          shellDirection: TextDirection.ltr,
          contentDirection: TextDirection.rtl,
          title: 'اردو اپ ڈیٹ',
        ),
      ]) {
        await tester.pumpWidget(
          MaterialApp(
            locale: fixture.shell,
            supportedLocales: relayuneSupportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            home: ReleaseNotesPage(
              api: _directionApi(fixture.contentLocale, fixture.title),
              locale: fixture.shell,
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(
          Directionality.of(tester.element(find.byType(ReleaseNotesPage))),
          fixture.shellDirection,
        );
        expect(
          tester
              .widget<Directionality>(
                find.byKey(const ValueKey('release-title-direction-1.0.0')),
              )
              .textDirection,
          fixture.contentDirection,
        );
        expect(
          tester
              .widget<Directionality>(
                find.byKey(const ValueKey('release-item-direction-1.0.0-0')),
              )
              .textDirection,
          fixture.contentDirection,
        );
      }
    },
  );
}

RelayApi _releaseApi() => RelayApi(
  client: MockClient((request) async {
    final english = request.url.queryParameters['locale'] == 'en';
    return _jsonResponse({
      'locale': english ? 'en' : 'zh-CN',
      'releases': [
        {
          'locale': english ? 'en' : 'zh-CN',
          'version': '0.3.0',
          'publishedAt': '2026-08-10T12:00:00.000Z',
          'title': english ? 'Mobile experience update' : '移动体验更新',
          'items': english
              ? [
                  'Realtime status and release notes are now available on mobile.',
                  'Narrow screen and large text support',
                ]
              : ['实时状态与版本记录现在可以在手机查看。', '适配窄屏和大字体'],
          'platforms': ['android', 'ios'],
        },
      ],
    });
  }),
);

RelayApi _directionApi(String locale, String title) => RelayApi(
  client: MockClient(
    (_) async => _jsonResponse({
      'releases': [
        {
          'locale': locale,
          'version': '1.0.0',
          'publishedAt': '2026-09-02T00:00:00.000Z',
          'title': title,
          'items': ['$title item'],
          'platforms': ['ios'],
        },
      ],
    }),
  ),
);

http.Response _jsonResponse(Map<String, dynamic> body) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);
