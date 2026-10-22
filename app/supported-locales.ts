export const SUPPORTED_LOCALES = [
  "en",
  "zh-CN",
  "hi",
  "es",
  "ar",
  "fr",
  "bn",
  "pt",
  "id",
  "ur",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type TextDirection = "ltr" | "rtl";

export type LocaleDefinition = {
  locale: SupportedLocale;
  path: string;
  nativeName: string;
  englishName: string;
  dir: TextDirection;
};

export const DEFAULT_LOCALE: SupportedLocale = "en";
export const DEFAULT_MARKETING_LOCALE: SupportedLocale = "zh-CN";

export const LANGUAGE_PICKER_LABELS: Readonly<Record<SupportedLocale, string>> =
  Object.freeze({
    en: "Choose language",
    "zh-CN": "选择语言",
    hi: "भाषा चुनें",
    es: "Elegir idioma",
    ar: "اختيار اللغة",
    fr: "Choisir la langue",
    bn: "ভাষা বেছে নিন",
    pt: "Escolher idioma",
    id: "Pilih bahasa",
    ur: "زبان منتخب کریں",
  });

export const LOCALE_DEFINITIONS: Readonly<
  Record<SupportedLocale, LocaleDefinition>
> = Object.freeze({
  en: { locale: "en", path: "en", nativeName: "English", englishName: "English", dir: "ltr" },
  "zh-CN": { locale: "zh-CN", path: "zh", nativeName: "简体中文", englishName: "Simplified Chinese", dir: "ltr" },
  hi: { locale: "hi", path: "hi", nativeName: "हिन्दी", englishName: "Hindi", dir: "ltr" },
  es: { locale: "es", path: "es", nativeName: "Español", englishName: "Spanish", dir: "ltr" },
  ar: { locale: "ar", path: "ar", nativeName: "العربية", englishName: "Arabic", dir: "rtl" },
  fr: { locale: "fr", path: "fr", nativeName: "Français", englishName: "French", dir: "ltr" },
  bn: { locale: "bn", path: "bn", nativeName: "বাংলা", englishName: "Bengali", dir: "ltr" },
  pt: { locale: "pt", path: "pt", nativeName: "Português", englishName: "Portuguese", dir: "ltr" },
  id: { locale: "id", path: "id", nativeName: "Bahasa Indonesia", englishName: "Indonesian", dir: "ltr" },
  ur: { locale: "ur", path: "ur", nativeName: "اردو", englishName: "Urdu", dir: "rtl" },
});

const localeAliases: Readonly<Record<string, SupportedLocale>> = Object.freeze({
  en: "en",
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-hans-cn": "zh-CN",
  hi: "hi",
  es: "es",
  ar: "ar",
  fr: "fr",
  bn: "bn",
  pt: "pt",
  "pt-br": "pt",
  "pt-pt": "pt",
  id: "id",
  in: "id",
  ur: "ur",
});

export function normalizeLocale(value: unknown): SupportedLocale | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  if (!normalized) return null;
  if (
    normalized === "zh" ||
    normalized === "zh-cn" ||
    normalized === "zh-hans" ||
    normalized.startsWith("zh-hans-")
  ) {
    return "zh-CN";
  }
  if (normalized.startsWith("zh-")) return null;
  const exact = localeAliases[normalized];
  if (exact) return exact;
  return localeAliases[normalized.split("-", 1)[0]] ?? null;
}

export function detectSupportedLocale(
  languages: readonly string[],
  saved?: string | null,
): SupportedLocale {
  const stored = normalizeLocale(saved);
  if (stored) return stored;
  for (const language of languages) {
    const detected = normalizeLocale(language);
    if (detected) return detected;
  }
  return DEFAULT_LOCALE;
}

export function localeDirection(locale: SupportedLocale): TextDirection {
  return LOCALE_DEFINITIONS[locale].dir;
}

export function localePath(locale: SupportedLocale, suffix = ""): string {
  const base = `/${LOCALE_DEFINITIONS[locale].path}/`;
  const cleanSuffix = suffix.replace(/^\/+|\/+$/g, "");
  return cleanSuffix ? `${base}${cleanSuffix}/` : base;
}

export function publicDocumentLocale(locale: SupportedLocale): "zh-CN" | "en" {
  return locale === "zh-CN" ? "zh-CN" : "en";
}

export function publicDocumentPath(
  locale: SupportedLocale,
  suffix: "changelog" | "legal/terms" | "legal/privacy",
): string {
  return localePath(locale, suffix);
}

export function localeFromPathSegment(value: string): SupportedLocale | null {
  const entry = Object.values(LOCALE_DEFINITIONS).find(
    (candidate) => candidate.path === value.toLowerCase(),
  );
  return entry?.locale ?? null;
}

export function applyDocumentLocale(locale: SupportedLocale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDirection(locale);
}
