import 'package:flutter/widgets.dart';

import '../generated/l10n/app_localizations.dart';

export '../generated/l10n/app_localizations.dart';

const relayuneSupportedLocales = <Locale>[
  Locale('en'),
  Locale('zh', 'CN'),
  Locale('hi'),
  Locale('es'),
  Locale('ar'),
  Locale('fr'),
  Locale('bn'),
  Locale('pt'),
  Locale('id'),
  Locale('ur'),
];

class RelayuneLanguageOption {
  const RelayuneLanguageOption({
    required this.tag,
    required this.locale,
    required this.nativeName,
  });

  final String tag;
  final Locale locale;
  final String nativeName;
}

const relayuneLanguageOptions = <RelayuneLanguageOption>[
  RelayuneLanguageOption(
    tag: 'en',
    locale: Locale('en'),
    nativeName: 'English',
  ),
  RelayuneLanguageOption(
    tag: 'zh-CN',
    locale: Locale('zh', 'CN'),
    nativeName: '简体中文',
  ),
  RelayuneLanguageOption(tag: 'hi', locale: Locale('hi'), nativeName: 'हिन्दी'),
  RelayuneLanguageOption(
    tag: 'es',
    locale: Locale('es'),
    nativeName: 'Español',
  ),
  RelayuneLanguageOption(
    tag: 'ar',
    locale: Locale('ar'),
    nativeName: 'العربية',
  ),
  RelayuneLanguageOption(
    tag: 'fr',
    locale: Locale('fr'),
    nativeName: 'Français',
  ),
  RelayuneLanguageOption(tag: 'bn', locale: Locale('bn'), nativeName: 'বাংলা'),
  RelayuneLanguageOption(
    tag: 'pt',
    locale: Locale('pt'),
    nativeName: 'Português',
  ),
  RelayuneLanguageOption(
    tag: 'id',
    locale: Locale('id'),
    nativeName: 'Bahasa Indonesia',
  ),
  RelayuneLanguageOption(tag: 'ur', locale: Locale('ur'), nativeName: 'اردو'),
];

Locale? relayuneLocaleForTag(String? tag) {
  final normalized = tag?.trim().replaceAll('_', '-').toLowerCase();
  if (normalized == null || normalized.isEmpty) return null;
  for (final option in relayuneLanguageOptions) {
    if (option.tag.toLowerCase() == normalized) return option.locale;
  }
  return null;
}

String relayuneLocaleTag(Locale locale) => relayuneLanguageOptions
    .firstWhere(
      (option) => option.locale == relayuneResolveLocale([locale]),
      orElse: () => relayuneLanguageOptions.first,
    )
    .tag;

String relayuneNativeLanguageName(Locale locale) => relayuneLanguageOptions
    .firstWhere(
      (option) => option.locale == relayuneResolveLocale([locale]),
      orElse: () => relayuneLanguageOptions.first,
    )
    .nativeName;

Locale relayuneResolveLocale(
  Iterable<Locale> preferredLocales, [
  Iterable<Locale> supportedLocales = relayuneSupportedLocales,
]) {
  final supported = supportedLocales.toList(growable: false);
  for (final preferred in preferredLocales) {
    if (preferred.languageCode == 'zh') {
      final script = preferred.scriptCode?.toLowerCase();
      final country = preferred.countryCode?.toUpperCase();
      final simplified =
          script == 'hans' ||
          (script == null && (country == null || country == 'CN'));
      if (simplified) return const Locale('zh', 'CN');
      continue;
    }
    for (final candidate in supported) {
      if (candidate.languageCode == preferred.languageCode) return candidate;
    }
  }
  return const Locale('en');
}

Locale relayuneLocaleListResolution(
  List<Locale>? locales,
  Iterable<Locale> supportedLocales,
) => relayuneResolveLocale(locales ?? const [], supportedLocales);

AppLocalizations relayuneLocalizationsFor(Locale locale) =>
    lookupAppLocalizations(
      relayuneResolveLocale([locale], relayuneSupportedLocales),
    );

extension RelayuneLocalizationsContext on BuildContext {
  AppLocalizations get l10n =>
      Localizations.of<AppLocalizations>(this, AppLocalizations) ??
      relayuneLocalizationsFor(const Locale('zh', 'CN'));
}
