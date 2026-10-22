import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

test('hidden password input preserves split Unicode and code-point backspace without echo', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'relayune-account-cli-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const file = join(temporary, 'fixture.cjs');
  await build({ entryPoints: ['scripts/local-account.mjs'], outfile: file, bundle: true,
    platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' });
  const { readHiddenPassword } = createRequire(import.meta.url)(file);
  const input = new PassThrough(); input.isTTY = true; input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  let echoed = ''; const output = { write: value => { echoed += value; } };
  const promise = readHiddenPassword(input, output);
  const utf8 = Buffer.from('测试');
  input.write(utf8.subarray(0, 1)); input.write(utf8.subarray(1, 4)); input.write(utf8.subarray(4));
  input.write(Buffer.from('🔒')); input.write(Buffer.from('\u007f'));
  input.write(Buffer.from('-synthetic-password\r'));
  assert.equal(await promise, '测试-synthetic-password');
  assert.equal(echoed, '\n'); assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount('data'), 0);
  const cancellation = readHiddenPassword(input, output);
  input.write(Buffer.from('\u0003'));
  await assert.rejects(cancellation, /cancelled/);
  assert.equal(input.isRaw, false); assert.equal(input.listenerCount('data'), 0);
});
