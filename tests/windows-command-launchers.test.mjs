import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { desktopCommandPlan, npmJavaScriptEntrypoint } from "../desktop/scripts/desktop-command.mjs";
import { flutterInvocation } from "../mobile/tool/flutter_process.mjs";
import { fakeFlutterSdk } from "./helpers/fake-flutter-sdk.mjs";

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "relayune launcher with spaces "));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return realpathSync(directory);
}

function fakeNpm(directory) {
  const root = join(directory, "Node installation with spaces", "node_modules", "npm");
  const entry = join(root, "bin", "npm-cli.js");
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "npm", type: "commonjs", bin: { npm: "bin/npm-cli.js" } }));
  writeFileSync(entry, 'require("node:fs").writeFileSync(process.env.CAPTURE, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()})); process.exit(Number(process.env.FAKE_NPM_STATUS || 0));\n');
  const batch = join(directory, "npm.cmd");
  writeFileSync(batch, '@echo off\r\nexit /b 93\r\n');
  return { entry, batch };
}

test("Windows desktop plan executes verified npm JavaScript with native Node, including paths with spaces", (t) => {
  const directory = temporary(t);
  const npm = fakeNpm(directory);
  for (const operation of ["dev", "build"]) {
    const capture = join(directory, `npm ${operation}.json`);
    const plan = desktopCommandPlan("win32", operation, npm.entry);
    assert.equal(plan.command, process.execPath);
    assert.deepEqual(plan.args, [npm.entry, "run", `desktop:${operation}:windows`]);
    const child = spawnSync(plan.command, plan.args, { env: { ...process.env, CAPTURE: capture }, shell: false });
    assert.equal(child.status, 0, String(child.stderr));
    assert.deepEqual(JSON.parse(readFileSync(capture, "utf8")).args, ["run", `desktop:${operation}:windows`]);
  }
  assert.throws(() => npmJavaScriptEntrypoint(npm.batch), /npm-cli\.js/);
  assert.throws(() => npmJavaScriptEntrypoint("relative/npm-cli.js"), /npm-cli\.js/);
  assert.throws(() => desktopCommandPlan("win32", "build & injected", npm.entry), /does not support/);
  writeFileSync(join(dirname(dirname(npm.entry)), "package.json"), JSON.stringify({ name: "unrelated", bin: { npm: "bin/npm-cli.js" } }));
  assert.throws(() => npmJavaScriptEntrypoint(npm.entry), /does not match/);
});

test("native Desktop dispatcher preserves npm status without executing npm.cmd", { skip: !["darwin", "win32"].includes(process.platform) }, (t) => {
  const directory = temporary(t);
  const npm = fakeNpm(directory);
  const capture = join(directory, "dispatcher.json");
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("../desktop/scripts/desktop-command.mjs", import.meta.url)), "build"], {
    cwd: directory,
    env: { ...process.env, npm_execpath: npm.entry, CAPTURE: capture, FAKE_NPM_STATUS: "7" },
    shell: false,
  });
  assert.equal(child.status, 7, String(child.stderr));
  const recorded = JSON.parse(readFileSync(capture, "utf8"));
  assert.deepEqual(recorded.args, ["run", process.platform === "win32" ? "desktop:build:windows" : "desktop:build:macos"]);
  assert.equal(recorded.cwd, resolve("desktop"));
});

test("Windows Flutter invocation uses native Dart plus snapshot and preserves literal arguments", (t) => {
  const directory = temporary(t);
  const sdk = fakeFlutterSdk(join(directory, "Flutter SDK with spaces"));
  const capture = join(directory, "flutter args.json");
  const args = ["test", "test/file with spaces.dart", "--dart-define=VALUE=literal & echo untouched > marker", "%PATH%", "a^b|c"];
  const invocation = flutterInvocation(args, { platform: "win32", environment: { ...process.env, FLUTTER_ROOT: sdk.root, CAPTURE: capture } });
  assert.equal(invocation.command, sdk.dart);
  assert.deepEqual(invocation.args, [sdk.snapshot, ...args]);
  const child = spawnSync(invocation.command, invocation.args, { env: invocation.environment, shell: false });
  assert.equal(child.status, 0, String(child.stderr));
  assert.deepEqual(JSON.parse(readFileSync(capture, "utf8")), args);
  assert.equal(invocation.environment.FLUTTER_ROOT, sdk.root);
});

test("Windows Flutter resolution supports Path casing and fails clearly before invoking an uninitialized SDK", (t) => {
  const directory = temporary(t);
  const sdk = fakeFlutterSdk(join(directory, "Flutter SDK with spaces"));
  const invocation = flutterInvocation(["--version"], { platform: "win32", environment: { Path: `"${join(sdk.root, "bin")}"` } });
  assert.equal(invocation.command, sdk.dart);
  rmSync(sdk.snapshot);
  assert.throws(() => flutterInvocation(["--version"], { platform: "win32", environment: { FLUTTER_ROOT: sdk.root } }), /flutter\.bat --version/);
  assert.throws(() => flutterInvocation(["--version"], { platform: "win32", environment: { PATH: "" } }), /flutter\.bat --version/);
  assert.throws(() => flutterInvocation(["--version"], { platform: "win32", environment: { FLUTTER_ROOT: "relative" } }), /absolute Flutter SDK/);
});
