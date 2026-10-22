import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';
import 'package:relayune_mobile/src/ui/settings_page.dart';
import 'package:relayune_mobile/src/ui/theme.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets(
    'sidebar agents default to stable providers and persist beta selection',
    (tester) async {
      final store = _LanguageSecureStore();
      final controller = workbenchController(
        baseController: AppController(secureStore: store),
      );
      addTearDown(controller.dispose);
      await _pumpSettings(
        tester,
        controller: controller,
        locale: const Locale('zh', 'CN'),
        opened: [],
      );
      await _tapVisible(tester, 'settings-sidebar-agents');
      await tester.pumpAndSettle();
      expect(controller.visibleAgents, ['codex', 'claude', 'kimi']);
      expect(find.text('MiniMax Code · Beta'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('sidebar-agent-mcode')));
      await tester.pumpAndSettle();
      expect(controller.visibleAgents, contains('mcode'));
      expect(store.visibleAgents, controller.visibleAgents);
      expect(find.text('ZCode · Beta'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('sidebar-agent-zcode')));
      await tester.pumpAndSettle();
      expect(controller.visibleAgents, contains('zcode'));
      expect(store.visibleAgents, controller.visibleAgents);
      await tester.tap(find.byKey(const ValueKey('sidebar-agent-codex')));
      await tester.pumpAndSettle();
      expect(controller.visibleAgents, isNot(contains('codex')));
    },
  );

  testWidgets(
    'touch feedback can be disabled locally without playing a preview',
    (tester) async {
      final store = _LanguageSecureStore();
      final controller = workbenchController(
        baseController: AppController(secureStore: store),
      );
      addTearDown(controller.dispose);
      await _pumpSettings(
        tester,
        controller: controller,
        locale: const Locale('zh', 'CN'),
        opened: [],
      );
      await _tapVisible(tester, 'settings-haptics-switch');
      expect(controller.haptics.enabled, isFalse);
      expect(store.savedHaptics, [false]);
      expect(find.text('触觉反馈'), findsOneWidget);
    },
  );

  testWidgets(
    '[MOB-SET-001][flutter] Chinese settings open Chinese legal pages and support email',
    (tester) async {
      final opened = <Uri>[];
      final controller = workbenchController();
      addTearDown(controller.dispose);
      await _pumpSettings(
        tester,
        controller: controller,
        locale: const Locale('zh', 'CN'),
        opened: opened,
      );

      expect(find.text('设置'), findsOneWidget);
      await _ensureVisible(tester, 'settings-language-entry');

      await _tapVisible(tester, 'settings-support-entry');
      expect(find.text('客服与法律'), findsOneWidget);
      expect(find.text('服务条款'), findsOneWidget);
      expect(find.text('隐私政策'), findsOneWidget);
      await _tapVisible(tester, 'settings-terms-entry');
      await _tapVisible(tester, 'settings-privacy-entry');
      expect(find.text('简体中文'), findsNWidgets(2));

      await _tapVisible(tester, 'settings-community-entry');
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Relayune 用户内测群'), findsOneWidget);
      expect(opened, hasLength(3));
      await tester.pageBack();
      await tester.pumpAndSettle();

      expect(opened[0].scheme, 'mailto');
      expect(opened[0].path, 'giraffetree1@gmail.com');
      expect(
        opened[1].toString(),
        'https://relayune.giraffetree.cn/zh/legal/terms/',
      );
      expect(
        opened[2].toString(),
        'https://relayune.giraffetree.cn/zh/legal/privacy/',
      );
    },
  );

  testWidgets(
    '[MOB-SET-005][flutter] language picker switches immediately and offers system default',
    (tester) async {
      final store = _LanguageSecureStore();
      final controller = workbenchController(
        baseController: AppController(
          secureStore: store,
          locale: const Locale('en'),
        ),
      );
      addTearDown(controller.dispose);

      await tester.pumpWidget(
        ValueListenableBuilder<Locale>(
          valueListenable: controller.localeListenable,
          builder: (context, locale, _) => MaterialApp(
            locale: locale,
            supportedLocales: relayuneSupportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            theme: RelayTheme.web,
            home: SettingsPage(
              controller: controller,
              devicePageBuilder: (_) => const SizedBox.shrink(),
              openExternal: (_) async => true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await _tapVisible(tester, 'settings-language-entry');
      expect(
        find.byKey(const ValueKey('settings-language-system')),
        findsOneWidget,
      );
      expect(relayuneLanguageOptions, hasLength(10));

      final arabic = find.byKey(const ValueKey('settings-language-ar'));
      await tester.ensureVisible(arabic);
      await tester.pumpAndSettle();
      await tester.tap(arabic);
      await tester.pumpAndSettle();

      expect(controller.locale, const Locale('ar'));
      expect(controller.preferredLocaleTag, 'ar');
      expect(
        Directionality.of(tester.element(find.byType(SettingsPage))),
        TextDirection.rtl,
      );

      await _tapVisible(tester, 'settings-language-entry');
      final systemDefault = find.byKey(
        const ValueKey('settings-language-system'),
      );
      await tester.ensureVisible(systemDefault);
      await tester.pumpAndSettle();
      await tester.tap(systemDefault);
      await tester.pumpAndSettle();

      expect(controller.locale, const Locale('en'));
      expect(controller.usesSystemLocale, isTrue);
      expect(store.savedTags, ['ar', null]);
    },
  );

  testWidgets('[MOB-DEV-001][flutter] settings open device details', (
    tester,
  ) async {
    final controller = workbenchController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: RelayTheme.web,
        home: SettingsPage(
          controller: controller,
          locale: const Locale('zh', 'CN'),
          devicePageBuilder: (_) => const Scaffold(
            key: ValueKey('device-settings-route'),
            body: SizedBox.shrink(),
          ),
          openExternal: (_) async => true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('settings-device-entry')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('settings-device-entry')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('device-settings-route')), findsOneWidget);
  });

  testWidgets(
    '[MOB-SET-002][flutter] English settings open English legal pages',
    (tester) async {
      final opened = <Uri>[];
      final controller = workbenchController();
      addTearDown(controller.dispose);
      await _pumpSettings(
        tester,
        controller: controller,
        locale: const Locale('en'),
        opened: opened,
      );

      expect(find.text('Settings'), findsOneWidget);
      await _ensureVisible(tester, 'settings-language-entry');

      await _tapVisible(tester, 'settings-terms-entry');
      expect(find.text('Support & legal'), findsOneWidget);
      expect(find.text('Terms of Service'), findsOneWidget);
      expect(find.text('Privacy Policy'), findsOneWidget);
      await _tapVisible(tester, 'settings-privacy-entry');
      expect(find.text('English'), findsNWidgets(2));

      expect(
        opened[0].toString(),
        'https://relayune.giraffetree.cn/en/legal/terms/',
      );
      expect(
        opened[1].toString(),
        'https://relayune.giraffetree.cn/en/legal/privacy/',
      );
    },
  );

  testWidgets(
    '[MOB-SET-003][flutter] settings remain usable at 320px and 1.3 text scale',
    (tester) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = workbenchController();
      addTearDown(controller.dispose);

      await tester.pumpWidget(
        MaterialApp(
          theme: RelayTheme.web,
          home: MediaQuery(
            data: const MediaQueryData(
              size: Size(320, 700),
              textScaler: TextScaler.linear(1.3),
            ),
            child: SettingsPage(
              controller: controller,
              devicePageBuilder: (_) => const SizedBox.shrink(),
              locale: const Locale('zh', 'CN'),
              openExternal: (_) async => true,
            ),
          ),
        ),
      );

      await _ensureVisible(tester, 'settings-privacy-entry');
      expect(
        find.byKey(const ValueKey('settings-privacy-entry')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    testWidgets(
      '[MOB-SET-004][flutter] $platform account settings have no purchase controls',
      (tester) async {
        final controller = workbenchController();
        addTearDown(controller.dispose);
        await tester.pumpWidget(
          MaterialApp(
            theme: RelayTheme.web.copyWith(platform: platform),
            home: SettingsPage(
              controller: controller,
              devicePageBuilder: (_) => const SizedBox.shrink(),
              locale: const Locale('zh', 'CN'),
              openExternal: (_) async => true,
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('settings-account-summary')),
          findsOneWidget,
        );
        expect(find.text('owner@example.com'), findsOneWidget);
        expect(find.text('Relayune Pro'), findsNothing);
        expect(
          find.byKey(const ValueKey('settings-referral-entry')),
          findsNothing,
        );
        expect(
          find.byKey(const ValueKey('settings-redemption-entry')),
          findsNothing,
        );
        await _ensureVisible(tester, 'settings-logout-entry');
        expect(
          find.byKey(const ValueKey('settings-logout-entry')),
          findsOneWidget,
        );
      },
    );
  }
  testWidgets(
    '[MOB-SET-006][flutter] signed-in account summary stays on settings',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      await _pumpSettings(
        tester,
        controller: controller,
        locale: const Locale('zh', 'CN'),
        opened: [],
      );
      final account = find.byKey(const ValueKey('settings-account-summary'));
      expect(account, findsOneWidget);
      await tester.tap(account);
      await tester.pumpAndSettle();
      expect(find.byType(SettingsPage), findsOneWidget);
      expect(find.text('owner@example.com'), findsOneWidget);
      expect(find.text('Relayune Pro'), findsNothing);
    },
  );
}

class _LanguageSecureStore extends SecureStore {
  List<String> visibleAgents = [];
  @override
  Future<void> saveVisibleAgents(List<String> values) async {
    visibleAgents = [...values];
  }

  final List<String?> savedTags = [];
  final List<bool> savedHaptics = [];

  @override
  Future<void> saveHapticsEnabled(bool enabled) async {
    savedHaptics.add(enabled);
  }

  @override
  Future<void> savePreferredLocale(String? localeTag) async {
    savedTags.add(localeTag);
  }
}

Future<void> _pumpSettings(
  WidgetTester tester, {
  required AppController controller,
  required Locale locale,
  required List<Uri> opened,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: RelayTheme.web,
      home: SettingsPage(
        controller: controller,
        devicePageBuilder: (_) => const SizedBox.shrink(),
        locale: locale,
        openExternal: (uri) async {
          opened.add(uri);
          return true;
        },
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tapVisible(WidgetTester tester, String key) async {
  await _ensureVisible(tester, key);
  final finder = find.byKey(ValueKey(key));
  await tester.tap(finder);
  await tester.pump();
}

Future<void> _ensureVisible(
  WidgetTester tester,
  String key, {
  double delta = 180,
}) async {
  final finder = find.byKey(ValueKey(key));
  if (finder.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      finder,
      delta,
      scrollable: find.byType(Scrollable).first,
    );
  } else {
    await tester.ensureVisible(finder);
  }
  await tester.pumpAndSettle();
}
