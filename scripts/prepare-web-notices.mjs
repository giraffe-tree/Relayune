import { copyFile, lstat, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectWebRuntimeNotices } from './bundle-notices.mjs';
import { bundleLicenseSupplements } from './license-supplements.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(projectRoot, 'out');
if (!(await stat(output)).isDirectory()) throw new Error('Build the static Web export first.');

// Next does not expose an esbuild metafile. This is explicitly a dependency
// superset, not a claim to know the exact packages in each Turbopack chunk.
const { text, coverage } = await collectWebRuntimeNotices({
  projectRoot,
  supplementalLicenseFiles: bundleLicenseSupplements,
  excludeVerifiedWebArtifacts: true,
});
await writeFile(path.join(output, 'THIRD_PARTY_LICENSES.txt'), text);
await writeFile(path.join(output, 'THIRD_PARTY_LICENSES.json'), JSON.stringify(coverage, null, 2) + '\n');
for (const filename of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  const source = path.join(projectRoot, filename);
  if (!(await lstat(source)).isFile()) throw new Error('Project legal documents must be regular repository files.');
  await copyFile(source, path.join(output, filename));
}
console.log('Web notices written from the installed runtime dependency superset with the separately verified artifact-only exclusion. Native binaries and complete embedded-component legal clearance remain outside this report.');
if (coverage.notices_complete === false) {
  console.warn('Web license evidence remains incomplete: see THIRD_PARTY_LICENSES.json unresolved entries. Generating these files is not distribution approval.');
}
