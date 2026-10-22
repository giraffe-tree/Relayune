import androidUpdateManifest from "../public/updates/android.json";
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "./supported-locales";

export const RELAYUNE_IOS_TESTFLIGHT_URL = "https://testflight.apple.com/join/1smeJNXD";

export const RELAYUNE_RELEASE_VERSION = "0.3.33";
export const RELAYUNE_MACOS_RELEASE_VERSION = "0.3.33";
export const RELAYUNE_WEB_RELEASE_VERSION = "0.3.33";

function parseAndroidReleaseNotes(source: string) {
  const [title = "", ...items] = source
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    title,
    items: items.map((item) => item.replace(/^-\s*/, "")),
  } as const;
}

export const RELAYUNE_ANDROID_RELEASE = {
  version: androidUpdateManifest.version_name,
  notes: Object.freeze(
    Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [
        locale,
        parseAndroidReleaseNotes(
          androidUpdateManifest.notes[locale] ?? androidUpdateManifest.notes.en,
        ),
      ]),
    ) as Record<SupportedLocale, ReturnType<typeof parseAndroidReleaseNotes>>,
  ),
} as const;

export function androidReleaseNotes(locale: SupportedLocale) {
  return RELAYUNE_ANDROID_RELEASE.notes[locale] ?? RELAYUNE_ANDROID_RELEASE.notes.en;
}

function releaseAsset(version: string, fileName: string) {
  return {
    fileName,
    url: `https://open-chen.oss-cn-hangzhou.aliyuncs.com/apps/relayune/${version}/${fileName}`,
  } as const;
}

export const RELAYUNE_RELEASE_ASSETS = {
  macos: releaseAsset(
    RELAYUNE_MACOS_RELEASE_VERSION,
    `Relayune-${RELAYUNE_MACOS_RELEASE_VERSION}-macOS-universal.dmg`,
  ),
  android: releaseAsset(
    RELAYUNE_RELEASE_VERSION,
    `Relayune-${RELAYUNE_RELEASE_VERSION}-Android.apk`,
  ),
} as const;

// Metadata belongs to the downloadable artifacts, never to the website build.
// Detailed release acceptance evidence is retained outside the public source tree.
export const RELAYUNE_PLATFORM_BUILDS = {
  macos: { version: "0.3.33", builtAt: "2026-10-22T13:11:39.395Z" },
  android: { version: "0.3.33", build: 43, builtAt: "2026-10-22T12:34:04.906Z" },
  ios: { version: "0.3.33", build: 43, builtAt: "2026-10-22T12:53:35.812Z" },
} as const;

export const RELEASE_BUILD_LABELS: Record<SupportedLocale, string> = {
  "zh-CN": "构建时间", en: "Build time", hi: "बिल्ड समय", es: "Fecha de compilación",
  ar: "وقت البناء", fr: "Date de compilation", bn: "বিল্ডের সময়", pt: "Data da compilação",
  id: "Waktu build", ur: "بلڈ کا وقت",
};
