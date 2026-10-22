import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const advisory = 'GHSA-vfj7-8cjw-p6xm';
const chain = [
  ['eslint-config-next', '16.3.8'],
  ['@next/eslint-plugin-next', '16.3.8'],
  ['fast-glob', '3.3.1'],
  ['micromatch', '4.0.8'],
  ['braces', '3.0.3'],
];
function requirePolicy(condition, message) {
  if (!condition) throw new Error(message);
}
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonnegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
const sameStrings = (actual, expected) => Array.isArray(actual) &&
  actual.length === expected.length && actual.every((value, index) => value === expected[index]);

// Pure policy evaluation. The caller must run a fresh, complete npm audit;
// the CLI separately verifies capture freshness and the pre-audit lock hash.
export function reviewNpmAudit({ report, npmExitCode, lock, knownRootDevelopmentChain = false }) {
  requirePolicy(Number.isInteger(npmExitCode) && [0, 1].includes(npmExitCode),
    'npm audit must terminate with explicit exit code 0 or 1; errors/signals are not audit findings');
  requirePolicy(record(report) && !Object.hasOwn(report, 'error'), 'npm audit returned an API/error response or invalid JSON object');
  requirePolicy(report.auditReportVersion === 2 && record(report.vulnerabilities), 'Expected npm audit report schema version 2 with a vulnerabilities object');
  requirePolicy(record(lock) && [2, 3].includes(lock.lockfileVersion) && record(lock.packages) && record(lock.packages['']),
    'Expected an npm lockfile version 2 or 3 with package entries');
  const counts = report.metadata?.vulnerabilities;
  requirePolicy(record(counts) && [...severities, 'total'].every((key) => nonnegativeInteger(counts[key])),
    'Audit metadata must provide all nonnegative severity counts');
  requirePolicy(Object.keys(counts).length === severities.length + 1,
    'Audit metadata contains an unknown severity counter');
  requirePolicy(record(report.metadata?.dependencies) &&
    ['prod', 'dev', 'optional', 'peer', 'peerOptional', 'total'].every((key) => nonnegativeInteger(report.metadata.dependencies[key])),
  'Audit metadata must provide valid dependency counters including the audited total');
  requirePolicy(report.metadata.dependencies.total === Object.keys(lock.packages).filter((key) => key !== '').length,
    'Audit dependency count does not match this lockfile; reject a mismatched or stale report');
  const entries = Object.entries(report.vulnerabilities);
  const actualCounts = Object.fromEntries(severities.map((severity) => [severity, 0]));
  for (const [name, item] of entries) {
    requirePolicy(record(item) && item.name === name && severities.includes(item.severity), `Invalid vulnerability record: ${name}`);
    requirePolicy(Array.isArray(item.via) && item.via.length > 0 && Array.isArray(item.effects) &&
      Array.isArray(item.nodes) && item.nodes.length > 0 && typeof item.isDirect === 'boolean' &&
      typeof item.range === 'string' && item.range.length > 0 && Object.hasOwn(item, 'fixAvailable'),
    `Incomplete vulnerability record: ${name}`);
    requirePolicy(typeof item.fixAvailable === 'boolean' || (record(item.fixAvailable) &&
      typeof item.fixAvailable.name === 'string' && item.fixAvailable.name.length > 0 &&
      typeof item.fixAvailable.version === 'string' && item.fixAvailable.version.length > 0 &&
      typeof item.fixAvailable.isSemVerMajor === 'boolean'), `Invalid fixAvailable structure for ${name}`);
    actualCounts[item.severity]++;
  }
  requirePolicy(counts.total === entries.length && severities.every((severity) => counts[severity] === actualCounts[severity]) &&
    severities.reduce((sum, severity) => sum + counts[severity], 0) === counts.total,
  'Audit totals disagree with individual findings; do not trust a summary-only count');
  requirePolicy(npmExitCode === (entries.length ? 1 : 0), 'npm audit exit status disagrees with the full report');
  if (!entries.length) return { status: 'clean', findings: 0, warning: null };

  requirePolicy(knownRootDevelopmentChain, 'Full audit has findings; no known-root development policy was requested');
  requirePolicy(lock.packages[''].name === 'relayune', 'The known development-chain policy applies only to the Relayune root lock');
  requirePolicy(entries.length === chain.length && chain.every(([name]) => Object.hasOwn(report.vulnerabilities, name)),
    'Findings include packages outside the five reviewed development-chain packages');
  for (const [index, [name, version]] of chain.entries()) {
    const item = report.vulnerabilities[name];
    const node = `node_modules/${name}`;
    requirePolicy(item.severity === 'high' && item.isDirect === (index === 0) && sameStrings(item.nodes, [node]),
      `Unexpected severity, directness or affected node for known chain package: ${name}`);
    // npm currently proposes a rejected downgrade of eslint-config-next, not a
    // patched braces release. Any changed remediation is new evidence to review.
    requirePolicy(record(item.fixAvailable) && Object.keys(item.fixAvailable).length === 3 &&
      item.fixAvailable.name === 'eslint-config-next' && item.fixAvailable.version === '14.2.35' &&
      item.fixAvailable.isSemVerMajor === true,
    `Remediation changed for ${name}; do not retain the unresolved-risk exception when a new fix is offered`);
    const matchingNodes = Object.keys(lock.packages).filter((key) => key === node || key.endsWith(`/${node}`));
    requirePolicy(sameStrings(matchingNodes, [node]), `Unexpected additional lock instances of ${name}`);
    const locked = lock.packages[node];
    requirePolicy(record(locked) && locked.version === version && locked.dev === true,
      `Known chain requires exactly ${name}@${version} with dev=true; runtime or changed nodes are forbidden`);
    const expectedEffects = index === 0 ? [] : [chain[index - 1][0]];
    requirePolicy(sameStrings(item.effects, expectedEffects), `Unexpected reverse dependency edge for ${name}`);
    if (index < chain.length - 1) {
      const dependency = chain[index + 1][0];
      requirePolicy(sameStrings(item.via, [dependency]), `New or changed advisory leaf/edge in ${name}`);
      requirePolicy(record(locked.dependencies) && typeof locked.dependencies[dependency] === 'string',
        `Lock does not contain the reviewed dependency edge ${name} -> ${dependency}`);
    } else {
      const leaf = item.via[0];
      requirePolicy(item.via.length === 1 && record(leaf) && leaf.source === 1240992 &&
        leaf.name === 'braces' && leaf.dependency === 'braces' && leaf.severity === 'high' &&
        leaf.url === `https://github.com/advisories/${advisory}` && leaf.range === '<=3.0.3' &&
        typeof leaf.title === 'string' && leaf.title.length > 0,
      'New, missing or changed advisory leaf: only the explicitly disclosed braces GHSA is recognized');
    }
  }
  return {
    status: 'known-unresolved-development-chain',
    findings: 5,
    advisory,
    riskAccepted: false,
    warning: `No additional findings beyond disclosed ${advisory} in the pinned development-only chain. Five high findings remain unresolved; npm's known major-version downgrade suggestion is not adopted. This is not a zero-vulnerability result or maintainer risk approval.`,
  };
}

