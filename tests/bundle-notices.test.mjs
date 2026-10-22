import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { collectBundleNotices, collectPackageNotices, collectWebRuntimeNotices } from '../scripts/bundle-notices.mjs';

const mit = await readFile(new URL('../node_modules/esbuild/LICENSE.md', import.meta.url), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function fixture(run) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'relayune-notices-')));
  const lock = { lockfileVersion: 3, packages: { '': { name: 'fixture' } } };
  async function put(relative, value) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, value);
  }
  async function pkg(packagePath, name, version, license = mit, dependencies = {}) {
    await put(`${packagePath}/package.json`, JSON.stringify({ name, version, license: 'MIT', main: 'index.js', dependencies }));
    await put(`${packagePath}/index.js`, 'export const answer = 42;');
    if (license !== null) await put(`${packagePath}/LICENSE`, license);
    lock.packages[packagePath] = { version, resolved: `https://registry.npmjs.org/${name}/-/fixture-${version}.tgz` };
    await put('package-lock.json', JSON.stringify(lock));
  }
  try {
    await put('package.json', JSON.stringify({ name: 'fixture', dependencies: { pkg: '1.0.0' } }));
    await put('LICENSE', 'PROJECT LICENSE MUST REMAIN SEPARATE');
    await pkg('node_modules/pkg', 'pkg', '1.0.0');
    await run({ root, put, pkg, lock });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('actual esbuild output preserves full license, NOTICE and JSON import attributes with traceable hashes', async () => fixture(async ({ root, put }) => {
  await put('node_modules/pkg/NOTICE', 'A package-specific attribution that must survive.');
  await put('value.json', '{"value":7}');
  await put('entry.mjs', 'import {answer} from "pkg"; import value from "./value.json" with {type:"json"}; console.log(answer,value);');
  const built = await build({ absWorkingDir: root, entryPoints: ['entry.mjs'], bundle: true, write: false, metafile: true, platform: 'node' });
  // esbuild adds this suffix when the graph contains distinct import-attribute
  // identities for one JSON file (the real server graph exercises that case).
  const plainJson = Object.keys(built.metafile.inputs).find((key) => key.endsWith('value.json'));
  const annotated = `${plainJson} with { type: 'json' }`;
  built.metafile.inputs[annotated] = built.metafile.inputs[plainJson];
  delete built.metafile.inputs[plainJson];
  for (const output of Object.values(built.metafile.outputs)) {
    if (output.inputs?.[plainJson]) {
      output.inputs[annotated] = output.inputs[plainJson];
      delete output.inputs[plainJson];
    }
  }
  const result = await collectBundleNotices({ projectRoot: root, metafile: built.metafile });
  assert.equal(result.coverage.exact_bundle, true);
  assert.equal(result.coverage.packages[0].name, 'pkg');
  assert.match(result.text, /package-specific attribution/);
  assert.match(result.text, /Permission is hereby granted/);
  assert.ok(!result.text.includes('PROJECT LICENSE MUST REMAIN SEPARATE'));
  assert.ok(!JSON.stringify(result).includes(root));
  assert.equal(result.coverage.packages[0].license_files.find((file) => file.path.endsWith('/LICENSE')).sha256, hash(mit));
  assert.equal(result.coverage.notices_sha256, hash(result.text));
}));

test('missing, label-only, copyright-only and nested-vendor-only licenses do not cover the package itself', async () => {
  for (const license of [null, 'MIT', 'Copyright (c) 2026 Example']) await fixture(async ({ root, put }) => {
    if (license === null) await rm(path.join(root, 'node_modules/pkg/LICENSE'));
    else await put('node_modules/pkg/LICENSE', license);
    await put('node_modules/pkg/dist/vendor/LICENSE', mit);
    await assert.rejects(collectPackageNotices({ projectRoot: root, packages: ['node_modules/pkg'] }), /No complete package-root/);
  });
});

test('reviewed README fallback ends before any following heading and does not copy other license-directory notes', async () => fixture(async ({ root, put, pkg }) => {
  await pkg('node_modules/fastdom', 'fastdom', '1.0.12', null);
  await put('node_modules/fastdom/README.md', `PRIVATE INTRO\n## License\n${mit}\n### Private\nPRIVATE AFTER\n`);
  await put('node_modules/fastdom/licenses/README.md', 'PRIVATE LICENSE DIRECTORY');
  await put('node_modules/fastdom/licenses/internal-notes.md', 'PRIVATE INTERNAL NOTES');
  const result = await collectPackageNotices({ projectRoot: root, packages: ['node_modules/fastdom'] });
  assert.ok(!result.text.includes('PRIVATE'));
  assert.equal(result.coverage.packages[0].license_files[0].section, 'License');
  await pkg('node_modules/unreviewed', 'unreviewed', '1.0.0', null);
  await put('node_modules/unreviewed/README.md', `## License\n${mit}`);
  await assert.rejects(collectPackageNotices({ projectRoot: root, packages: ['node_modules/unreviewed'] }), /No complete/);
}));

test('nested mixed package versions remain distinct and tree-shaken packages are not claimed', async () => fixture(async ({ root, pkg }) => {
  await pkg('node_modules/parent', 'parent', '1.0.0');
  await pkg('node_modules/parent/node_modules/pkg', 'pkg', '2.0.0');
  await pkg('node_modules/unused', 'unused', '1.0.0', null);
  const inputs = { 'node_modules/pkg/index.js': {}, 'node_modules/parent/node_modules/pkg/index.js': {}, 'node_modules/unused/index.js': {} };
  const metafile = { inputs, outputs: { 'out.js': { inputs: Object.fromEntries(Object.keys(inputs).map((key) => [key, { bytesInOutput: key.includes('unused') ? 0 : 20 }])) } } };
  const result = await collectBundleNotices({ projectRoot: root, metafile });
  assert.deepEqual(result.coverage.packages.map((p) => `${p.name}@${p.version}`).sort(), ['pkg@1.0.0', 'pkg@2.0.0']);
}));

test('boundary escapes, external license links, credentialed source URLs and metadata mismatches fail', async () => fixture(async ({ root, put, lock }) => {
  await assert.rejects(collectPackageNotices({ projectRoot: root, packages: ['../outside'] }), /boundary/);
  await assert.rejects(collectPackageNotices({ projectRoot: root, packages: [{ packagePath: 'node_modules/pkg', version: '9.0.0' }] }), /does not match/);
  for (const resolved of ['https://registry.npmjs.org/pkg.tgz?token=private', 'https://user:pass@registry.npmjs.org/pkg.tgz']) {
    lock.packages['node_modules/pkg'].resolved = resolved;
    await put('package-lock.json', JSON.stringify(lock));
    await assert.rejects(collectPackageNotices({ projectRoot: root, packages: ['node_modules/pkg'] }), /credential-free/);
  }
  lock.packages['node_modules/pkg'].resolved = 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz';
  await put('package-lock.json', JSON.stringify(lock));
  const outside = await mkdtemp(path.join(tmpdir(), 'relayune-notices-outside-'));
  try {
    await writeFile(path.join(outside, 'LICENSE'), mit);
    await rm(path.join(root, 'node_modules/pkg/LICENSE'));
    await symlink(path.join(outside, 'LICENSE'), path.join(root, 'node_modules/pkg/LICENSE'));
    await assert.rejects(collectPackageNotices({ projectRoot: root, packages: ['node_modules/pkg'] }), /External symlink/);
  } finally { await rm(outside, { recursive: true, force: true }); }
}));

test('explicit supplemental full texts require matching package id, fixed upstream URL and exact bytes', async () => fixture(async ({ root, put }) => {
  await put('node_modules/pkg/LICENSE', 'SPDX-License-Identifier: MIT');
  await put('evidence/LICENSE-MIT', mit);
  const supplementalLicenseFiles = { 'pkg@1.0.0': [{ path: 'evidence/LICENSE-MIT', sha256: hash(mit), source_url: 'https://github.com/example/pkg/blob/v1.0.0/LICENSE' }] };
  const result = await collectPackageNotices({ projectRoot: root, packages: ['node_modules/pkg'], supplementalLicenseFiles });
  assert.equal(result.coverage.packages[0].license_files[1].supplemental, true);
  supplementalLicenseFiles['pkg@1.0.0'][0].sha256 = '0'.repeat(64);
  await assert.rejects(collectPackageNotices({ projectRoot: root, packages: ['node_modules/pkg'], supplementalLicenseFiles }), /hash\/full-license/);
}));

test('Web dependency closure is labelled a superset and never claims native coverage', async () => fixture(async ({ root }) => {
  const result = await collectWebRuntimeNotices({ projectRoot: root, additionalDependencies: [] });
  assert.equal(result.coverage.exact_bundle, false);
  assert.match(result.text, /NOT an exact bundle inventory/);
  assert.match(result.coverage.excluded.join(' '), /native\/precompiled/);
}));

test('the reviewed Setext README versions retain only their complete License section', async () => fixture(async ({ root, put, pkg }) => {
  await pkg('node_modules/agent-base', 'agent-base', '6.0.2', null);
  await put('node_modules/agent-base/README.md', `PRIVATE INTRO\nLicense\n-------\n${mit}\nPrivate\n-------\nPRIVATE AFTER\n[private]: PRIVATE REFERENCE\n`);
  const result = await collectPackageNotices({ projectRoot: root, packages: ['node_modules/agent-base'] });
  assert.match(result.text, /Permission is hereby granted/);
  assert.ok(!result.text.includes('PRIVATE'));
}));

test('Web alone can report the exact known unresolved marker package, while metadata changes and new gaps fail', async () => fixture(async ({ root, put, pkg }) => {
  await pkg('node_modules/client-only', 'client-only', '0.0.1', null);
  await put('package.json', JSON.stringify({ dependencies: { 'client-only': '0.0.1' } }));
  const packageJson = await readFile(path.join(root, 'node_modules/client-only/package.json'));
  const knownUnresolvedLicenses = { 'client-only@0.0.1': { packagePath: 'node_modules/client-only', packageJsonSha256: hash(packageJson), reason: 'No authentic permission text supplied by publisher; unresolved.' } };
  const result = await collectWebRuntimeNotices({ projectRoot: root, additionalDependencies: [], knownUnresolvedLicenses });
  assert.equal(result.coverage.notices_complete, false);
  assert.equal(result.coverage.risk_accepted, false);
  assert.equal(result.coverage.unresolved.length, 1);
  assert.match(result.text, /UNRESOLVED LICENSE EVIDENCE/);
  await assert.rejects(collectPackageNotices({ projectRoot: root, packages: ['node_modules/client-only'] }), /No complete/);
  await put('node_modules/client-only/package.json', JSON.stringify({ ...JSON.parse(packageJson), license: 'GPL-3.0' }));
  await assert.rejects(collectWebRuntimeNotices({ projectRoot: root, additionalDependencies: [], knownUnresolvedLicenses }), /metadata hash changed/);
  await put('node_modules/client-only/package.json', packageJson);
  await pkg('node_modules/unknown', 'unknown', '1.0.0', null);
  await put('package.json', JSON.stringify({ dependencies: { 'client-only': '0.0.1', unknown: '1.0.0' } }));
  await assert.rejects(collectWebRuntimeNotices({ projectRoot: root, additionalDependencies: [], knownUnresolvedLicenses }), /unknown@1.0.0/);
}));

test('Dijkstra standard terms stay separate from its original publisher attribution and reject changed declarations', async () => fixture(async ({ root, put, pkg }) => {
  await pkg('node_modules/dijkstrajs', 'dijkstrajs', '1.0.3', null);
  const original = 'Copyright (C) 2008 Wyatt Baldwin\nLicensed under the MIT license.\nhttp://www.opensource.org/licenses/mit-license.php\n';
  await put('node_modules/dijkstrajs/LICENSE.md', original);
  const standard = await readFile(new URL('../scripts/license-evidence/SPDX-MIT-standard-terms.txt', import.meta.url), 'utf8');
  await put('evidence/MIT.txt', standard);
  const supplementalLicenseFiles = { 'dijkstrajs@1.0.3': [{ path: 'evidence/MIT.txt', sha256: hash(standard),
    source_url: 'https://raw.githubusercontent.com/spdx/license-list-data/d46e94e2c78ceede1cfc63cfa0396472d2798d4c/text/MIT.txt', kind: 'standard-license-terms',
    publisher_declaration: { path: 'node_modules/dijkstrajs/LICENSE.md', sha256: hash(original), source_url: 'https://raw.githubusercontent.com/tcort/dijkstrajs/v1.0.3/LICENSE.md' } }] };
  const result = await collectPackageNotices({ projectRoot: root, packages: ['node_modules/dijkstrajs'], supplementalLicenseFiles });
  assert.match(result.text, /2008 Wyatt Baldwin/);
  assert.ok(result.text.includes('Copyright (c) <year> <copyright holders>'));
  assert.equal(result.coverage.packages[0].license_files.find((file) => file.supplemental).evidence_kind, 'standard-license-terms');
  await put('node_modules/dijkstrajs/LICENSE.md', 'MIT');
  await assert.rejects(collectPackageNotices({ projectRoot: root, packages: ['node_modules/dijkstrajs'], supplementalLicenseFiles }), /Publisher declaration/);
}));
