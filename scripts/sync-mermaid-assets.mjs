import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { isDependencyDirectory, isDependencyInput } from './mermaid-package-paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const check = process.argv.includes('--check');

// Build from the ESM sources, not the upstream prebuilt browser bundle: a
// patched npm override does not change dependencies embedded in that bundle.
const result = await build({
  absWorkingDir: root,
  stdin: { contents: 'export { default } from "mermaid";', resolveDir: root },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: '__relayuneMermaidModule',
  footer: { js: 'globalThis.mermaid = __relayuneMermaidModule.default;' },
  minify: true,
  legalComments: 'inline',
  metafile: true,
  write: false,
});
const runtime = result.outputFiles[0].contents;
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!isDependencyInput(input)) continue;
  let directory = dirname(resolve(root, input));
  while (isDependencyDirectory(root, directory)) {
    try {
      const value = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
      if (value.name && value.version) {
        packages.set(`${value.name}@${value.version}`, { name: value.name, version: value.version });
        break;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    directory = dirname(directory);
  }
}
const bundledPackages = [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
for (const name of ['mermaid', 'katex', 'dompurify']) {
  assert.ok(bundledPackages.some((item) => item.name === name), `${name} must be present in the actual ESM bundle inputs`);
}
const metadata = Buffer.from(JSON.stringify({
  source: 'Mermaid ESM entry and installed locked dependencies, built with scripts/sync-mermaid-assets.mjs',
  runtime_sha256: hash(runtime),
  root_lock_sha256: hash(await readFile(resolve(root, 'package-lock.json'))),
  bundler: JSON.parse(await readFile(resolve(root, 'node_modules/esbuild/package.json'), 'utf8')).version,
  bundled_packages: bundledPackages,
}, null, 2) + '\n');
const license = await readFile(resolve(root, 'node_modules/mermaid/LICENSE'));
for (const directory of ['mobile/assets/mermaid', 'public/mermaid']) {
  if (!check) await mkdir(resolve(root, directory), { recursive: true });
  for (const [file, bytes] of [['mermaid.min.js', runtime], ['LICENSE', license], ['BUILD.json', metadata]]) {
    const target = resolve(root, directory, file);
    if (check) assert.deepEqual(await readFile(target), Buffer.from(bytes), `stale Mermaid asset: ${directory}/${file}`);
    else await writeFile(target, bytes);
  }
}
console.log(`${check ? 'Verified' : 'Built'} offline Mermaid runtime: ${bundledPackages.length} actual packages, SHA-256 ${hash(runtime)}`);