export function validateAuditCapture({ startedAtMs, nowMs, reportMtimeMs, lockMtimeMs, expectedLockHash, actualLockHash }) {
  requirePolicy(Number.isSafeInteger(startedAtMs) && startedAtMs > 0 && startedAtMs <= nowMs + 1 && nowMs - startedAtMs <= 600_000,
    'Audit start time must be this invocation window (at most ten minutes old), captured before running npm');
  requirePolicy(Number.isFinite(reportMtimeMs) && reportMtimeMs + 1 >= startedAtMs && reportMtimeMs <= nowMs + 1000,
    'Audit report predates this npm invocation or has a future timestamp; create a fresh report file');
  requirePolicy(Number.isFinite(lockMtimeMs) && lockMtimeMs <= startedAtMs + 1,
    'Lockfile changed after npm audit started; rerun the audit against the final lock');
  requirePolicy(typeof expectedLockHash === 'string' && /^[a-f0-9]{64}$/.test(expectedLockHash) && expectedLockHash === actualLockHash,
    'Lock SHA-256 differs from the value captured before npm audit; reject stale or mismatched reports');
}

export async function main(argv) {
  const values = {};
  const keys = new Set(['--report', '--npm-exit-code', '--lock', '--audit-started-at-ms', '--lock-sha256']);
  let knownRootDevelopmentChain = false;
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === '--known-root-development-chain' && !knownRootDevelopmentChain) {
      knownRootDevelopmentChain = true;
    } else {
      requirePolicy(keys.has(key) && !Object.hasOwn(values, key) && argv[index + 1] && !argv[index + 1].startsWith('--'),
        'Usage: node scripts/check-npm-audit.mjs --report FILE --npm-exit-code CODE --lock LOCK --audit-started-at-ms MS --lock-sha256 SHA256 [--known-root-development-chain]');
      values[key] = argv[++index];
    }
  }
  requirePolicy([...keys].every((key) => Object.hasOwn(values, key)), 'All report, explicit exit-code, lock and freshness arguments are required');
  requirePolicy(/^[0-9]+$/.test(values['--npm-exit-code']) && /^[0-9]+$/.test(values['--audit-started-at-ms']),
    'Exit code and audit start time must be explicit nonnegative decimal integers');
  const [reportBytes, lockBytes, reportInfo, lockInfo] = await Promise.all([
    readFile(values['--report']), readFile(values['--lock']), stat(values['--report']), stat(values['--lock']),
  ]);
  validateAuditCapture({ startedAtMs: Number(values['--audit-started-at-ms']), nowMs: Date.now(),
    reportMtimeMs: reportInfo.mtimeMs, lockMtimeMs: lockInfo.mtimeMs,
    expectedLockHash: values['--lock-sha256'], actualLockHash: createHash('sha256').update(lockBytes).digest('hex') });
  const result = reviewNpmAudit({ report: JSON.parse(reportBytes.toString('utf8')),
    npmExitCode: Number(values['--npm-exit-code']), lock: JSON.parse(lockBytes.toString('utf8')), knownRootDevelopmentChain });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.warning) process.stderr.write(`WARNING: ${result.warning}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: 'failed', reason: error.message })}\n`);
    process.exitCode = 1;
  });
}
