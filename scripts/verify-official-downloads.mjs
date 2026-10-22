// Explicit official-site validation. No downloads, uploads or release actions.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseMobileVersion,
  validateAndroidUpdateManifest,
  assertPublishedAndroidSourceCompatibility,
} from "./prepare-android-update-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticDir = path.join(root, "out");

const [
  desktopConfig,
  updateManifest,
  androidUpdateManifest,
  mobilePubspec,
  indexHtml,
  englishIndexHtml,
] =
  await Promise.all([
    readJson(path.join(root, "desktop", "src-tauri", "tauri.conf.json")),
    readJson(path.join(staticDir, "updates", "latest.json")),
    readJson(path.join(staticDir, "updates", "android.json")),
    readFile(path.join(root, "mobile", "pubspec.yaml"), "utf8"),
    readFile(path.join(staticDir, "index.html"), "utf8"),
    readFile(path.join(staticDir, "en", "index.html"), "utf8"),
  ]);

const version = desktopConfig.version;
const mobileVersion = parseMobileVersion(mobilePubspec);
validateAndroidUpdateManifest(androidUpdateManifest);
assertPublishedAndroidSourceCompatibility(androidUpdateManifest, mobileVersion);
const expectedAssets = [
  `Relayune-${updateManifest.version}-macOS-universal.dmg`,
  `Relayune-${androidUpdateManifest.version_name}-Android.apk`,
];
for (const asset of expectedAssets) {
  if (!indexHtml.includes(asset) || !englishIndexHtml.includes(asset)) {
    throw new Error(`Public download link is missing from the exported site: ${asset}`);
  }
}

const unpublishedWindowsAsset = `Relayune-${version}-Windows-x64-setup.exe`;
if (
  indexHtml.includes(unpublishedWindowsAsset) ||
  englishIndexHtml.includes(unpublishedWindowsAsset) ||
  !indexHtml.includes("暂不提供未签名安装包") ||
  !englishIndexHtml.includes("An unsigned installer is not published")
) {
  throw new Error("The exported site must keep the unsigned Windows installer unavailable.");
}

const macUpdater = updateManifest.platforms?.["macos-universal"];
if (
  typeof macUpdater?.url !== "string" ||
  !macUpdater.url.endsWith(
    `/Relayune-${updateManifest.version}-macOS-universal.app.tar.gz`,
  ) ||
  typeof macUpdater?.signature !== "string" ||
  macUpdater.signature.trim() === ""
) {
  throw new Error("The macOS updater manifest is incomplete or stale.");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

console.log("Official download metadata and exported links validated.");
