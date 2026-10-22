import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizeWebProvenance, webBuildInputs } from './web-license-provenance.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const initialInputs = await webBuildInputs(projectRoot);
const status = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(projectRoot, 'node_modules/next/dist/bin/next'), 'build'], {
    cwd: projectRoot, stdio: 'inherit', env: { ...process.env, RELAY_LICENSE_PROVENANCE: '1' },
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => signal ? reject(new Error(`Next build terminated: ${signal}`)) : resolve(code));
});
if (status !== 0) process.exit(status ?? 1);
// Locale correction also updates serialized Flight JSON. Bind its final bytes,
// rather than approving a pre-correction HTML script inventory.
const localeStatus = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(projectRoot, 'scripts/fix-static-document-languages.mjs')], {
    cwd: projectRoot, stdio: 'inherit', env: process.env,
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => signal ? reject(new Error(`Locale correction terminated: ${signal}`)) : resolve(code));
});
if (localeStatus !== 0) process.exit(localeStatus ?? 1);
const evidence = await finalizeWebProvenance({ projectRoot, initialInputs });
console.log(`Verified ${evidence.javascript_count} actual Next JavaScript files; removed private source maps from out. client-only@0.0.1 is absent from this artifact; other license scope limits remain.`);
