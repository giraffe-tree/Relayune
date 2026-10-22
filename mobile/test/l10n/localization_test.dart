import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';

void main() {
  const targetTags = <String>{
    'en',
    'zh-CN',
    'hi',
    'es',
    'ar',
    'fr',
    'bn',
    'pt',
    'id',
    'ur',
  };

  test('Flutter advertises exactly the ten target locales', () {
    expect(
      relayuneSupportedLocales.map((locale) => locale.toLanguageTag()).toSet(),
      targetTags,
    );
    expect(
      relayuneResolveLocale(const [Locale('zh')]),
      const Locale('zh', 'CN'),
    );
    expect(
      relayuneResolveLocale(const [Locale('zh', 'CN')]),
      const Locale('zh', 'CN'),
    );
    expect(
      relayuneResolveLocale(const [
        Locale.fromSubtags(
          languageCode: 'zh',
          scriptCode: 'Hans',
          countryCode: 'SG',
        ),
      ]),
      const Locale('zh', 'CN'),
    );
    for (final locale in const [
      Locale('zh', 'TW'),
      Locale('zh', 'HK'),
      Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant'),
    ]) {
      expect(relayuneResolveLocale([locale]), const Locale('en'));
    }
    expect(
      relayuneResolveLocale(const [Locale('de'), Locale('fr', 'CA')]),
      const Locale('fr'),
    );
    expect(
      relayuneResolveLocale(const [Locale('zh', 'TW'), Locale('es')]),
      const Locale('es'),
    );
    expect(relayuneResolveLocale(const [Locale('de')]), const Locale('en'));
    expect(relayuneResolveLocale(const []), const Locale('en'));
  });

  test('stored locale tags map only to supported language choices', () {
    expect(relayuneLocaleForTag('zh_CN'), const Locale('zh', 'CN'));
    expect(relayuneLocaleForTag('AR'), const Locale('ar'));
    expect(relayuneLocaleForTag('de'), isNull);
    expect(relayuneLocaleForTag(null), isNull);
    expect(relayuneLocaleTag(const Locale('fr', 'CA')), 'fr');
    expect(relayuneNativeLanguageName(const Locale('ur')), 'اردو');
  });

  test('all target ARBs have the same keys and placeholder sets', () {
    final files = <String, File>{
      'en': File('lib/l10n/app_en.arb'),
      'zh-CN': File('lib/l10n/app_zh_CN.arb'),
      for (final tag in targetTags.difference(const {'en', 'zh-CN'}))
        tag: File('lib/l10n/app_$tag.arb'),
    };
    final catalogs = files.map(
      (tag, file) => MapEntry(
        tag,
        (jsonDecode(file.readAsStringSync()) as Map<String, dynamic>).map(
          (key, value) => MapEntry(key, value as Object),
        ),
      ),
    );
    final baseKeys = _messageKeys(catalogs['en']!);

    for (final entry in catalogs.entries) {
      expect(
        _messageKeys(entry.value),
        baseKeys,
        reason:
            '${entry.key} must neither omit keys nor rely on English fallback',
      );
      for (final key in baseKeys) {
        final translatedValue = entry.value[key];
        expect(translatedValue, isA<String>(), reason: '${entry.key}:$key');
        final translated = translatedValue! as String;
        expect(
          translated.trim(),
          isNotEmpty,
          reason: '${entry.key}:$key must not be empty',
        );
        expect(
          _placeholders(translated),
          _placeholders(catalogs['en']![key]! as String),
          reason: '${entry.key}:$key placeholders differ from the template',
        );
      }
    }
  });

  test(
    'history progress distinguishes confirmed stages and measured byte scopes',
    () {
      final english = relayuneLocalizationsFor(const Locale('en'));
      final chinese = relayuneLocalizationsFor(const Locale('zh', 'CN'));

      expect(english.workbenchHistoryRequestSending, 'Sending request');
      expect(
        english.workbenchHistoryWaitingComputer,
        'Waiting for your computer',
      );
      expect(
        english.workbenchHistoryReadingComputer,
        'Reading history on your computer',
      );
      expect(english.workbenchHistoryPreparing, 'Preparing messages');
      expect(english.workbenchHistoryElapsed(7), '7s elapsed');
      expect(english.workbenchHistoryTransferring, 'Transferring history');
      expect(
        english.workbenchHistorySourceRead('32 MB', '212 MB'),
        'Computer read 32 MB / 212 MB',
      );
      expect(
        english.workbenchHistoryPendingTransfer('310 KB'),
        'Page awaiting transfer: 310 KB',
      );
      expect(english.workbenchHistoryReceived('120 KB'), 'Received 120 KB');
      expect(
        english.workbenchHistoryPendingReceive('190 KB'),
        'Awaiting reception: 190 KB',
      );
      expect(chinese.workbenchHistoryRequestSending, '正在发送读取请求');
      expect(chinese.workbenchHistoryWaitingComputer, '等待电脑回应');
      expect(chinese.workbenchHistoryReadingComputer, '电脑正在读取历史消息');
      expect(chinese.workbenchHistoryPreparing, '正在整理消息');
      expect(chinese.workbenchHistoryElapsed(7), '已用时 7 秒');
      expect(chinese.workbenchHistoryTransferring, '正在传输历史消息');
      expect(
        chinese.workbenchHistorySourceRead('32 MB', '212 MB'),
        '电脑已读取 32 MB / 212 MB',
      );
      expect(chinese.workbenchHistoryPendingTransfer('310 KB'), '本页待传输 310 KB');
      expect(chinese.workbenchHistoryReceived('120 KB'), '已接收 120 KB');
      expect(chinese.workbenchHistoryPendingReceive('190 KB'), '待接收 190 KB');
    },
  );

  test(
    'generated history progress uses each locale and substitutes integer seconds',
    () {
      for (final locale in relayuneSupportedLocales) {
        final tag = relayuneLocaleTag(locale).replaceAll('-', '_');
        final catalog =
            jsonDecode(File('lib/l10n/app_$tag.arb').readAsStringSync())
                as Map<String, dynamic>;
        final copy = relayuneLocalizationsFor(locale);
        final progress = <String, String>{
          'workbenchHistoryRequestSending': copy.workbenchHistoryRequestSending,
          'workbenchHistoryWaitingComputer':
              copy.workbenchHistoryWaitingComputer,
          'workbenchHistoryReadingComputer':
              copy.workbenchHistoryReadingComputer,
          'workbenchHistoryPreparing': copy.workbenchHistoryPreparing,
          'workbenchHistoryElapsed': copy.workbenchHistoryElapsed(7),
          'workbenchHistoryTransferring': copy.workbenchHistoryTransferring,
          'workbenchHistoryReadingCache': copy.workbenchHistoryReadingCache,
          'workbenchHistorySourceRead': copy.workbenchHistorySourceRead(
            '7 KB',
            '9 MB',
          ),
          'workbenchHistoryPendingTransfer': copy
              .workbenchHistoryPendingTransfer('7 KB'),
          'workbenchHistoryReceived': copy.workbenchHistoryReceived('7 KB'),
          'workbenchHistoryPendingReceive': copy.workbenchHistoryPendingReceive(
            '7 KB',
          ),
        };
        for (final entry in progress.entries) {
          expect(
            entry.value,
            (catalog[entry.key] as String)
                .replaceAll('{seconds}', '7')
                .replaceAll('{read}', '7 KB')
                .replaceAll('{total}', '9 MB')
                .replaceAll('{size}', '7 KB'),
            reason:
                '$tag:${entry.key} must use its translated generated message',
          );
          expect(entry.value, isNot(contains('{seconds}')));
        }
        expect(
          progress.values.toSet(),
          hasLength(progress.length),
          reason: '$tag must distinguish phases, elapsed time and byte scopes',
        );
      }
    },
  );

  testWidgets('Arabic and Urdu build with right-to-left directionality', (
    tester,
  ) async {
    for (final locale in const [Locale('ar'), Locale('ur')]) {
      late TextDirection direction;
      await tester.pumpWidget(
        MaterialApp(
          locale: locale,
          supportedLocales: relayuneSupportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: Builder(
            builder: (context) {
              direction = Directionality.of(context);
              return Text(context.l10n.workbenchHighRiskTitle);
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(direction, TextDirection.rtl, reason: locale.toLanguageTag());
      expect(
        find.text(relayuneLocalizationsFor(locale).workbenchHighRiskTitle),
        findsOneWidget,
      );
    }
  });

  test(
    'native locale declarations and iOS permission catalogs stay aligned',
    () {
      final androidConfig = File(
        'android/app/src/main/res/xml/locales_config.xml',
      ).readAsStringSync();
      final manifest = File(
        'android/app/src/main/AndroidManifest.xml',
      ).readAsStringSync();
      for (final tag in targetTags) {
        expect(androidConfig, contains('android:name="$tag"'));
      }
      expect(manifest, contains('android:localeConfig="@xml/locales_config"'));
      expect(manifest, contains('android:supportsRtl="true"'));

      const iosDirectories = <String>{
        'en',
        'zh-Hans',
        'hi',
        'es',
        'ar',
        'fr',
        'bn',
        'pt',
        'id',
        'ur',
      };
      for (final locale in iosDirectories) {
        final contents = File(
          'ios/Runner/$locale.lproj/InfoPlist.strings',
        ).readAsStringSync();
        expect(contents, contains('"NSCameraUsageDescription"'));
        expect(contents, contains('"NSPhotoLibraryUsageDescription"'));
      }
    },
  );
}

Set<String> _messageKeys(Map<String, Object> catalog) =>
    catalog.keys.where((key) => !key.startsWith('@')).toSet();

Set<String> _placeholders(String message) => RegExp(
  r'\{([A-Za-z][A-Za-z0-9_]*)',
).allMatches(message).map((match) => match.group(1)!).toSet();
