// Inspect the actual Git candidate set. Never stage, commit, push, or follow an external symlink.
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, realpath, rm, mkdir, copyFile, readlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function forbiddenCandidate(path) {
  const name = path.split('/').at(-1);
  if (/(^|\/)(?:node_modules|\.next|\.dart_tool|Pods|target|\.public-prep|__pycache__)(?:\/|$)/.test(path)) return 'local_dependency_or_cache';
  if (/^(?:dist|out|outputs|output|data|private|secrets|\.secrets|work|\.codex-relay|\.codex-deploy)\//.test(path)) return 'local_output_or_private_archive';
  if (/^docs\/(?:qa\/runs|research|app-store)\//.test(path)) return 'private_archive';
  if (/^\.env(?:\.|$)/.test(name) && !/^\.env(?:\..+)?\.example$/.test(name)) return 'environment_file';
  if (/\.(?:p8|p12|pfx|pem|key|jks|keystore|mobileprovision|provisionprofile|sqlite3?|sqlite3?-(?:wal|shm|journal)|log|py[co]|apk|aab|ipa|dmg)$/i.test(name)) return 'credential_or_runtime_file';
  if (/^(?:id_rsa|id_ed25519|\.npmrc|\.netrc|key\.properties|push\.local\.properties)$/.test(name)) return 'credential_configuration';
  if (/^mobile\/android\/local\.properties$/.test(path)) return 'machine_configuration';
  return null;
}

export async function publicationCandidates(root) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Git candidate enumeration failed; initialize or select the repository explicitly.');
  return [...new Set(result.stdout.split('\0').filter(Boolean))].sort();
}

export async function inspectCandidates(root, candidates) {
  const findings = [];
  const canonicalRoot = await realpath(root);
  for (const path of candidates) {
    const blocked = forbiddenCandidate(path);
    if (blocked) findings.push({ path, reason: blocked });
    const target = join(root, path);
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) {
      try {
        const destination = await realpath(target);
        const rel = relative(canonicalRoot, destination);
        if (isAbsolute(rel) || rel.split(sep)[0] === '..') findings.push({ path, reason: 'external_symlink' });
        else if (!candidates.some(candidate => candidate === rel || candidate.startsWith(`${rel}/`))) findings.push({ path, reason: 'symlink_to_excluded_content' });
      } catch { findings.push({ path, reason: 'broken_symlink' }); }
    } else if (!stat.isFile()) findings.push({ path, reason: 'unsupported_file_type' });
  }
  return findings;
}

export async function runPublicationAudit(root, { secrets = false, scanner = 'gitleaks' } = {}) {
  const candidates = await publicationCandidates(root);
  const findings = await inspectCandidates(root, candidates);
  const indexResult = spawnSync('git', ['ls-files', '--stage', '-z'], { cwd: root, encoding: 'utf8' });
  if (indexResult.status !== 0) throw new Error('Git index enumeration failed.');
  const index = [];
  for (const row of indexResult.stdout.split('\0').filter(Boolean)) {
    const match = /^(\d+) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(row);
    if (!match || match[3] !== '0' || !['100644', '100755', '120000'].includes(match[1])) throw new Error('Unmerged index or unsupported Git object requires manual review.');
    const blob = spawnSync('git', ['cat-file', 'blob', match[2]], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
    if (blob.status !== 0) throw new Error('Git index blob could not be read.');
    const entry = { mode: match[1], path: match[4], data: blob.stdout };
    if (entry.mode === '120000' && entry.data.toString('utf8') !== await readlink(join(root, entry.path))) findings.push({ path: entry.path, reason: 'index_symlink_differs_from_inspected_worktree' });
    index.push(entry);
  }
  if (!candidates.includes('LICENSE')) findings.push({ path: 'LICENSE', reason: 'project_license_missing' });
  if (findings.length || !secrets) return { candidates: candidates.length, secrets_checked: false, findings };
  const temporary = await mkdtemp(join(tmpdir(), 'relayune-publication-'));
  try {
    // Copy regular candidate files only. Symlinks were inspected above and are omitted
    // here: their in-repository contents are scanned at their original candidate paths.
    for (const path of candidates) {
      const source = join(root, path);
      if ((await lstat(source)).isSymbolicLink()) continue;
      await mkdir(dirname(join(temporary, 'working-tree', path)), { recursive: true });
      await copyFile(source, join(temporary, 'working-tree', path));
    }
    // The index may differ from the worktree. Scan the exact blobs that would be
    // committed as well, so removing a staged secret only on disk cannot pass.
    for (const entry of index) {
      if (entry.mode === '120000') continue;
      await mkdir(dirname(join(temporary, 'index', entry.path)), { recursive: true });
      await writeFile(join(temporary, 'index', entry.path), entry.data);
    }
    const reportDirectory = join(root, '.public-prep');
    await mkdir(reportDirectory, { recursive: true });
    const report = join(reportDirectory, 'gitleaks-current.json');
    await rm(report, { force: true });
    const fingerprintIgnores = join(temporary, '.empty-fingerprint-ignores');
    await writeFile(fingerprintIgnores, '');
    const args = ['dir', temporary, '--no-banner', '--redact=100', '--ignore-gitleaks-allow', '--gitleaks-ignore-path', fingerprintIgnores, '--report-format=json', '--report-path', report];
    if (existsSync(join(root, '.gitleaks.toml'))) args.push('--config', join(root, '.gitleaks.toml'));
    const scanned = spawnSync(scanner, args, { cwd: root, encoding: 'utf8' });
    // Do not echo a scanner's raw stdout/stderr: even error output may contain data.
    if (scanned.error) throw new Error('Gitleaks could not start. Install the pinned scanner or set GITLEAKS_BIN.');
    if (![0, 1].includes(scanned.status)) throw new Error(`Gitleaks failed with status ${scanned.status}; inspect local tool configuration.`);
    const rows = JSON.parse(await readFile(report, 'utf8')) ?? [];
    if (!Array.isArray(rows) || (scanned.status === 1 && !rows.length)) throw new Error('Gitleaks reported findings without a usable report.');
    const redacted = rows.map(row => ({ path: relative(temporary, row.File).split(sep).join('/'), line: row.StartLine, rule: row.RuleID }));
    // Replace the raw report (even its redacted match contexts) with locations only.
    await writeFile(report, `${JSON.stringify(redacted, null, 2)}\n`);
    return { candidates: candidates.length, secrets_checked: true, findings: [...findings, ...redacted.map(row => ({ ...row, reason: 'secret_pattern_requires_review' }))] };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('Publication checks require Node.js >=22.13.0.');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await runPublicationAudit(root, { secrets: process.argv.includes('--secrets'), scanner: process.env.GITLEAKS_BIN || 'gitleaks' });
  console.log(JSON.stringify(result, null, 2));
  if (result.findings.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  console.error(error.message);
  process.exitCode = 2;
});
