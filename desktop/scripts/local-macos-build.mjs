import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function localMacBuildPlan(desktopDirectory, config, debug = false) {
  const identity = config.bundle?.macOS?.signingIdentity;
  if (!identity?.startsWith("Developer ID Application:")) {
    throw new Error("Local builds require the configured Developer ID Application identity; unsigned fallback is disabled.");
  }
  const app = join(desktopDirectory, "src-tauri", "target", debug ? "debug" : "release", "bundle", "macos", "Relayune.app");
  const core = join(app, "Contents", "MacOS", "relayune-core");
  const entitlements = resolve(desktopDirectory, "src-tauri", config.bundle.macOS.entitlements);
  const sign = (identifier, target) => ["codesign", [
    "--force", "--sign", identity, "--identifier", identifier,
    "--options", "runtime", "--timestamp", "--entitlements", entitlements, target,
  ]];
  return {
    app, core,
    commands: [
      [process.execPath, [join(desktopDirectory, "scripts", "prepare-sidecar.mjs")]],
      // Tauri only assembles here: explicit signing below cannot trigger its
      // automatic notarization path, even on a machine with release credentials.
      ["tauri", ["build", ...(debug ? ["--debug"] : []), "--bundles", "app", "--no-sign", "--config", "src-tauri/tauri.local-build.conf.json"]],
      sign("relayune-core", core),
      sign(config.identifier, app),
      ["codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]],
    ],
  };
}

// Explicit contributor opt-in. Never used as a fallback after Developer ID fails.
export function developmentMacBuildPlan(desktopDirectory, config, developmentConfig) {
  if (developmentConfig.identifier === config.identifier ||
      developmentConfig.bundle?.macOS?.signingIdentity !== "-" ||
      developmentConfig.bundle?.createUpdaterArtifacts !== false ||
      developmentConfig.plugins?.updater?.endpoints?.length !== 0) {
    throw new Error("Development builds require an isolated app identifier, ad-hoc identity, and disabled updater feed/artifacts.");
  }
  const app = join(desktopDirectory, "src-tauri", "target", "debug", "bundle", "macos", `${developmentConfig.productName}.app`);
  const core = join(app, "Contents", "MacOS", "relayune-core");
  const entitlements = resolve(desktopDirectory, "src-tauri", config.bundle.macOS.entitlements);
  const sign = (identifier, target) => ["codesign", [
    "--force", "--sign", "-", "--identifier", identifier,
    "--options", "runtime", "--timestamp=none", "--entitlements", entitlements, target,
  ]];
  return {
    app, core,
    commands: [
      [process.execPath, [join(desktopDirectory, "scripts", "prepare-sidecar.mjs")]],
      ["tauri", ["build", "--debug", "--bundles", "app", "--no-sign", "--config", "src-tauri/tauri.development.conf.json"]],
      sign("relayune-core", core),
      sign(developmentConfig.identifier, app),
      ["codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]],
    ],
  };
}

export function localBuildEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(([name]) =>
    name !== "PKG_EXECPATH" && name !== "TAURI_CONFIG" && !name.startsWith("APPLE_") && !name.startsWith("TAURI_SIGNING_")
  ));
}

function main() {
  if (process.platform !== "darwin") throw new Error("This build entry is macOS-only.");
  const debug = process.argv.includes("--debug");
  const development = process.argv.includes("--development-ad-hoc");
  const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const config = JSON.parse(readFileSync(join(desktopDirectory, "src-tauri", "tauri.conf.json"), "utf8"));
  const plan = development
    ? developmentMacBuildPlan(desktopDirectory, config, JSON.parse(readFileSync(join(desktopDirectory, "src-tauri", "tauri.development.conf.json"), "utf8")))
    : localMacBuildPlan(desktopDirectory, config, debug);
  const env = localBuildEnvironment(process.env);
  for (const [command, args] of plan.commands) {
    const result = spawnSync(command, args, { cwd: desktopDirectory, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}); local installation must not proceed.`);
  }
  const smoke = spawnSync(plan.core, ["--help"], { env, encoding: "utf8", timeout: 15_000 });
  if (smoke.error || smoke.status !== 1 || !`${smoke.stdout}${smoke.stderr}`.includes("Usage: node relay/cli.mjs")) {
    throw new Error("Signed Relay core failed its startup check; local installation must not proceed.");
  }
  console.log(`${development ? "Ad-hoc development" : "Signed local"} app verified (not notarized or published): ${plan.app}`);
  if (debug && !development) {
    const opened = spawnSync("open", [plan.app], { env, stdio: "inherit" });
    if (opened.error || opened.status !== 0) throw new Error("Could not open the signed debug app.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
