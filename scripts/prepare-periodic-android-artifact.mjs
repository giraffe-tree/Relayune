import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseMobileVersion,
  resolveBuildTools,
  sha256File,
  verifyApkMetadata,
  verifySignedApk,
} from "./prepare-android-update-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageId = "cn.giraffetree.relayune";
const signingCertificateSha256 =
  "ce551c4cd78cd06dfb9c4c93c2ac8609388658e441a781da35ca7e1bda746fe9";
const candidateMarker = "relayune-periodic-android-v1\n";
const candidateNamePattern = /^\d{8}T\d{6}Z-[0-9a-f]{7}(?:-dirty)?$/;
const commitPattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const metadataKeys = [
  "schema_version",
  "kind",
  "built_at",
  "version_name",
  "version_code",
  "package_id",
  "source_commit",
  "source_dirty",
  "apk",
];
const apkKeys = ["file", "size", "sha256", "signing_certificate_sha256"];

export function candidateDirectoryName(builtAt, commit, dirty) {
  const canonical = canonicalIso(builtAt);
  if (!commitPattern.test(commit)) throw new Error("source commit must be a full lowercase Git SHA.");
  const timestamp = canonical.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}-${commit.slice(0, 7)}${dirty ? "-dirty" : ""}`;
}

export function validatePeriodicMetadata(metadata) {
  assertPlainObject(metadata, "Periodic Android metadata");
  assertExactKeys(metadata, metadataKeys, "Periodic Android metadata");
  if (metadata.schema_version !== 1 || metadata.kind !== "relayune-periodic-android") {
    throw new Error("Periodic Android metadata schema is unsupported.");
  }
  canonicalIso(metadata.built_at);
  const parsed = parseMobileVersion(`version: ${metadata.version_name}+${metadata.version_code}\n`);
  if (parsed.versionName !== metadata.version_name || parsed.versionCode !== metadata.version_code) {
    throw new Error("Periodic Android version metadata is invalid.");
  }
  if (metadata.package_id !== packageId) throw new Error("Periodic Android package ID is invalid.");
  if (!commitPattern.test(metadata.source_commit)) throw new Error("Periodic Android source commit is invalid.");
  if (typeof metadata.source_dirty !== "boolean") throw new Error("Periodic Android dirty state is invalid.");
  assertPlainObject(metadata.apk, "Periodic Android APK metadata");
  assertExactKeys(metadata.apk, apkKeys, "Periodic Android APK metadata");
  if (metadata.apk.file !== `Relayune-${metadata.version_name}-Android.apk`) {
    throw new Error("Periodic Android APK filename is invalid.");
  }
  if (!Number.isSafeInteger(metadata.apk.size) || metadata.apk.size <= 0) {
    throw new Error("Periodic Android APK size is invalid.");
  }
  if (!sha256Pattern.test(metadata.apk.sha256)) throw new Error("Periodic Android APK hash is invalid.");
  if (metadata.apk.signing_certificate_sha256 !== signingCertificateSha256) {
    throw new Error("Periodic Android signing certificate is invalid.");
  }
  return metadata;
}

export async function prunePeriodicCandidates(outputRoot, retain = 24) {
  if (!Number.isSafeInteger(retain) || retain < 1) throw new Error("retain must be a positive integer.");
  const resolvedRoot = path.resolve(outputRoot);
  const candidates = [];
  let versions = [];
  try {
    versions = await readdir(resolvedRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  for (const versionEntry of versions) {
    if (!versionEntry.isDirectory()) continue;
    const versionRoot = path.join(resolvedRoot, versionEntry.name);
    const entries = await readdir(versionRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !candidateNamePattern.test(entry.name)) continue;
      const candidatePath = path.join(versionRoot, entry.name);
      if (!isInside(resolvedRoot, candidatePath)) continue;
      try {
        const [marker, metadata] = await Promise.all([
          readFile(path.join(candidatePath, ".relayune-periodic-candidate"), "utf8"),
          readFile(path.join(candidatePath, "artifact.json"), "utf8").then(JSON.parse),
        ]);
        if (marker !== candidateMarker) continue;
        validatePeriodicMetadata(metadata);
        if (metadata.version_name !== versionEntry.name) continue;
        candidates.push({ candidatePath, builtAt: metadata.built_at });
      } catch {
        // Unknown or incomplete directories are never removed automatically.
      }
    }
  }
  candidates.sort((left, right) => right.builtAt.localeCompare(left.builtAt));
  const removed = [];
  for (const candidate of candidates.slice(retain)) {
    if (!isInside(resolvedRoot, candidate.candidatePath)) continue;
    await rm(candidate.candidatePath, { recursive: true, force: false });
    removed.push(candidate.candidatePath);
  }
  return removed;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const pubspecPath = resolveFromRoot(options.pubspec ?? "mobile/pubspec.yaml");
  const apkPath = resolveFromRoot(
    options.apk ?? "mobile/build/app/outputs/flutter-apk/app-release.apk",
  );
  const outputRoot = resolveFromRoot(options.outputRoot ?? "dist/periodic/android");
  const { versionName, versionCode } = parseMobileVersion(await readFile(pubspecPath, "utf8"));
  const buildTools = await resolveBuildTools(options);
  verifySignedApk(buildTools.apksigner, apkPath);
  verifyApkMetadata(buildTools.aapt, apkPath, { versionName, versionCode });
  const apkStat = await stat(apkPath);
  if (!apkStat.isFile() || apkStat.size <= 0) throw new Error("Periodic Android artifact is empty.");

  const sourceCommit = gitOutput(["rev-parse", "HEAD"]).toLowerCase();
  if (!commitPattern.test(sourceCommit)) throw new Error("Unable to resolve the current Git commit.");
  const sourceDirty = gitOutput(["status", "--porcelain", "--untracked-files=normal"]) !== "";
  const builtAt = canonicalIso(options.builtAt ?? new Date().toISOString());
  const apkFile = `Relayune-${versionName}-Android.apk`;
  const metadata = validatePeriodicMetadata({
    schema_version: 1,
    kind: "relayune-periodic-android",
    built_at: builtAt,
    version_name: versionName,
    version_code: versionCode,
    package_id: packageId,
    source_commit: sourceCommit,
    source_dirty: sourceDirty,
    apk: {
      file: apkFile,
      size: apkStat.size,
      sha256: await sha256File(apkPath),
      signing_certificate_sha256: signingCertificateSha256,
    },
  });

  const versionRoot = path.join(outputRoot, versionName);
  const candidatePath = path.join(
    versionRoot,
    candidateDirectoryName(builtAt, sourceCommit, sourceDirty),
  );
  if (!isInside(outputRoot, candidatePath)) throw new Error("Periodic Android output escaped its root.");
  await mkdir(versionRoot, { recursive: true });
  await mkdir(candidatePath, { recursive: false });
  try {
    await copyFile(apkPath, path.join(candidatePath, apkFile), fsConstants.COPYFILE_EXCL);
    await writeFile(path.join(candidatePath, "artifact.json"), `${JSON.stringify(metadata, null, 2)}\n`, {
      flag: "wx",
      mode: 0o644,
    });
    await writeFile(path.join(candidatePath, ".relayune-periodic-candidate"), candidateMarker, {
      flag: "wx",
      mode: 0o644,
    });
  } catch (error) {
    await rm(candidatePath, { recursive: true, force: true });
    throw error;
  }

  const removed = await prunePeriodicCandidates(outputRoot, Number(options.retain ?? 24));
  process.stdout.write(`${JSON.stringify({ ok: true, candidate: path.relative(root, candidatePath), removed: removed.length })}\n`);
}

function parseArguments(args) {
  const options = {};
  const keys = new Map([
    ["--apk", "apk"],
    ["--output-root", "outputRoot"],
    ["--pubspec", "pubspec"],
    ["--built-at", "builtAt"],
    ["--retain", "retain"],
    ["--apksigner", "apksigner"],
    ["--aapt", "aapt"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const key = keys.get(args[index]);
    if (!key || !args[index + 1]) throw new Error(`Unknown or incomplete argument: ${args[index]}`);
    options[key] = args[index + 1];
    index += 1;
  }
  if (options.retain != null && (!/^\d+$/.test(options.retain) || Number(options.retain) < 1)) {
    throw new Error("--retain must be a positive integer.");
  }
  return options;
}

function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Git inspection failed: git ${args.join(" ")}`);
  return result.stdout.trim();
}

function canonicalIso(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error("built_at must be an ISO timestamp.");
  const canonical = new Date(value).toISOString();
  if (canonical !== value) throw new Error("built_at must be a canonical ISO timestamp.");
  return canonical;
}

function assertPlainObject(value, label) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} keys are invalid.`);
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function resolveFromRoot(filename) {
  return path.isAbsolute(filename) ? filename : path.join(root, filename);
}

const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
