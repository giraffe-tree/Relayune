import {
  detectSupportedLocale,
  normalizeLocale,
  type SupportedLocale,
} from "./supported-locales";

export type AuthLocale = SupportedLocale;

const AUTH_LOCALE_STORAGE_KEY = "relayune.webLocale";

export function detectAuthLocale(
  languages: readonly string[],
  saved?: string | null,
): AuthLocale {
  return detectSupportedLocale(languages, saved);
}

export function readStoredAuthLocale(
  storage?: Pick<Storage, "getItem"> | null,
  cookieHeader?: string,
): AuthLocale | null {
  let saved: string | null | undefined;
  try {
    saved = (storage ?? localStorage)?.getItem(
      AUTH_LOCALE_STORAGE_KEY,
    );
  } catch {
    // A same-site cookie keeps locale continuity when localStorage is blocked.
  }
  const storedLocale = normalizeLocale(saved);
  if (storedLocale) return storedLocale;
  try {
    const value = (cookieHeader ?? document.cookie).match(
      /(?:^|;\s*)relayune_locale=([^;]+)(?:;|$)/,
    )?.[1];
    return normalizeLocale(value);
  } catch {
    return null;
  }
}
