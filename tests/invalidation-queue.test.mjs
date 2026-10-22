import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const temporary = await mkdtemp(join(tmpdir(), 'invalidation-queue-'));
const bundle = join(temporary, 'queue.mjs');
await build({ entryPoints: ['app/invalidation-queue.ts'], outfile: bundle, bundle: true, format: 'esm', logLevel: 'silent' });
const { createInvalidationQueue } = await import(pathToFileURL(bundle));
test.after(() => rm(temporary, { recursive: true, force: true }));

test('twenty queued signals drain once; notifications during a request trigger exactly one trailing drain', async () => {
  const batches = [];
  let release;
  const blocker = new Promise(resolve => { release = resolve; });
  const queue = createInvalidationQueue({ delayMs: 1, onError: () => assert.fail('unexpected error'),
    run: async scopes => { batches.push(scopes.sort()); if (batches.length === 1) await blocker; } });
  try {
    for (let i = 0; i < 20; i++) queue.enqueue(['events', 'queue']);
    await delay(10);
    assert.deepEqual(batches, [['events', 'queue']]);
    for (let i = 0; i < 20; i++) queue.enqueue(['catalog', 'events', 'untrusted']);
    await delay(10);
    assert.equal(batches.length, 1);
    release();
    await delay(10);
    assert.deepEqual(batches, [['events', 'queue'], ['catalog', 'events']]);
  } finally { release(); queue.dispose(); }
});

test('failed catch-up retries without another event, backs off and cancels on disposal', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let calls = 0, errors = 0;
  const seen = [];
  const queue = createInvalidationQueue({delayMs: 1, onError: () => errors++, run: async scopes => {
    calls++; seen.push(scopes.sort()); if (calls < 4) throw Error('history unavailable');
  }});
  t.after(() => queue.dispose());
  const tick = async ms => { t.mock.timers.tick(ms); await Promise.resolve(); await Promise.resolve(); };
  queue.enqueue(['events']); await tick(1);
  assert.equal(calls, 1); assert.equal(errors, 1);
  queue.enqueue(['catalog']); await tick(999); assert.equal(calls, 1);
  await tick(1); assert.equal(calls, 2); assert.deepEqual(seen[1], ['catalog', 'events']);
  await tick(1999); assert.equal(calls, 2);
  await tick(1); assert.equal(calls, 3);
  await tick(4000); assert.equal(calls, 4);
  await tick(30_000); assert.equal(calls, 4, 'success ends retries');
  queue.enqueue(['events']); queue.dispose(); await tick(30_000);
  assert.equal(calls, 4);
});
