import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { localBuildEnvironment } from "./local-macos-build.mjs";

export function staticCheckPlan(desktopDirectory, rustLibTests = false) {
  return rustLibTests
    ? [["cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "--locked"]]]
    : [
      [process.execPath, [join(desktopDirectory, "node_modules", "typescript", "bin", "tsc"), "--noEmit"]],
      ["cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml", "--locked"]],
    ];
}

export function staticCheckEnvironment(environment, overlay) {
  // This file must never grow into a second build/release configuration. The
  // only exception is omitting generated sidecars from static compile checks.
  if (JSON.stringify(overlay) !== JSON.stringify({ bundle: { externalBin: [] } })) {
    throw new Error("Static checks may only disable the generated sidecar externalBin list.");
  }
  return { ...localBuildEnvironment(environment), TAURI_CONFIG: JSON.stringify(overlay) };
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--rust-lib-tests") || args.length > 1) {
    throw new Error("Usage: node scripts/check.mjs [--rust-lib-tests]");
  }
  const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const overlay = JSON.parse(readFileSync(join(desktopDirectory, "src-tauri", "tauri.static-check.conf.json"), "utf8"));
  const env = staticCheckEnvironment(process.env, overlay);
  for (const [command, commandArgs] of staticCheckPlan(desktopDirectory, args.includes("--rust-lib-tests"))) {
    const result = spawnSync(command, commandArgs, { cwd: desktopDirectory, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
  }
  console.log("Static source checks passed; sidecar packaging, signing and native application behavior were not verified.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
