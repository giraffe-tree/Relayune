import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMobileVersion, resolveBuildTools, sha256File, verifySignedApk, verifyApkMetadata } from "./prepare-android-update-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageId = "cn.giraffetree.relayune";
const activity = `${packageId}/.MainActivity`;
const digest = (value) => createHash("sha256").update(value).digest("hex");

export function parseArguments(args) {
  const options = { ref: "HEAD" };
  for (let i = 0; i < args.length; i++) {
    if (["--help", "--check"].includes(args[i])) options[args[i].slice(2)] = true;
    else if (["--ref", "--device"].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith("-")) {
      options[args[i].slice(2)] = args[++i];
    } else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  return options;
}

export function selectUsbDevice(output, requested) {
  const devices = output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(\S+)\s+(device|unauthorized|offline)\b(.*)$/);
    return match ? [{ serial: match[1], state: match[2], details: match[3] }] : [];
  });
  const candidates = devices.filter((d) => requested ? d.serial === requested : /\busb:/.test(d.details));
  if (candidates.length !== 1) throw new Error(`Expected one USB phone; use --device SERIAL. Connected devices:\n${output}`);
  if (candidates[0].state !== "device") throw new Error(`Phone is ${candidates[0].state}; unlock it and authorize USB debugging, then retry.`);
  return candidates[0].serial;
}

export function cacheMatches(record, commit, inputs, sha256) {
  return record?.schema === 1 && record.commit === commit && record.inputs === inputs && record.sha256 === sha256;
}

export function assertNoDowngrade(packageInfo, versionCode) {
  const installed = packageInfo.match(/\bversionCode=(\d+)/)?.[1];
  if (installed && Number(installed) > versionCode) throw new Error(`Phone has versionCode ${installed}, target is ${versionCode}; refusing downgrade. App data was not removed.`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status}):\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  return result.stdout?.trim() ?? "";
}

