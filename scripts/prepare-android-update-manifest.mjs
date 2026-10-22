import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const manifestKeys = [
  "version_name",
  "version_code",
  "url",
  "sha256",
  "size",
  "published_at",
  "notes",
];
export const androidReleaseNoteLocales = Object.freeze([
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
]);
const releaseCopyLocales = Object.freeze(
  androidReleaseNoteLocales.map((locale) => locale === "zh-CN" ? "zh" : locale),
);
const packageId = "cn.giraffetree.relayune";
const expectedSigningCertificateSha256 =
  "ce551c4cd78cd06dfb9c4c93c2ac8609388658e441a781da35ca7e1bda746fe9";
const publicAssetOrigin = "https://open-chen.oss-cn-hangzhou.aliyuncs.com";

export function parseMobileVersion(pubspecSource) {
  const match = pubspecSource.match(/^version:\s*([^+\s]+)\+(\d+)\s*$/m);
  if (!match || !semverPattern.test(match[1])) {
    throw new Error("mobile/pubspec.yaml must contain a SemVer version and positive build number.");
  }
  const versionCode = Number(match[2]);
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
    throw new Error("Android version_code must be a positive safe integer.");
  }
  return { versionName: match[1], versionCode };
}

export function expectedAndroidAssetUrl(versionName) {
  if (!semverPattern.test(versionName)) {
    throw new Error(`Android version_name is not valid SemVer: ${versionName}`);
  }
  return (
    `${publicAssetOrigin}/apps/relayune/${versionName}/` +
    `Relayune-${versionName}-Android.apk`
  );
}

export function validateAndroidUpdateManifest(manifest) {
  if (!isPlainObject(manifest)) {
    throw new Error("Android update manifest must be a JSON object.");
  }
  assertExactKeys(manifest, manifestKeys, "Android update manifest");
  if (typeof manifest.version_name !== "string" || !semverPattern.test(manifest.version_name)) {
    throw new Error("Android update manifest version_name must be SemVer.");
  }
  if (!Number.isSafeInteger(manifest.version_code) || manifest.version_code <= 0) {
    throw new Error("Android update manifest version_code must be a positive integer.");
  }
  const expectedUrl = expectedAndroidAssetUrl(manifest.version_name);
  if (manifest.url !== expectedUrl) {
    throw new Error(`Android update manifest URL must be ${expectedUrl}.`);
  }
  if (typeof manifest.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifest.sha256)) {
    throw new Error("Android update manifest sha256 must be 64 lowercase hexadecimal characters.");
  }
  if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0) {
    throw new Error("Android update manifest size must be a positive integer.");
  }
  if (
    typeof manifest.published_at !== "string" ||
    Number.isNaN(Date.parse(manifest.published_at)) ||
    new Date(manifest.published_at).toISOString() !== manifest.published_at
  ) {
    throw new Error("Android update manifest published_at must be a canonical ISO timestamp.");
  }
  if (!isPlainObject(manifest.notes)) {
    throw new Error("Android update manifest notes must be an object.");
  }
  assertExactKeys(
    manifest.notes,
    androidReleaseNoteLocales,
    "Android update manifest notes",
  );
  for (const locale of androidReleaseNoteLocales) {
    if (typeof manifest.notes[locale] !== "string" || !manifest.notes[locale].trim()) {
      throw new Error(`Android update manifest notes.${locale} must be non-empty.`);
    }
  }
  return manifest;
}

// A local source bump must not require editing an already published manifest.
// Both values still refer to real builds and public updates may never lead source.
export function assertPublishedAndroidSourceCompatibility(manifest, source) {
  const order = compareSemver(manifest.version_name, source.versionName);
  if (order > 0 || manifest.version_code > source.versionCode ||
      (order === 0 && manifest.version_code !== source.versionCode)) {
    throw new Error("The exported Android update manifest must match mobile/pubspec.yaml or an older published release.");
  }
}

