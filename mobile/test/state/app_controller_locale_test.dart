import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';

void main() {
  test(
    'system default follows supported system locales and falls back to English',
    () async {
      final store = _LocaleStore();
      final controller = AppController(
        secureStore: store,
        locale: const Locale('fr'),
      );
      addTearDown(controller.dispose);

      expect(controller.usesSystemLocale, isTrue);
      expect(controller.locale, const Locale('fr'));

      controller.updateSystemLocales(const [Locale('de')]);
      expect(controller.systemLocale, const Locale('en'));
      expect(controller.locale, const Locale('en'));

      expect(await controller.setPreferredLocale('ar'), isTrue);
      expect(controller.locale, const Locale('ar'));
      expect(controller.preferredLocaleTag, 'ar');

      controller.updateSystemLocales(const [Locale('es')]);
      expect(controller.systemLocale, const Locale('es'));
      expect(controller.locale, const Locale('ar'));

      expect(await controller.setPreferredLocale(null), isTrue);
      expect(controller.usesSystemLocale, isTrue);
      expect(controller.locale, const Locale('es'));
      expect(store.savedTags, ['ar', null]);
    },
  );

  test(
    'initialize restores a valid saved language and ignores an invalid one',
    () async {
      final savedStore = _LocaleStore(
        const StoredCredentials(preferredLocale: 'ur'),
      );
      final savedController = AppController(
        secureStore: savedStore,
        locale: const Locale('fr'),
      );
      addTearDown(savedController.dispose);
      await savedController.initialize();

      expect(savedController.locale, const Locale('ur'));
      expect(savedController.preferredLocaleTag, 'ur');

      final invalidController = AppController(
        secureStore: _LocaleStore(
          const StoredCredentials(preferredLocale: 'unsupported'),
        ),
        locale: const Locale('bn'),
      );
      addTearDown(invalidController.dispose);
      await invalidController.initialize();

      expect(invalidController.locale, const Locale('bn'));
      expect(invalidController.usesSystemLocale, isTrue);
    },
  );
}

class _LocaleStore extends SecureStore {
  _LocaleStore([this.credentials = const StoredCredentials()]);

  final StoredCredentials credentials;
  final List<String?> savedTags = [];

  @override
  Future<StoredCredentials> read() async => credentials;

  @override
  Future<void> savePreferredLocale(String? localeTag) async {
    savedTags.add(localeTag);
  }
}
