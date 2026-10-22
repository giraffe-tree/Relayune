import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { developmentMacBuildPlan, localMacBuildPlan, localBuildEnvironment } from "./local-macos-build.mjs";
import { staticCheckPlan, staticCheckEnvironment } from "./check.mjs";

const desktopDirectory = fileURLToPath(new URL("../", import.meta.url));
const readConfig = async (name) => JSON.parse(await readFile(new URL(`../src-tauri/${name}`, import.meta.url), "utf8"));
const official = await readConfig("tauri.conf.json");
const development = await readConfig("tauri.development.conf.json");

test("contributor plan isolates application data and never uses a release signer or updater", () => {
  const plan = developmentMacBuildPlan(desktopDirectory, official, development);
  assert.match(plan.app, /debug\/bundle\/macos\/Relayune Development\.app$/);
  const build = plan.commands.find(([command]) => command === "tauri")[1];
  assert.ok(build.includes("--debug") && build.includes("--no-sign"));
  assert.equal(build[build.indexOf("--config") + 1], "src-tauri/tauri.development.conf.json");
  const signatures = plan.commands.filter(([command, args]) => command === "codesign" && args.includes("--sign"));
  assert.equal(signatures.length, 2);
  for (const [, args] of signatures) {
    assert.equal(args[args.indexOf("--sign") + 1], "-");
    assert.ok(args.includes("--timestamp=none"));
  }
  assert.equal(signatures[1][1][signatures[1][1].indexOf("--identifier") + 1], development.identifier);
  assert.ok(plan.commands.at(-1)[1].includes("--verify"));
  assert.doesNotMatch(JSON.stringify(plan), /notarytool|stapler|open|app,dmg|--pre-sign-for-tauri/);
});

test("development plan rejects shared identity, updater feed, release artifact and release signer", () => {
  for (const mutate of [
    (config) => { config.identifier = official.identifier; },
    (config) => { config.bundle.macOS.signingIdentity = official.bundle.macOS.signingIdentity; },
    (config) => { config.bundle.createUpdaterArtifacts = true; },
    (config) => { config.plugins.updater.endpoints = official.plugins.updater.endpoints; },
  ]) {
    const config = structuredClone(development);
    mutate(config);
    assert.throws(() => developmentMacBuildPlan(desktopDirectory, official, config), /Development builds require/);
  }
});

test("default plan still requires Developer ID and signs both executables with it", () => {
  const plan = localMacBuildPlan(desktopDirectory, official);
  const signatures = plan.commands.filter(([command, args]) => command === "codesign" && args.includes("--sign"));
  assert.equal(signatures.length, 2);
  assert.ok(signatures.every(([, args]) => args[args.indexOf("--sign") + 1] === official.bundle.macOS.signingIdentity));
  assert.throws(() => localMacBuildPlan(desktopDirectory, development), /unsigned fallback/);
  assert.deepEqual(localBuildEnvironment({ PATH: "fixture", APPLE_SIGNING_IDENTITY: "secret", TAURI_SIGNING_PRIVATE_KEY: "secret", TAURI_CONFIG: JSON.stringify(official) }), { PATH: "fixture" });
});

test("development overlay does not register official deep links or replace the updater trust key", async () => {
  const plist = await readFile(new URL("../src-tauri/Info.development.plist", import.meta.url), "utf8");
  assert.match(plist, /<key>CFBundleURLTypes<\/key>\s*<array\s*\/>/);
  assert.equal(development.bundle.macOS.infoPlist, "Info.development.plist");
  assert.equal(development.plugins.updater.pubkey, undefined);
});

test("static checks compile source or run only lib tests without preparing or packaging sidecars", () => {
  const check = staticCheckPlan(desktopDirectory);
  assert.equal(check.length, 2);
  assert.ok(check[0][1].includes("--noEmit"));
  assert.deepEqual(check[1], ["cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml", "--locked"]]);
  assert.deepEqual(staticCheckPlan(desktopDirectory, true), [
    ["cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "--locked"]],
  ]);
  assert.doesNotMatch(JSON.stringify(check), /codesign|tauri.*build|prepare-sidecar|release|open/);
});

test("static check overlay is narrowly scoped and replaces inherited Tauri/release settings", async () => {
  const overlay = await readConfig("tauri.static-check.conf.json");
  const environment = staticCheckEnvironment({ PATH: "fixture", TAURI_CONFIG: "untrusted", APPLE_ID: "private", TAURI_SIGNING_PRIVATE_KEY: "private" }, overlay);
  assert.deepEqual(environment, { PATH: "fixture", TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }) });
  assert.throws(() => staticCheckEnvironment({}, { ...overlay, identifier: "different.app" }), /only disable/);
  assert.throws(() => staticCheckEnvironment({}, { bundle: { externalBin: ["fixture"] } }), /only disable/);
  assert.ok(official.bundle.externalBin.length > 0, "production packaging still requires its real sidecar");
});
