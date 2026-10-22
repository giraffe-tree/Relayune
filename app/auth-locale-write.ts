import type { AuthLocale } from "./auth-locale";

type CookieTarget = { cookie: string };

export function storeAuthLocale(
  locale: AuthLocale,
  storage?: Pick<Storage, "setItem"> | null,
  cookieTarget?: CookieTarget | null,
): void {
  try {
    const target = storage ?? globalThis.localStorage;
    target?.setItem("relayune.webLocale", locale);
  } catch {
    // Continue to the same-site cookie fallback below.
  }
  try {
    const target = cookieTarget ?? globalThis.document;
    if (!target) return;
    target.cookie = `relayune_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${globalThis.location?.protocol === "https:" ? "; Secure" : ""}`;
  } catch {
    // Language switching still works in memory when persistence is unavailable.
  }
}
