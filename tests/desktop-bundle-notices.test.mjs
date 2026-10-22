import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { desktopBundleNoticesPlugin, writeDesktopBundleNotices } from "../desktop/scripts/bundle-notices.mjs";

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relayune-js-notices-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const license = await readFile(new URL("../desktop/node_modules/qrcode/license", import.meta.url), "utf8");
  const files = {
    "LICENSE": "Synthetic project license fixture\n",
    "package.json": JSON.stringify({ name: "notice-fixture", version: "1.0.0" }),
    "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {
      "": { name: "notice-fixture", version: "1.0.0" },
      "node_modules/notice-used": { version: "1.0.0", license: "MIT", resolved: "https://registry.npmjs.org/notice-used/-/notice-used-1.0.0.tgz", integrity: "sha512-synthetic-fixture" },
      "node_modules/notice-unused": { version: "1.0.0", license: "MIT", resolved: "https://registry.npmjs.org/notice-unused/-/notice-unused-1.0.0.tgz", integrity: "sha512-synthetic-fixture" },
    } }),
    "node_modules/notice-used/package.json": JSON.stringify({ name: "notice-used", version: "1.0.0", license: "MIT", main: "index.js" }),
    "node_modules/notice-used/index.js": "/*! Synthetic fixture copyright notice */\nexport const value = () => 42;\n",
    "node_modules/notice-used/LICENSE": license,
    // A parsed but unused module deliberately has no license file. It must not
    // be treated as an embedded dependency when its output contribution is zero.
    "node_modules/notice-unused/package.json": JSON.stringify({ name: "notice-unused", version: "1.0.0", license: "MIT", main: "index.js", sideEffects: false }),
    "node_modules/notice-unused/index.js": "export const unused = () => 'unused';\n",
    "entry.js": "import {value} from 'notice-used'; import {unused} from 'notice-unused'; console.log(value());\n",
    "desktop/node_modules/@yao-pkg/pkg/package.json": JSON.stringify({ name: "@yao-pkg/pkg", version: "0.0.0-fixture" }),
    "desktop/package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {
      "node_modules/@yao-pkg/pkg": { version: "0.0.0-fixture", license: "MIT", resolved: "https://registry.npmjs.org/@yao-pkg/pkg/-/pkg-0.0.0-fixture.tgz" },
      "node_modules/@yao-pkg/pkg-fetch": { version: "0.0.0-fixture", license: "MIT", resolved: "https://registry.npmjs.org/@yao-pkg/pkg-fetch/-/pkg-fetch-0.0.0-fixture.tgz" },
    } }),
    "desktop/node_modules/@yao-pkg/pkg/LICENSE": license,
    "desktop/node_modules/@yao-pkg/pkg-fetch/package.json": JSON.stringify({ name: "@yao-pkg/pkg-fetch", version: "0.0.0-fixture" }),
    "desktop/node_modules/@yao-pkg/pkg-fetch/license.md": license,
    "desktop/node_modules/@yao-pkg/pkg-fetch/patches/patches.json": JSON.stringify({ "v22.0.0": [], "v24.0.0": [] }),
  };
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), text);
  }
  return { root, license };
}

test("sidecar JS bundle notices include full actual dependency licenses before any native packaging", async (t) => {
  const { root, license } = await fixture(t);
  const bundle = await build({ absWorkingDir: root, entryPoints: ["entry.js"], outfile: "sidecar.cjs", platform: "node", format: "cjs", bundle: true, metafile: true, write: false, legalComments: "inline" });
  assert.match(bundle.outputFiles[0].text, /Synthetic fixture copyright notice/);
  const output = join(root, "output-notices");
  const resources = join(root, "desktop", "src-tauri", "resources", "generated-notices", "sidecar-js");
  const coverage = await writeDesktopBundleNotices({ repositoryDirectory: root, outputDirectory: output, resourceDirectory: resources, metafile: bundle.metafile, artifactName: "sidecar-javascript" });
  assert.deepEqual(coverage.packages.map((item) => item.name), ["notice-used"]);
  assert.equal(coverage.exact_bundle, true);
  assert.equal(coverage.native_artifact_verified, false);
  assert.equal(coverage.native_runtime_review.status, "unverified");
  assert.match(coverage.packaging_tool_evidence.verification, /have not been inspected/);
  assert.deepEqual(coverage.packaging_tool_evidence.packages.map((item) => item.name), ["@yao-pkg/pkg", "@yao-pkg/pkg-fetch"]);
  for (const file of ["THIRD_PARTY_NOTICES.txt", "COVERAGE.json", "PROJECT-LICENSE.txt", "PACKAGING-TOOL-NOTICES.txt"]) {
    assert.deepEqual(await readFile(join(output, file)), await readFile(join(resources, file)));
  }
  assert.ok((await readFile(join(output, "THIRD_PARTY_NOTICES.txt"), "utf8")).includes(license.trim()));
});

