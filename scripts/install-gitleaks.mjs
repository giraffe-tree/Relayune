// Explicit local developer tool download. Pin and verify before extraction/execution.
import { createHash } from 'node:crypto';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = '8.30.1';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) throw new Error('Scanner installation requires Node.js >=22.13.0.');
const platforms = {
  'darwin-arm64': ['darwin_arm64', 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5'],
  'linux-x64': ['linux_x64', '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'],
};
const target = platforms[`${process.platform}-${process.arch}`];
if (!target) throw new Error('Use an independently verified Gitleaks 8.30.1 binary for this platform and set GITLEAKS_BIN.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, '.public-prep', 'tools');
await mkdir(directory, { recursive: true });
const filename = `gitleaks_${version}_${target[0]}.tar.gz`;
const response = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${version}/${filename}`, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error(`Official scanner download failed (${response.status}).`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== target[1]) throw new Error('Scanner archive checksum mismatch.');
const archive = join(directory, filename);
await writeFile(archive, bytes);
// Extract only the named executable, never arbitrary archive paths.
const result = spawnSync('tar', ['-xzf', archive, '-C', directory, 'gitleaks'], { stdio: 'pipe' });
if (result.status !== 0) throw new Error('Scanner archive extraction failed.');
await chmod(join(directory, 'gitleaks'), 0o755);
console.log(`Verified Gitleaks ${version}: .public-prep/tools/gitleaks`);