function executable(candidates, label) {
  for (const candidate of candidates.filter(Boolean)) {
    if (path.isAbsolute(candidate) && existsSync(candidate)) return candidate;
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      if (existsSync(path.join(dir, candidate))) return path.join(dir, candidate);
    }
  }
  throw new Error(`${label} not found; configure its environment variable or PATH.`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: npm run mobile:android:install -- [--device SERIAL] [--ref HEAD] [--check]\nBuild the local commit in an isolated worktree, cache a signed APK, install over USB and launch.\n--check only checks device, target version and cache; does not build or install. No fetch, publish, uninstall or downgrade.");
    return;
  }
  const git = (...args) => run("git", args);
  const commit = git("rev-parse", "--verify", "--end-of-options", `${options.ref}^{commit}`);
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  console.log(`Source: ${options.ref === "HEAD" ? `current checkout HEAD (${branch})` : `explicit --ref ${options.ref}`}`);
  console.log(`Checkout: ${root}`);
  console.log(git("show", "-s", "--format=Commit: %H%nSubject: %s%nAuthor: %an%nAuthor date: %aI%nCommit date: %cI", commit));
  const version = parseMobileVersion(git("show", `${commit}:mobile/pubspec.yaml`));
  const properties = existsSync(path.join(root, "mobile/android/local.properties"))
    ? readFileSync(path.join(root, "mobile/android/local.properties"), "utf8") : "";
  const property = (name) => properties.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1);
  const sdk = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME, property("sdk.dir"), path.join(homedir(), "Library/Android/sdk"), "/opt/homebrew/share/android-commandlinetools"].find((dir) => dir && existsSync(path.join(dir, "platform-tools/adb")));
  const adb = executable([process.env.ADB, sdk && path.join(sdk, "platform-tools/adb"), "adb"], "ADB");
  const serial = selectUsbDevice(run(adb, ["devices", "-l"]), options.device);
  const device = (...args) => run(adb, ["-s", serial, ...args]);
  assertNoDowngrade(device("shell", "dumpsys", "package", packageId), version.versionCode);
  console.log(`Target ${commit.slice(0, 12)} · ${version.versionName}+${version.versionCode} · USB ${serial}`);
  const common = git("rev-parse", "--path-format=absolute", "--git-common-dir");
  const cache = path.join(homedir(), "Library/Caches/Relayune/android-usb", digest(common).slice(0, 16));
  const pushFile = path.join(root, "mobile/android/push.local.properties");
  const push = existsSync(pushFile) ? readFileSync(pushFile) : Buffer.alloc(0);
  const pushEnv = Object.fromEntries(["JPUSH_APPKEY", "VIVO_APPID", "VIVO_APPKEY", "VIVO_ATOMIC_SCENE"].map((key) => [key, process.env[key] ?? ""]));
  const inputs = digest(Buffer.concat([push, Buffer.from(JSON.stringify(pushEnv))]));
  const entry = path.join(cache, `${commit}-${inputs.slice(0, 16)}`);
  const checkout = path.join(entry, "checkout");
  const apk = path.join(entry, "Relayune.apk");
  const receipt = path.join(entry, "artifact.json");
  let cached = false;
  if (existsSync(apk) && existsSync(receipt)) {
    cached = cacheMatches(JSON.parse(readFileSync(receipt, "utf8")), commit, inputs, await sha256File(apk));
  }
  if (options.check) {
    console.log(`Cache: ${cached ? "matching APK" : "build required"}\n${apk}`);
    return;
  }
  mkdirSync(cache, { recursive: true });
  const lock = path.join(cache, "install.lock");
  try { mkdirSync(lock); } catch { throw new Error(`Another installer holds ${lock}. If it crashed, verify no installer/build is running before removing this lock.`); }
  writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, commit, serial }));
  try {
    if (sdk) process.env.ANDROID_SDK_ROOT = sdk;
    const buildTools = await resolveBuildTools({});
    if (!cached) {
      if (!sdk) throw new Error("Android SDK not found; set ANDROID_SDK_ROOT before building.");
      const flutter = executable([process.env.FLUTTER, property("flutter.sdk") && path.join(property("flutter.sdk"), "bin/flutter"), "flutter"], "Flutter");
      const signing = process.env.ANDROID_SIGNING_SCRIPT ?? path.join(homedir(), ".codex/skills/manage-android-signing-keys/scripts/android_signing.py");
      if (!existsSync(signing)) throw new Error(`Android signing skill script missing: ${signing}`);
      mkdirSync(entry, { recursive: true });
      if (!existsSync(checkout)) git("worktree", "add", "--detach", checkout, commit);
      const checkedCommit = run("git", ["rev-parse", "HEAD"], { cwd: checkout });
      if (checkedCommit !== commit) throw new Error("Cached worktree commit differs; refusing build.");
      // Generated localization files can change during Flutter builds. Only reset these
      // in this script-owned checkout; all other modifications must be investigated.
      run("git", ["restore", "--", "mobile/lib/generated/l10n"], { cwd: checkout });
      if (run("git", ["status", "--porcelain"], { cwd: checkout })) throw new Error(`Build checkout is dirty: ${checkout}`);
      writeFileSync(path.join(checkout, "mobile/android/local.properties"), `sdk.dir=${sdk}\nflutter.sdk=${path.dirname(path.dirname(flutter))}\n`);
      if (push.length) writeFileSync(path.join(checkout, "mobile/android/push.local.properties"), push, { mode: 0o600 });
      const env = { ...process.env, PATH: `${path.dirname(flutter)}${path.delimiter}${process.env.PATH}` };
      console.log("Building signed APK from isolated commit…");
      run("python3", [signing, "run", "--package-id", packageId, "--cwd", checkout, "--", process.execPath, "mobile/tool/flutter.mjs", "build", "apk", "--release"], { env, stdio: "inherit" });
      const built = path.join(checkout, "mobile/build/app/outputs/flutter-apk/app-release.apk");
      verifySignedApk(buildTools.apksigner, built);
      verifyApkMetadata(buildTools.aapt, built, version);
      const metadata = JSON.parse(readFileSync(path.join(checkout, "mobile/build/relayune-build-info.json"), "utf8"));
      if (metadata.source_commit !== commit || metadata.source_dirty !== false) throw new Error("Build provenance is not a clean target commit.");
      copyFileSync(built, apk);
      writeFileSync(receipt, JSON.stringify({ schema: 1, commit, inputs, sha256: await sha256File(apk), ...version, builtAt: metadata.built_at }, null, 2));
    } else console.log("Reusing verified commit cache.");
    verifySignedApk(buildTools.apksigner, apk);
    verifyApkMetadata(buildTools.aapt, apk, version);
    assertNoDowngrade(device("shell", "dumpsys", "package", packageId), version.versionCode);
    const installed = device("install", "-r", apk);
    if (!/\bSuccess\b/.test(installed)) throw new Error(`Installation did not report success: ${installed}`);
    device("shell", "am", "force-stop", packageId);
    const started = device("shell", "am", "start", "-W", "-n", activity);
    if (!/Status: ok/.test(started)) throw new Error(`Launch failed: ${started}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (!device("shell", "pidof", packageId)) throw new Error("App process exited after launch.");
    console.log(`Installed and launched ${version.versionName}+${version.versionCode} (${commit.slice(0, 12)}). Existing app data retained.\nAPK: ${apk}`);
  } finally { rmSync(lock, { recursive: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
