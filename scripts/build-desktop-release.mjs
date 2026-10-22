import { access, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseStartedAt = Date.now();
const signingKey =
  process.env.TAURI_SIGNING_PRIVATE_KEY ||
  path.join(homedir(), ".tauri", "agent-relay.key");

await access(signingKey);
const signingKeyStat = await stat(signingKey);
if ((signingKeyStat.mode & 0o077) !== 0) {
  throw new Error(`Updater signing key must be mode 0600: ${signingKey}`);
}

const release = spawnSync(
  "npm",
  ["--prefix", "desktop", "run", "desktop:release"],
  {
    cwd: root,
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: signingKey,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
        process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || "",
    },
    stdio: "inherit",
  },
);
if (release.status !== 0) {
  process.exit(release.status ?? 1);
}

const config = JSON.parse(
  await readFile(
    path.join(root, "desktop", "src-tauri", "tauri.conf.json"),
    "utf8",
  ),
);
const appPath = path.join(
  root,
  "desktop",
  "src-tauri",
  "target",
  "universal-apple-darwin",
  "release",
  "bundle",
  "macos",
  "Relayune.app",
);
const dmgPath = path.join(
  root,
  "desktop",
  "src-tauri",
  "target",
  "universal-apple-darwin",
  "release",
  "bundle",
  "dmg",
  `Relayune_${config.version}_universal.dmg`,
);
const updaterPath = path.join(
  root,
  "desktop",
  "src-tauri",
  "target",
  "universal-apple-darwin",
  "release",
  "bundle",
  "macos",
  `${config.productName}.app.tar.gz`,
);
await access(appPath);
await access(dmgPath);
await access(updaterPath);
await access(`${updaterPath}.sig`);
const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
for (const artifact of [infoPlistPath, dmgPath, updaterPath, `${updaterPath}.sig`]) {
  const artifactStat = await stat(artifact);
  if (artifactStat.mtimeMs < releaseStartedAt - 2_000) {
    throw new Error(`Release artifact is stale: ${artifact}`);
  }
}
const plistVersion = capture("plutil", [
  "-extract",
  "CFBundleShortVersionString",
  "raw",
  "-o",
  "-",
  infoPlistPath,
]).trim();
if (plistVersion !== config.version) {
  throw new Error(`Signed app version is ${plistVersion}, expected ${config.version}.`);
}
for (const executable of ["relayune-desktop", "relayune-core"]) {
  const architectures = capture("lipo", [
    "-archs",
    path.join(appPath, "Contents", "MacOS", executable),
  ]).trim().split(/\s+/).sort();
  if (architectures.join(" ") !== "arm64 x86_64") {
    throw new Error(`${executable} is not universal: ${architectures.join(" ")}.`);
  }
}
run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath]);
run("xcrun", ["stapler", "validate", appPath]);
smokeUniversalSidecar(appPath);
const notaryProfile =
  process.env.NOTARYTOOL_KEYCHAIN_PROFILE || "agent-relay-notary";
run("xcrun", [
  "notarytool",
  "submit",
  dmgPath,
  "--keychain-profile",
  notaryProfile,
  "--wait",
  "--timeout",
  "30m",
]);
run("xcrun", ["stapler", "staple", dmgPath]);
run("xcrun", ["stapler", "validate", dmgPath]);

const prepare = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "prepare-desktop-artifacts.mjs")],
  { cwd: root, env: process.env, stdio: "inherit" },
);
process.exit(prepare.status ?? 1);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function smokeUniversalSidecar(appPath) {
  const sidecarPath = path.join(
    appPath,
    "Contents",
    "MacOS",
    "relayune-core",
  );
  for (const archFlag of ["-arm64", "-x86_64"]) {
    const result = spawnSync("/usr/bin/arch", [archFlag, sidecarPath], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
    });
    if (
      result.status !== 1 ||
      !result.stderr.includes("RELAY_SERVER_URL is required")
    ) {
      throw new Error(
        `Signed app sidecar smoke test failed for ${archFlag}: ${result.stderr.trim()}`,
      );
    }
  }
}
