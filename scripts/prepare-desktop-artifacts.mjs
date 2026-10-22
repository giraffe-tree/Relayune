import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  await readFile(
    path.join(root, "desktop", "src-tauri", "tauri.conf.json"),
    "utf8",
  ),
);
const version = config.version;
const supportedLocales = [
  "en",
  "zh-CN",
  "hi",
  "es",
  "ar",
  "fr",
  "bn",
  "pt",
  "id",
  "ur",
];
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Desktop version is not valid SemVer: ${version}`);
}

const bundleRoot = path.join(
  root,
  "desktop",
  "src-tauri",
  "target",
  "universal-apple-darwin",
  "release",
  "bundle",
);
const dmgSource = await findOne(
  path.join(bundleRoot, "dmg"),
  (name) => name.endsWith(".dmg") && name.includes(version),
);
const updaterSource = await findOne(
  path.join(bundleRoot, "macos"),
  (name) => name === `${config.productName}.app.tar.gz`,
);
const signatureSource = `${updaterSource}.sig`;
await stat(signatureSource);

const downloadsDirectory = path.join(root, "dist", "self-hosted", "downloads");
const updatesDirectory = path.join(root, "dist", "self-hosted", "updates");
const publicUpdatesDirectory = path.join(root, "public", "updates");
await mkdir(downloadsDirectory, { recursive: true });
await mkdir(updatesDirectory, { recursive: true });
await mkdir(publicUpdatesDirectory, { recursive: true });

const dmgName = `Relayune-${version}-macOS-universal.dmg`;
const updaterName = `Relayune-${version}-macOS-universal.app.tar.gz`;
const publicAssetBase =
  `https://open-chen.oss-cn-hangzhou.aliyuncs.com/apps/relayune/${version}`;
const dmgTarget = path.join(downloadsDirectory, dmgName);
const updaterTarget = path.join(updatesDirectory, updaterName);
const signatureTarget = `${updaterTarget}.sig`;
await copyFile(dmgSource, dmgTarget);
await copyFile(updaterSource, updaterTarget);
await copyFile(signatureSource, signatureTarget);

const signature = (await readFile(signatureSource, "utf8")).trim();
assertUpdaterKeyMatchesConfig(signature, config.plugins?.updater?.pubkey);
await assertUpdaterArchiveVersion(updaterSource, config.productName, version);
const releaseNotes = await loadReleaseNotes(version);
const notesZh =
  process.env.RELEASE_NOTES_ZH?.trim() ||
  process.env.RELEASE_NOTES?.trim() ||
  formatReleaseNotes(releaseNotes.copy.zh);
const notesEn =
  process.env.RELEASE_NOTES_EN?.trim() ||
  formatReleaseNotes(releaseNotes.copy.en);
const notes = JSON.stringify(Object.fromEntries(
  supportedLocales.map((locale) => {
    if (locale === "zh-CN") return [locale, notesZh];
    if (locale === "en") return [locale, notesEn];
    const localized = releaseNotes.copy[locale];
    return [locale, localized ? formatReleaseNotes(localized) : notesEn];
  }),
));
const manifest = {
  version,
  notes,
  pub_date: process.env.RELEASE_PUB_DATE || new Date().toISOString(),
  platforms: {
    "macos-universal": {
      signature,
      url: `${publicAssetBase}/${updaterName}`,
    },
  },
};
const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;
await Promise.all([
  writeFile(
    path.join(publicUpdatesDirectory, "latest.json"),
    manifestContents,
    { mode: 0o644 },
  ),
  writeFile(
    path.join(updatesDirectory, "latest.json"),
    manifestContents,
    { mode: 0o644 },
  ),
]);

const checksums = await Promise.all([
  checksum(dmgTarget),
  checksum(updaterTarget),
]);
await writeFile(
  path.join(downloadsDirectory, "SHA256SUMS.txt"),
  `${checksums[0]}  ${dmgName}\n${checksums[1]}  ../updates/${updaterName}\n`,
  { mode: 0o644 },
);

