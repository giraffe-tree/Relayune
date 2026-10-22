import type { AppLocale } from "./i18n";
import { appLocaleDirection, translate } from "./i18n";

export function formatTime(
  value: string | null,
  locale: AppLocale = "zh-CN",
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatDateTime(
  value: string | null,
  locale: AppLocale = "zh-CN",
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}


export function formatBrowserAuthorizationDetail(
  createdAt: string,
  lastSeenAt: string | null,
  locale: AppLocale = "zh-CN",
): string {
  const authorized = translate(locale, "authorizedAt", {
    time: formatDateTime(createdAt, locale),
  });
  return lastSeenAt
    ? `${authorized} · ${translate(locale, "lastUsed", {
        time: formatDateTime(lastSeenAt, locale),
      })}`
    : authorized;
}

export function formatPairingCountdown(
  expiresAtMs: number,
  nowMs = Date.now(),
  locale: AppLocale = "zh-CN",
): string {
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return "";
  const remainingSeconds = Math.max(
    0,
    Math.ceil((expiresAtMs - nowMs) / 1_000),
  );
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const minuteText = new Intl.NumberFormat(locale, {
    useGrouping: false,
  }).format(minutes);
  const secondText = new Intl.NumberFormat(locale, {
    minimumIntegerDigits: 2,
    useGrouping: false,
  }).format(seconds);
  const value = `${minuteText}:${secondText}`;
  return appLocaleDirection(locale) === "rtl" ? `\u2066${value}\u2069` : value;
}

export function pairingDeadlineExpired(
  expiresAtMs: number,
  nowMs = Date.now(),
): boolean {
  return Number.isFinite(expiresAtMs) && expiresAtMs > 0 && nowMs >= expiresAtMs;
}

export function shortPath(
  value: string,
  locale: AppLocale = "zh-CN",
): string {
  if (!value) return translate(locale, "noFolder");
  const separator = value.includes("\\") ? "\\" : "/";
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return value;
  return `…${separator}${parts.slice(-3).join(separator)}`;
}
