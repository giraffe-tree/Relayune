import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { reviewNpmAudit, validateAuditCapture } from '../scripts/check-npm-audit.mjs';

const packages = [
  ['eslint-config-next', '16.3.8'], ['@next/eslint-plugin-next', '16.3.8'],
  ['fast-glob', '3.3.1'], ['micromatch', '4.0.8'], ['braces', '3.0.3'],
];
function fixture(findings = true) {
  const lock = { lockfileVersion: 3, packages: { '': { name: 'relayune' } } };
  const vulnerabilities = {};
  for (const [index, [name, version]] of packages.entries()) {
    const next = packages[index + 1]?.[0];
    lock.packages[`node_modules/${name}`] = { version, dev: true, dependencies: next ? { [next]: '*' } : {} };
    if (findings) vulnerabilities[name] = {
      name, severity: 'high', isDirect: index === 0,
      via: next ? [next] : [{ source: 1240992, name: 'braces', dependency: 'braces',
        title: 'braces deeply nested pattern stack exhaustion', severity: 'high', range: '<=3.0.3',
        url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' }],
      effects: index ? [packages[index - 1][0]] : [],
      range: '*', nodes: [`node_modules/${name}`],
      fixAvailable: { name: 'eslint-config-next', version: '14.2.35', isSemVerMajor: true },
    };
  }
  return { lock, npmExitCode: findings ? 1 : 0, knownRootDevelopmentChain: true,
    report: { auditReportVersion: 2, vulnerabilities, metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: findings ? 5 : 0, critical: 0, total: findings ? 5 : 0 },
      dependencies: { prod: 0, dev: 5, optional: 0, peer: 0, peerOptional: 0, total: 5 },
    } } };
}

test('zero findings requires a full coherent report and npm exit zero', () => {
  const input = fixture(false);
  assert.deepEqual(reviewNpmAudit(input), { status: 'clean', findings: 0, warning: null });
  input.npmExitCode = 1;
  assert.throws(() => reviewNpmAudit(input), /exit status disagrees/);
});

test('only the exact known high development chain produces an unresolved-risk warning', () => {
  const result = reviewNpmAudit(fixture());
  assert.equal(result.status, 'known-unresolved-development-chain');
  assert.equal(result.riskAccepted, false);
  assert.equal(result.findings, 5);
  assert.match(result.warning, /not a zero-vulnerability result or maintainer risk approval/);
  const strict = fixture();
  strict.knownRootDevelopmentChain = false;
  assert.throws(() => reviewNpmAudit(strict), /no known-root development policy/);
});

test('API errors and non-finding process failures cannot pass as clean reports', () => {
  for (const report of [{ error: { code: 'ENOAUDIT' } }, { ...fixture(false).report, error: {} }]) {
    assert.throws(() => reviewNpmAudit({ ...fixture(false), report }), /API\/error/);
  }
  for (const npmExitCode of [2, 127, null, undefined, -1, '0']) {
    assert.throws(() => reviewNpmAudit({ ...fixture(false), npmExitCode }), /explicit exit code/);
  }
});

test('invalid schemas, missing records and contradictory totals are rejected', () => {
  const cases = [
    (x) => { x.report.auditReportVersion = 1; },
    (x) => { x.report.vulnerabilities = []; },
    (x) => { delete x.report.metadata; },
    (x) => { x.report.metadata.vulnerabilities.total = 0; },
    (x) => { x.report.metadata.vulnerabilities.high = 0; },
    (x) => { x.report.metadata.dependencies.total = 4; },
    (x) => { x.report.metadata.dependencies.prod = '0'; },
    (x) => { x.report.metadata.vulnerabilities.unknownSeverity = 1; },
    (x) => { delete x.report.vulnerabilities.braces.via; },
    (x) => { x.report.vulnerabilities.braces.fixAvailable = 'yes'; },
    (x) => { delete x.lock.packages; },
  ];
  for (const change of cases) {
    const input = fixture(); change(input);
    assert.throws(() => reviewNpmAudit(input));
  }
});

test('a new advisory cannot hide behind a previously recognized package chain', () => {
  for (const parent of ['braces', 'fast-glob']) {
    const input = fixture();
    input.report.vulnerabilities[parent].via.push({ ...input.report.vulnerabilities.braces.via[0],
      source: 9999999, url: 'https://github.com/advisories/GHSA-new0-new0-new0' });
    assert.throws(() => reviewNpmAudit(input), /New|changed/);
  }
  const changed = fixture();
  changed.report.vulnerabilities.braces.via[0].url = 'https://github.com/advisories/GHSA-new0-new0-new0';
  assert.throws(() => reviewNpmAudit(changed), /advisory leaf/);
});