test("sidecar packaging tool notices reject a symlink to an outside license before copying resources", async (t) => {
  const { root } = await fixture(t);
  const outside = await realpath(await mkdtemp(join(tmpdir(), "relayune-outside-license-")));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "private.txt"), "Synthetic external private fixture\n");
  const license = join(root, "desktop", "node_modules", "@yao-pkg", "pkg", "LICENSE");
  await rm(license);
  try { await symlink(join(outside, "private.txt"), license); }
  catch (error) { if (process.platform === "win32" && error.code === "EPERM") { t.skip("Windows file symlinks require Developer Mode or appropriate privilege"); return; } throw error; }
  await assert.rejects(writeDesktopBundleNotices({ repositoryDirectory: root, outputDirectory: join(root, "output"), resourceDirectory: join(root, "resources"), moduleIds: [join(root, "node_modules", "notice-used", "index.js")], artifactName: "sidecar-javascript" }), /symlink|escape|boundary/i);
});

test("Desktop notices reject a project LICENSE symlink even to an internal ignored source", async (t) => {
  const { root } = await fixture(t);
  const ignored = join(root, ".public-prep", "private.txt");
  await mkdir(dirname(ignored));
  await writeFile(ignored, "Synthetic private review material\n");
  await rm(join(root, "LICENSE"));
  try { await symlink(ignored, join(root, "LICENSE")); }
  catch (error) { if (process.platform === "win32" && error.code === "EPERM") { t.skip("Windows file symlinks require Developer Mode or appropriate privilege"); return; } throw error; }
  await assert.rejects(writeDesktopBundleNotices({ repositoryDirectory: root, outputDirectory: join(root, "output"), resourceDirectory: join(root, "resources"), moduleIds: [join(root, "node_modules", "notice-used", "index.js")], artifactName: "desktop-web-javascript" }), /regular file.*symlink/i);
});

test("Vite notices use emitted nonzero chunk modules and copy only their own generated resource subtree", async (t) => {
  const { root, license } = await fixture(t);
  const desktop = join(root, "desktop");
  const otherNotice = join(desktop, "src-tauri", "resources", "generated-notices", "sidecar-js", "keep.txt");
  await mkdir(dirname(otherNotice), { recursive: true });
  await writeFile(otherNotice, "separate bundle notice");
  const plugin = desktopBundleNoticesPlugin({ desktopDirectory: desktop, repositoryDirectory: root });
  plugin.generateBundle({}, {
    "app.js": { type: "chunk", modules: {
      [join(root, "node_modules", "notice-used", "index.js")]: { renderedLength: 10 },
      [join(root, "node_modules", "notice-unused", "index.js")]: { renderedLength: 0 },
    } },
    "app.css": { type: "asset" },
  });
  const output = join(desktop, "dist");
  await plugin.writeBundle({ dir: output });
  const target = join(output, "third-party-notices");
  const coverage = JSON.parse(await readFile(join(target, "COVERAGE.json"), "utf8"));
  assert.deepEqual(coverage.packages.map((item) => item.name), ["notice-used"]);
  assert.ok((await readFile(join(target, "THIRD_PARTY_NOTICES.txt"), "utf8")).includes(license.trim()));
  assert.equal(await readFile(otherNotice, "utf8"), "separate bundle notice");
  assert.deepEqual(await readFile(join(target, "COVERAGE.json")), await readFile(join(desktop, "src-tauri", "resources", "generated-notices", "desktop-web", "COVERAGE.json")));
});
