import type { AppLocale } from "./i18n";

// Presentation only: never merge authorizations by a shared model or display name.
export function deviceIdentity(name: string) {
  const parts = name.split(/\s*·\s*/);
  const native = parts[0] === "Relayune" && parts.length >= 3 && /^(iOS|iPadOS|Android)\b/i.test(parts.at(-1)!);
  const title = native ? parts.slice(1, -1).join(" · ") : parts[0] || name;
  const subtitle = native ? parts.at(-1)! : parts.slice(1).join(" · ");
  const kind = /iPad|tablet/i.test(name) ? "tablet" : /iPhone|iOS|Android/i.test(name) ? "phone"
    : /Chrome|Safari|Firefox|Edge|Brave|Opera/i.test(name) ? "browser" : "computer";
  return { title, subtitle, kind };
}

export function deviceIcon(kind: string) {
  const paths = kind === "phone" ? '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10 5h4m-3 13.5h2"/>'
    : kind === "tablet" ? '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M11 18.5h2"/>'
    : kind === "browser" ? '<rect x="2.5" y="4" width="19" height="16" rx="3"/><path d="M3 9h18M6 6.5h.01m3 0h.01m3 0h.01"/>'
    : '<rect x="3" y="3.5" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4.5V21"/>';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export function deviceRelativeTime(value: string | null, locale: AppLocale, now = Date.now()) {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (minutes < 60) return relative.format(-minutes, "minute");
  if (minutes < 1440) return relative.format(-Math.floor(minutes / 60), "hour");
  if (minutes < 10080) return relative.format(-Math.floor(minutes / 1440), "day");
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric",
    ...(new Date(timestamp).getFullYear() !== new Date(now).getFullYear() ? {year: "numeric" as const} : {}) }).format(timestamp);
}