export function assertProductionMonotonicity(candidate, current) {
  validateAndroidUpdateManifest(candidate);
  if (current == null) return;
  validateAndroidUpdateManifest(current);

  if (candidate.version_code === current.version_code) {
    if (JSON.stringify(candidate) === JSON.stringify(current)) return;
    throw new Error(
      "Refusing to mutate an already published Android version_code; use a new version and build number.",
    );
  }
  if (
    candidate.version_code < current.version_code ||
    compareSemver(candidate.version_name, current.version_name) <= 0
  ) {
    throw new Error(
      `Refusing Android update rollback from ${current.version_name}+${current.version_code} ` +
        `to ${candidate.version_name}+${candidate.version_code}.`,
    );
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const pubspecPath = resolveFromRoot(options.pubspec ?? "mobile/pubspec.yaml");
  const { versionName, versionCode } = parseMobileVersion(
    await readFile(pubspecPath, "utf8"),
  );
  const apkPath = resolveFromRoot(
    options.apk ?? `dist/release/${versionName}/Relayune-${versionName}-Android.apk`,
  );
  const releaseNotesPath = resolveFromRoot(
    options.releaseNotes ?? `release-notes/${versionName}.json`,
  );
  const outputPath = resolveFromRoot(options.output ?? "public/updates/android.json");

  const releaseNotes = JSON.parse(await readFile(releaseNotesPath, "utf8"));
  assertReleaseNotes(releaseNotes, versionName);
  const buildTools = await resolveBuildTools(options);
  verifySignedApk(buildTools.apksigner, apkPath);
  verifyApkMetadata(buildTools.aapt, apkPath, { versionName, versionCode });

  const apkStat = await stat(apkPath);
  if (!apkStat.isFile() || apkStat.size <= 0) {
    throw new Error(`Android release artifact is empty or not a file: ${apkPath}`);
  }
  const manifest = validateAndroidUpdateManifest({
    version_name: versionName,
    version_code: versionCode,
    url: expectedAndroidAssetUrl(versionName),
    sha256: await sha256File(apkPath),
    size: apkStat.size,
    published_at: canonicalIso(releaseNotes.publishedAt),
    notes: androidManifestNotes(releaseNotes),
  });

  const current = await readOptionalJson(outputPath);
  if (options.production) assertProductionMonotonicity(manifest, current);
  if (options.check) {
    if (current == null || JSON.stringify(current) !== JSON.stringify(manifest)) {
      throw new Error(`Android update manifest is missing or stale: ${outputPath}`);
    }
    process.stdout.write(
      `${JSON.stringify({ ok: true, checked: true, version: versionName, version_code: versionCode })}\n`,
    );
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  await rename(temporaryPath, outputPath);
  process.stdout.write(
    `${JSON.stringify({ ok: true, version: versionName, version_code: versionCode, output: path.relative(root, outputPath) })}\n`,
  );
}

function parseArguments(argumentsList) {
  const options = {};
  const valueOptions = new Map([
    ["--apk", "apk"],
    ["--output", "output"],
    ["--pubspec", "pubspec"],
    ["--release-notes", "releaseNotes"],
    ["--apksigner", "apksigner"],
    ["--aapt", "aapt"],
  ]);
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--production") {
      options.production = true;
      continue;
    }
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    const key = valueOptions.get(argument);
    if (!key || !argumentsList[index + 1]) {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
    options[key] = argumentsList[index + 1];
    index += 1;
  }
  return options;
}

export async function resolveBuildTools(options) {
  if (options.apksigner || options.aapt) {
    if (!options.apksigner || !options.aapt) {
      throw new Error("--apksigner and --aapt must be supplied together.");
    }
    return {
      apksigner: resolveFromRoot(options.apksigner),
      aapt: resolveFromRoot(options.aapt),
    };
  }

  const roots = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    "/opt/homebrew/share/android-commandlinetools",
    "/usr/local/share/android-commandlinetools",
  ].filter(Boolean);
  for (const sdkRoot of roots) {
    const buildToolsRoot = path.join(sdkRoot, "build-tools");
    let versions;
    try {
      versions = await readdir(buildToolsRoot);
    } catch {
      continue;
    }
    versions.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    for (const version of versions) {
      const apksigner = path.join(buildToolsRoot, version, "apksigner");
      const aapt = path.join(buildToolsRoot, version, "aapt");
      if ((await isExecutable(apksigner)) && (await isExecutable(aapt))) {
        return { apksigner, aapt };
      }
    }
  }
  if (commandSucceeds("apksigner", ["version"]) && commandSucceeds("aapt", ["version"])) {
    return { apksigner: "apksigner", aapt: "aapt" };
  }
  throw new Error(
    "Android build tools are unavailable. Set ANDROID_SDK_ROOT or pass --apksigner and --aapt.",
  );
}

