import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { inspectCandidates, publicationCandidates, runPublicationAudit } from '../scripts/audit-publication.mjs';

test('publication inspection rejects secrets and external or excluded symlink targets, without reading their contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'publication-inspect-'));
  const root = join(directory, 'repo');
  await mkdir(root);
  try {
    await writeFile(join(root, '.env.local'), 'SYNTHETIC_FIXTURE=not-a-real-secret');
    await writeFile(join(directory, 'outside'), 'SYNTHETIC PRIVATE CONTENT');
    await mkdir(join(root, 'ignored'));
    await writeFile(join(root, 'ignored', 'runtime.json'), '{}');
    await symlink('../outside', join(root, 'external'));
    await symlink('ignored', join(root, 'excluded'));
    const findings = await inspectCandidates(root, ['.env.local', 'external', 'excluded']);
    assert.deepEqual(findings.map(row => row.reason), ['environment_file', 'external_symlink', 'symlink_to_excluded_content']);
    assert.ok(!JSON.stringify(findings).includes('SYNTHETIC PRIVATE CONTENT'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an uncommitted repository is scanned from its actual nonignored candidates and never stages files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'publication-candidates-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
    await writeFile(join(root, '.gitignore'), '.env*\n!.env.example\n');
    await writeFile(join(root, '.env'), 'SYNTHETIC_FIXTURE=not-a-real-secret');
    await writeFile(join(root, '.env.example'), 'SYNTHETIC_FIXTURE=');
    await writeFile(join(root, 'LICENSE'), 'Fixture license text');
    assert.deepEqual(await publicationCandidates(root), ['.env.example', '.gitignore', 'LICENSE']);
    const result = await runPublicationAudit(root);
    assert.equal(result.candidates, 3);
    assert.deepEqual(result.findings, []);
    assert.equal(result.secrets_checked, false);
    assert.equal(spawnSync('git', ['ls-files', '--stage'], { cwd: root, encoding: 'utf8' }).stdout, '');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the real scanner catches a secret in index blobs even after worktree cleanup and ignores inline bypass comments', { skip: !process.env.GITLEAKS_BIN }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'publication-index-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
    await writeFile(join(root, 'LICENSE'), 'Fixture license');
    // This synthetic token is constructed here so the test source itself is not a credential finding.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const synthetic = 'ghp_' + [...randomBytes(36)].map(byte => alphabet[byte % alphabet.length]).join('');
    const content = `const accessToken = '${synthetic}'; // gitleaks:allow\n`;
    const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: content, encoding: 'utf8' });
    assert.equal(blob.status, 0);
    // Only a temporary fixture index is written. No commit is created in any repository.
    assert.equal(spawnSync('git', ['update-index', '--add', '--cacheinfo', `100644,${blob.stdout.trim()},config.js`], { cwd: root }).status, 0);
    await writeFile(join(root, 'config.js'), '// cleaned worktree\n');
    const result = await runPublicationAudit(root, { secrets: true, scanner: process.env.GITLEAKS_BIN });
    assert.ok(result.findings.some(row => row.path === 'index/config.js' && row.reason === 'secret_pattern_requires_review'), JSON.stringify(result));
    assert.ok(!JSON.stringify(result).includes(synthetic));
    const scannerReport = await import('node:fs/promises').then(fs => fs.readFile(join(root, '.public-prep/gitleaks-current.json'), 'utf8'));
    assert.ok(!scannerReport.includes(synthetic));
  } finally { await rm(root, { recursive: true, force: true }); }
});
