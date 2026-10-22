import type { SupportedLocale } from "./supported-locales";

function unit(value: number, name: "hour" | "minute" | "second", locale: SupportedLocale) {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: name,
    unitDisplay: "narrow",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDurationSeconds(seconds: number, locale: SupportedLocale): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  if (safeSeconds < 60) return unit(safeSeconds, "second", locale);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  if (minutes < 60) {
    return remainder
      ? `${unit(minutes, "minute", locale)} ${unit(remainder, "second", locale)}`
      : unit(minutes, "minute", locale);
  }
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder
    ? `${unit(hours, "hour", locale)} ${unit(minuteRemainder, "minute", locale)}`
    : unit(hours, "hour", locale);
}

export function formatCompactNumber(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
