import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { collectBundleNotices } from './bundle-notices.mjs';
import { bundleLicenseSupplements } from './license-supplements.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(projectRoot, 'dist', 'self-hosted-server');
const metafile = { inputs: {}, outputs: {} };
const files = [];
for (const [entry, filename] of [
  ['server/self-hosted.ts', 'server.cjs'],
  ['scripts/publish-release-notes.mjs', 'publish-release-notes.cjs'],
  ['scripts/local-account.mjs', 'local-account.cjs'],
]) {
  const result = await build({
    absWorkingDir: projectRoot,
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(output, filename),
    legalComments: 'inline',
    metafile: true,
    write: false,
  });
  Object.assign(metafile.inputs, result.metafile.inputs);
  Object.assign(metafile.outputs, result.metafile.outputs);
  files.push(...result.outputFiles);
}
// Collect before writing artifacts: missing license evidence fails the build.
const { text, coverage } = await collectBundleNotices({ projectRoot, metafile, supplementalLicenseFiles: bundleLicenseSupplements });
const report = {
  ...coverage,
  artifacts: files.map((file) => ({
    file: path.basename(file.path),
    sha256: createHash('sha256').update(file.contents).digest('hex'),
  })),
  limitations: [
    'Covers npm packages from these esbuild input graphs, not the separately installed Node.js runtime or external native modules.',
    'Project LICENSE and third-party licenses apply to their respective components independently.',
  ],
};
await mkdir(output, { recursive: true });
for (const file of files) await writeFile(file.path, file.contents);
await writeFile(path.join(output, 'THIRD_PARTY_LICENSES.txt'), text);
await writeFile(path.join(output, 'THIRD_PARTY_LICENSES.json'), JSON.stringify(report, null, 2) + '\n');
for (const filename of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  const source = path.join(projectRoot, filename);
  if (!(await lstat(source)).isFile()) throw new Error('Project legal documents must be regular repository files.');
  await copyFile(source, path.join(output, filename));
}
console.log('Built Server JavaScript bundles with full notices from their actual esbuild inputs.');
