import { describe, expect, it } from "vitest";
import {
  formatBrowserAuthorizationDetail,
  formatDateTime,
  formatPairingCountdown,
  formatTime,
  pairingDeadlineExpired,
  shortPath,
} from "./format";

describe("desktop formatting helpers", () => {
  it("shortens long paths without losing the selected directory", () => {
    expect(shortPath("/Users/example/Projects/client/repository")).toBe(
      "…/Projects/client/repository",
    );
  });

  it("shortens Windows paths without changing their separator", () => {
    expect(shortPath("C:\\Users\\chen\\Projects\\relayune", "en")).toBe(
      "…\\chen\\Projects\\relayune",
    );
    expect(shortPath("", "en")).toBe("Not selected");
  });

  it("renders missing timestamps safely", () => {
    expect(formatTime(null)).toBe("—");
    expect(formatTime("not-a-date")).toBe("—");
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
  });

  it("keeps authorization time separate from recent activity", () => {
    const createdAt = "2026-07-31T08:06:40.000Z";
    const lastSeenAt = "2026-07-31T09:53:14.000Z";
    const detail = formatBrowserAuthorizationDetail(createdAt, lastSeenAt);

    expect(detail).toContain(`授权于 ${formatDateTime(createdAt)}`);
    expect(detail).toContain(`最近使用 ${formatDateTime(lastSeenAt)}`);
    expect(formatBrowserAuthorizationDetail(createdAt, null)).toBe(
      `授权于 ${formatDateTime(createdAt)}`,
    );
  });

  it("formats authorization activity in English", () => {
    const detail = formatBrowserAuthorizationDetail(
      "2026-07-31T08:06:40.000Z",
      "2026-07-31T09:53:14.000Z",
      "en",
    );
    expect(detail).toContain("Authorized");
    expect(detail).toContain("last used");
  });

  it("delegates date order and clock convention to the active locale", () => {
    const value = "2026-07-31T08:06:40.000Z";
    for (const locale of ["en", "fr", "ar", "hi"] as const) {
      expect(formatDateTime(value, locale)).toBe(
        new Intl.DateTimeFormat(locale, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(value)),
      );
    }
  });


  it("shows a stable local countdown without rounding a valid code down early", () => {
    expect(formatPairingCountdown(700_000, 100_001)).toBe("10:00");
    expect(formatPairingCountdown(700_000, 640_001)).toBe("1:00");
    expect(formatPairingCountdown(700_000, 699_999)).toBe("0:01");
    expect(formatPairingCountdown(700_000, 700_000)).toBe("0:00");
    expect(formatPairingCountdown(0, 100_000)).toBe("");
  });

  it("isolates countdown tokens in RTL copy while leaving LTR copy unwrapped", () => {
    expect(formatPairingCountdown(700_000, 640_001, "en")).toBe("1:00");
    const arabic = formatPairingCountdown(700_000, 640_001, "ar");
    expect(arabic.startsWith("\u2066")).toBe(true);
    expect(arabic.endsWith("\u2069")).toBe(true);
    expect(arabic.slice(1, -1)).toMatch(/^.+:.{2}$/u);
    expect(formatPairingCountdown(700_000, 640_001, "ur")).toMatch(
      /^\u2066.+\u2069$/u,
    );
  });

  it("expires a pairing exactly at its server-owned deadline", () => {
    expect(pairingDeadlineExpired(700_000, 699_999)).toBe(false);
    expect(pairingDeadlineExpired(700_000, 700_000)).toBe(true);
    expect(pairingDeadlineExpired(700_000, 700_001)).toBe(true);
    expect(pairingDeadlineExpired(0, 700_001)).toBe(false);
    expect(pairingDeadlineExpired(Number.NaN, 700_001)).toBe(false);
  });
});
