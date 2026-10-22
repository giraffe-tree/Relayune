import type { DesktopPlatform } from "./types";

export function desktopDeviceName(
  platform: DesktopPlatform | null | undefined,
  fallbackName: string,
) {
  if (platform?.os !== "macos") return fallbackName;
  const version = normalizedMajorMinorVersion(platform.os_version);
  return version ? `${fallbackName} · macOS ${version}` : fallbackName;
}

function normalizedMajorMinorVersion(value: string | null | undefined) {
  const match = /^(\d+)(?:\.(\d+))?/.exec(value?.trim() ?? "");
  if (!match) return "";
  return match[2] ? `${match[1]}.${match[2]}` : match[1];
}
