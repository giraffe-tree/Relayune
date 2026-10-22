import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fakeFlutterSdk } from "./helpers/fake-flutter-sdk.mjs";

test("Flutter builds embed the checked out commit, build time and dirty state", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "relayune-build-metadata-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const mobile = path.join(root, "mobile");
  const tool = path.join(mobile, "tool");
  const bin = path.join(root, "bin");
  mkdirSync(tool, { recursive: true });
  mkdirSync(bin);
  for (const name of ["flutter.mjs", "build_metadata.mjs", "flutter_process.mjs"]) {
    copyFileSync(new URL(`../mobile/tool/${name}`, import.meta.url), path.join(tool, name));
  }
  writeFileSync(path.join(root, ".gitignore"), "mobile/build/\ncaptured.json\nbin/\n");
  writeFileSync(path.join(bin, "flutter"), '#!/usr/bin/env node\nif (process.argv.includes("--fake-failure")) process.exit(1);\nrequire("node:fs").writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2)));\n');
  chmodSync(path.join(bin, "flutter"), 0o755);
  const sdk = process.platform === "win32" ? fakeFlutterSdk(path.join(bin, "Flutter SDK with spaces")) : null;
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=Build Test", "-c", "user.email=build@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  const commit = git("rev-parse", "HEAD");
  const capture = path.join(root, "captured.json");
  const run = (...args) => {
    execFileSync(process.execPath, [path.join(tool, "flutter.mjs"), ...args], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CAPTURE: capture, ...(sdk ? { FLUTTER_ROOT: sdk.root } : {}) },
    });
    return JSON.parse(readFileSync(capture, "utf8"));
  };
  const before = Date.now();
  const args = run("build", "apk", "--release", "--dart-define=RELAYUNE_SOURCE_COMMIT=stale");
  const metadataPath = path.join(mobile, "build/relayune-build-info.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  assert.equal(metadata.source_commit, commit);
  assert.equal(metadata.source_dirty, false);
  assert.ok(Date.parse(metadata.built_at) >= before && Date.parse(metadata.built_at) <= Date.now());
  assert.deepEqual(args.slice(-3), [
    `--dart-define=RELAYUNE_BUILT_AT=${metadata.built_at}`,
    `--dart-define=RELAYUNE_SOURCE_COMMIT=${commit}`,
    "--dart-define=RELAYUNE_SOURCE_DIRTY=false",
  ]);
  assert.equal(git("status", "--porcelain"), "", "build metadata must not dirty the source tree");
  writeFileSync(path.join(mobile, "uncommitted.dart"), "// new source\n");
  run("build", "ios", "--simulator");
  assert.equal(JSON.parse(readFileSync(metadataPath)).source_dirty, true);
  const saved = readFileSync(metadataPath, "utf8");
  assert.deepEqual(run("test", "test/startup_test.dart"), ["test", "test/startup_test.dart"]);
  assert.equal(readFileSync(metadataPath, "utf8"), saved, "tests must not replace build provenance");
  assert.deepEqual(run("run", "--use-application-binary=existing.apk"), ["run", "--use-application-binary=existing.apk"]);
  assert.equal(readFileSync(metadataPath, "utf8"), saved, "launching an old binary must not claim a new build");
  assert.throws(() => run("build", "apk", "--fake-failure"));
  assert.equal(readFileSync(metadataPath, "utf8"), saved, "a failed build must not relabel the previous artifact");
});
