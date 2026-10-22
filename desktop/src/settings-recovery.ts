import type { DesktopErrorCode } from "./api";

export type SettingsRecoveryField = "launch-at-login";

export function settingsRecoveryField(
  code: DesktopErrorCode,
): SettingsRecoveryField | null {
  if (code === "autostart_failed") return "launch-at-login";
  return null;
}
