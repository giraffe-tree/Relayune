import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/font_size.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';
import 'package:relayune_mobile/src/ui/font_size_scope.dart';
import 'package:relayune_mobile/src/ui/settings_page.dart';
import 'package:relayune_mobile/src/ui/theme.dart';

void main() {
  test('font size defaults to small and restores saved choices', () async {
    for (final stored in [null, 'invalid', 'small', 'medium', 'large']) {
      final store = _FontStore()..saved = stored;
      final controller = AppController(secureStore: store);
      expect(controller.fontSize, RelayFontSize.small);
      await controller.initialize();
      expect(controller.fontSize, RelayFontSize.fromStored(stored));
      expect(await controller.setFontSize(RelayFontSize.large), isTrue);
      controller.dispose();
      final restored = AppController(secureStore: store);
      await restored.initialize();
      expect(restored.fontSize, RelayFontSize.large);
      restored.dispose();
    }
  });

  testWidgets('font picker updates all routes and preserves system scaling', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final store = _FontStore();
    final controller = AppController(secureStore: store);
    addTearDown(controller.dispose);
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
          child: FontSizeScope(
            fontSize: controller.fontSizeListenable,
            child: child!,
          ),
        ),
        home: SettingsPage(
          controller: controller,
          devicePageBuilder: (_) => const Scaffold(body: Text('Device page')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    double scaledSize(Finder finder) =>
        MediaQuery.textScalerOf(tester.element(finder)).scale(16);
    expect(
      scaledSize(find.byType(SettingsPage)),
      closeTo(16 * 1.3 * .85, .001),
    );

    for (final size in [
      RelayFontSize.large,
      RelayFontSize.medium,
      RelayFontSize.small,
    ]) {
      final entry = find.byKey(const ValueKey('settings-font-size-entry'));
      await tester.ensureVisible(entry);
      await tester.tap(entry);
      await tester.pumpAndSettle();
      for (final choice in RelayFontSize.values) {
        expect(
          find.byKey(ValueKey('settings-font-size-${choice.name}')),
          findsOneWidget,
        );
      }
      final selected = tester.widget<ListTile>(
        find.byKey(ValueKey('settings-font-size-${controller.fontSize.name}')),
      );
      expect(selected.selected, isTrue);
      await tester.tap(find.byKey(ValueKey('settings-font-size-${size.name}')));
      await tester.pumpAndSettle();
      expect(controller.fontSize, size);
      expect(store.saved, size.name);
      expect(
        scaledSize(find.byType(SettingsPage)),
        closeTo(16 * 1.3 * size.scale, .001),
      );
      expect(tester.takeException(), isNull);
    }

    await controller.setFontSize(RelayFontSize.large);
    await tester.pumpAndSettle();
    final device = find.byKey(const ValueKey('settings-device-entry'));
    await tester.ensureVisible(device);
    await tester.pumpAndSettle();
    await tester.tap(device);
    await tester.pumpAndSettle();
    expect(scaledSize(find.text('Device page')), closeTo(16 * 1.3, .001));
  });
}

class _FontStore extends SecureStore {
  String? saved;

  @override
  Future<StoredCredentials> read() async => StoredCredentials(fontSize: saved);

  @override
  Future<void> saveFontSize(String size) async {
    saved = size;
  }
}