export function verifySignedApk(apksigner, apkPath) {
  const result = spawnSync(
    apksigner,
    ["verify", "--verbose", "--print-certs", apkPath],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const certificate = output.match(
    /Signer #1 certificate SHA-256 digest:\s*([0-9a-f]{64})/i,
  )?.[1]?.toLowerCase();
  if (
    result.status !== 0 ||
    !/Number of signers:\s*[1-9]\d*/.test(output) ||
    !/Verified using v(?:2|3|3\.1|4) scheme[^:]*:\s*true/.test(output) ||
    certificate !== expectedSigningCertificateSha256
  ) {
    throw new Error(
      "Android artifact is not a valid APK signed by the registered Relayune production identity.",
    );
  }
}

export function verifyApkMetadata(aapt, apkPath, expected) {
  const result = spawnSync(aapt, ["dump", "badging", apkPath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error("Unable to inspect Android artifact package metadata.");
  }
  const packageLine = result.stdout.split(/\r?\n/, 1)[0] ?? "";
  const packageMatch = packageLine.match(
    /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/,
  );
  if (
    !packageMatch ||
    packageMatch[1] !== packageId ||
    packageMatch[2] !== String(expected.versionCode) ||
    packageMatch[3] !== expected.versionName
  ) {
    throw new Error(
      `APK metadata must match ${packageId} ${expected.versionName}+${expected.versionCode}.`,
    );
  }
}

function assertReleaseNotes(releaseNotes, versionName) {
  if (
    !isPlainObject(releaseNotes) ||
    releaseNotes.version !== versionName ||
    !Array.isArray(releaseNotes.platforms) ||
    !releaseNotes.platforms.includes("android") ||
    !isPlainObject(releaseNotes.copy)
  ) {
    throw new Error(`Release notes must describe Android ${versionName}.`);
  }
  assertExactKeys(
    releaseNotes.copy,
    releaseCopyLocales,
    "Android release-note copy",
  );
  for (const locale of releaseCopyLocales) formatNotes(releaseNotes.copy[locale]);
  canonicalIso(releaseNotes.publishedAt);
}

export function androidManifestNotes(releaseNotes) {
  if (!isPlainObject(releaseNotes?.copy)) {
    throw new Error("Android release notes require localized copy.");
  }
  return Object.fromEntries(
    androidReleaseNoteLocales.map((locale) => {
      const copyLocale = locale === "zh-CN" ? "zh" : locale;
      return [locale, formatNotes(releaseNotes.copy[copyLocale])];
    }),
  );
}

function formatNotes(copy) {
  if (
    !isPlainObject(copy) ||
    typeof copy.title !== "string" ||
    !copy.title.trim() ||
    !Array.isArray(copy.items) ||
    copy.items.length === 0 ||
    copy.items.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error("Android release notes require a non-empty title and item list.");
  }
  return `${copy.title.trim()}\n\n${copy.items.map((item) => `- ${item.trim()}`).join("\n")}`;
}

function canonicalIso(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("Android release publishedAt must be an ISO timestamp.");
  }
  return new Date(value).toISOString();
}

export async function sha256File(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function readOptionalJson(filename) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function isExecutable(filename) {
  try {
    await access(filename, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandSucceeds(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

function compareSemver(left, right) {
  const leftParsed = parseSemver(left);
  const rightParsed = parseSemver(right);
  const leftParts = leftParsed.core;
  const rightParts = rightParsed.core;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  if (leftParsed.pre.length === 0 && rightParsed.pre.length > 0) return 1;
  if (leftParsed.pre.length > 0 && rightParsed.pre.length === 0) return -1;
  const length = Math.max(leftParsed.pre.length, rightParsed.pre.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftParsed.pre[index];
    const rightIdentifier = rightParsed.pre[index];
    if (leftIdentifier == null) return -1;
    if (rightIdentifier == null) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return Number(leftIdentifier) > Number(rightIdentifier) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }
  return 0;
}

function parseSemver(value) {
  const match = value.match(semverPattern);
  if (!match) throw new Error(`Invalid SemVer: ${value}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4]?.split(".") ?? [],
  };
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const normalizedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(normalizedExpected)) {
    throw new Error(`${label} keys must be exactly: ${expected.join(", ")}.`);
  }
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function resolveFromRoot(filename) {
  return path.isAbsolute(filename) ? filename : path.join(root, filename);
}

const isMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