console.log(`Prepared ${dmgName} and signed updater manifest for ${version}.`);

async function findOne(directory, predicate) {
  const matches = (await readdir(directory)).filter(predicate);
  if (matches.length !== 1) {
    throw new Error(
      `Expected one release artifact in ${directory}, found ${matches.length}.`,
    );
  }
  return path.join(directory, matches[0]);
}

async function checksum(file) {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function loadReleaseNotes(expectedVersion) {
  const releaseNotesPath = path.join(
    root,
    "release-notes",
    `${expectedVersion}.json`,
  );
  const releaseNotes = JSON.parse(await readFile(releaseNotesPath, "utf8"));
  if (
    releaseNotes.version !== expectedVersion ||
    !Array.isArray(releaseNotes.platforms) ||
    !releaseNotes.platforms.includes("macos")
  ) {
    throw new Error(
      `Release notes for ${expectedVersion} must declare the matching version and macos platform.`,
    );
  }
  for (const locale of Object.keys(releaseNotes.copy || {})) {
    if (!["zh", "en", "hi", "es", "ar", "fr", "bn", "pt", "id", "ur"].includes(locale)) {
      throw new Error(`Release notes for ${expectedVersion} contain unsupported ${locale} copy.`);
    }
    const copy = releaseNotes.copy?.[locale];
    if (
      typeof copy?.title !== "string" ||
      !copy.title.trim() ||
      !Array.isArray(copy.items) ||
      copy.items.some((item) => typeof item !== "string" || !item.trim())
    ) {
      throw new Error(`Release notes for ${expectedVersion} have invalid ${locale} copy.`);
    }
  }
  for (const locale of ["zh", "en"]) {
    if (!releaseNotes.copy?.[locale]) {
      throw new Error(`Release notes for ${expectedVersion} require ${locale} copy.`);
    }
  }
  return releaseNotes;
}

function formatReleaseNotes(copy) {
  const items = copy.items.map((item) => `- ${item.trim()}`).join("\n");
  return items ? `${copy.title.trim()}\n\n${items}` : copy.title.trim();
}

function assertUpdaterKeyMatchesConfig(signature, configuredPublicKey) {
  const signaturePacket = minisignPacket(signature, "updater signature");
  const publicKeyPacket = minisignPacket(
    configuredPublicKey,
    "configured updater public key",
  );
  if (
    signaturePacket.length < 10 ||
    publicKeyPacket.length < 10 ||
    !signaturePacket.subarray(2, 10).equals(publicKeyPacket.subarray(2, 10))
  ) {
    throw new Error(
      "Updater signature was not created by the private key matching tauri.conf.json.",
    );
  }
}

function minisignPacket(outerBase64, label) {
  if (typeof outerBase64 !== "string" || !outerBase64.trim()) {
    throw new Error(`Missing ${label}.`);
  }
  const decoded = Buffer.from(outerBase64.trim(), "base64").toString("utf8");
  const encodedPacket = decoded.trim().split(/\r?\n/)[1];
  if (!encodedPacket) throw new Error(`Invalid ${label}.`);
  return Buffer.from(encodedPacket, "base64");
}

async function assertUpdaterArchiveVersion(archive, productName, expectedVersion) {
  const { spawnSync } = await import("node:child_process");
  const plistPath = `${productName}.app/Contents/Info.plist`;
  const extracted = spawnSync("tar", ["-xOf", archive, plistPath]);
  if (extracted.status !== 0 || !extracted.stdout?.length) {
    throw new Error(`Unable to read ${plistPath} from updater archive.`);
  }
  const versionResult = spawnSync(
    "plutil",
    ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", "-"],
    { input: extracted.stdout, encoding: "utf8" },
  );
  if (versionResult.status !== 0 || versionResult.stdout.trim() !== expectedVersion) {
    throw new Error(
      `Updater archive version is not ${expectedVersion}: ${versionResult.stdout.trim() || "unknown"}.`,
    );
  }
}