test('runtime nodes, extra nested copies, changed versions and changed graph edges fail', () => {
  const cases = [
    (x) => { x.lock.packages['node_modules/braces'].dev = false; },
    (x) => { delete x.lock.packages['node_modules/micromatch'].dev; },
    (x) => { x.lock.packages['node_modules/braces'].version = '3.0.4'; },
    (x) => { x.report.vulnerabilities['fast-glob'].via = ['braces']; },
    (x) => { x.report.vulnerabilities.braces.effects = ['eslint-config-next']; },
    (x) => { delete x.lock.packages['node_modules/micromatch'].dependencies.braces; },
    (x) => { x.lock.packages[''].name = 'relayune-desktop'; },
    (x) => {
      x.lock.packages['node_modules/runtime/node_modules/braces'] = { version: '3.0.3', dev: false };
      x.report.metadata.dependencies.total++;
    },
  ];
  for (const change of cases) {
    const input = fixture(); change(input);
    assert.throws(() => reviewNpmAudit(input));
  }
});

test('critical findings and unrelated vulnerable packages are never recognized as the known risk', () => {
  const critical = fixture();
  critical.report.vulnerabilities.braces.severity = 'critical';
  critical.report.metadata.vulnerabilities.high = 4;
  critical.report.metadata.vulnerabilities.critical = 1;
  assert.throws(() => reviewNpmAudit(critical), /Unexpected severity/);
  const extra = fixture();
  extra.report.vulnerabilities.other = { ...extra.report.vulnerabilities.braces, name: 'other', nodes: ['node_modules/other'] };
  extra.report.metadata.vulnerabilities.high++;
  extra.report.metadata.vulnerabilities.total++;
  assert.throws(() => reviewNpmAudit(extra), /outside the five/);
});

test('a new remediation for the same advisory closes the existing unresolved-risk exception', () => {
  for (const fixAvailable of [true, false,
    { name: 'braces', version: '3.0.4', isSemVerMajor: false },
    { name: 'eslint-config-next', version: '16.3.9', isSemVerMajor: false },
    { name: 'eslint-config-next', version: '14.2.36', isSemVerMajor: true }]) {
    const input = fixture();
    input.report.vulnerabilities.braces.fixAvailable = fixAvailable;
    assert.throws(() => reviewNpmAudit(input), /Remediation changed/);
  }
});

test('capture validation rejects stale files, changed locks and old invocation timestamps', () => {
  const input = { startedAtMs: 9000, nowMs: 10000, reportMtimeMs: 9000, lockMtimeMs: 8000,
    expectedLockHash: 'a'.repeat(64), actualLockHash: 'a'.repeat(64) };
  validateAuditCapture(input);
  validateAuditCapture({ ...input, reportMtimeMs: 8999.5 }); // Sub-millisecond stat rounding.
  for (const replacement of [{ reportMtimeMs: 8998 }, { lockMtimeMs: 9002 },
    { actualLockHash: 'b'.repeat(64) }, { nowMs: 610000 }, { reportMtimeMs: 12000 }, { startedAtMs: null }]) {
    assert.throws(() => validateAuditCapture({ ...input, ...replacement }));
  }
});

test('CLI reads a fresh JSON capture, emits a warning and leaves both files unchanged', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'relayune-npm-audit-policy-'));
  try {
    const input = fixture();
    const lockPath = path.join(directory, 'lock.json');
    const reportPath = path.join(directory, 'audit.json');
    const lockBytes = JSON.stringify(input.lock);
    await writeFile(lockPath, lockBytes);
    const startedAt = Date.now();
    const reportBytes = JSON.stringify(input.report);
    await writeFile(reportPath, reportBytes);
    const command = fileURLToPath(new URL('../scripts/check-npm-audit.mjs', import.meta.url));
    const args = [command, '--report', reportPath, '--lock', lockPath, '--npm-exit-code', '1',
      '--audit-started-at-ms', String(startedAt), '--lock-sha256', createHash('sha256').update(lockBytes).digest('hex'),
      '--known-root-development-chain'];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).riskAccepted, false);
    assert.match(result.stderr, /WARNING:/);
    assert.equal(await readFile(lockPath, 'utf8'), lockBytes);
    assert.equal(await readFile(reportPath, 'utf8'), reportBytes);
    const missingExit = spawnSync(process.execPath, args.filter((arg, i) => arg !== '--npm-exit-code' && args[i - 1] !== '--npm-exit-code'), { encoding: 'utf8' });
    assert.equal(missingExit.status, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
