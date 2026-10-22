import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, chmod, symlink, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'relayune-account-security-'));
const bundle = join(temporary, 'accounts.cjs');
await build({ entryPoints: ['server/local-accounts.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
const { readSetupToken, localUsername } = createRequire(import.meta.url)(bundle);
test.after(() => rm(temporary, { recursive: true, force: true }));

test('local username normalization rejects emails, injected paths and ambiguous characters', () => {
  assert.equal(localUsername(' Admin '), 'admin');
  for (const value of ['a', 'alice@example.invalid', '../admin', 'admin/name', 'a b', '管理员', 'admin\nother', 'a'.repeat(33), 17, null]) {
    assert.throws(() => localUsername(value), error => error.status === 400);
  }
});

test('HTTP setup token files are outside source and not symlinks or ordinary user secrets', async () => {
  const project = join(temporary, 'project'); await mkdir(project);
  const inside = join(project, 'setup-token'); await writeFile(inside, 'a'.repeat(43), { mode: 0o600 });
  assert.throws(() => readSetupToken(inside, project), /outside_project/);
  assert.throws(() => readSetupToken('relative-file', project), /file_invalid/);
  const outside = join(temporary, 'setup-token'); await writeFile(outside, 'a'.repeat(43), { mode: 0o600 });
  const link = join(temporary, 'setup-link'); await symlink(outside, link);
  assert.throws(() => readSetupToken(link, project));
  await chmod(outside, 0o644);
  assert.throws(() => readSetupToken(outside, project), /file_invalid/);
  await chmod(outside, 0o600);
  if (process.getuid() !== 0) {
    assert.throws(() => readSetupToken(outside, project), /file_invalid/);
  } else {
    assert.equal(readSetupToken(outside, project), 'a'.repeat(43));
  }
});
