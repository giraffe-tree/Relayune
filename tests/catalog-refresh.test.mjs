import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CatalogRefresh } from '../relay/catalog-refresh.mjs';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  let reads = 0;
  const refresh = new CatalogRefresh({ refresh: async () => { reads++; }, now: () => Date.now(), ...options });
  t.after(() => refresh.close());
  return { refresh, reads: () => reads, tick: async ms => { t.mock.timers.tick(ms); await flush(); } };
}

test('idle catalogs use one fallback per 30 seconds instead of one full read per second', async t => {
  const { reads, tick } = setup(t);
  await tick(29_000); assert.equal(reads(), 0);
  await tick(1_000); await tick(500); assert.equal(reads(), 1);
  await tick(29_500); await tick(500); assert.equal(reads(), 2);
});

test('continuous changes coalesce and cannot postpone refresh indefinitely', async t => {
  const { refresh, reads, tick } = setup(t);
  refresh.request(); await tick(500); assert.equal(reads(), 1);
  for (let i = 0; i < 49; i++) { refresh.request(); await tick(100); }
  assert.equal(reads(), 1);
  await tick(100); assert.equal(reads(), 2);
});

test('a change during a slow read produces a follow-up without overlapping work', async t => {
  let reads = 0, release;
  const { refresh, tick } = setup(t, { refresh: () => { reads++; return new Promise(r => { release = r; }); } });
  refresh.request(); await tick(500); assert.equal(reads, 1);
  refresh.request(); await tick(10_000); assert.equal(reads, 1);
  release(); await flush(); await tick(500); assert.equal(reads, 2);
  refresh.close(); refresh.request(); release(); await flush(); await tick(60_000);
  assert.equal(reads, 2);
});

test('missing and failed watchers retry while fallback reads continue; close releases them', async t => {
  let attach = 0, watcher, hint, closed = 0;
  const { refresh, reads, tick } = setup(t, { paths: ['/fixture'], watchPath: (_path, _options, cb) => {
    attach++;
    if (attach === 1) throw new Error('missing');
    watcher = new EventEmitter(); watcher.close = () => { closed++; }; hint = cb; return watcher;
  } });
  await tick(30_000); await tick(500);
  assert.equal(attach, 2); assert.equal(reads(), 1);
  hint(); await tick(5_000); assert.equal(reads(), 2);
  watcher.emit('error', new Error('lost'));
  assert.equal(closed, 1);
  await tick(30_000); await tick(500); assert.equal(attach, 3);
  refresh.close(); assert.equal(closed, 2);
});

test('failed refresh does not disable subsequent changes', async t => {
  let calls = 0;
  const { refresh, tick } = setup(t, { refresh: async () => { if (++calls === 1) throw new Error('temporary'); } });
  refresh.request(); await tick(500);
  refresh.request(); await tick(5000);
  assert.equal(calls, 2);
});

test('real filesystem changes refresh the directory without waiting for fallback', async t => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'relayune-catalog-watch-'));
  let resolve;
  const changed = new Promise(r => { resolve = r; });
  const refresh = new CatalogRefresh({ paths: [root], refresh: resolve, debounceMs: 10, minIntervalMs: 10 });
  let timeout;
  t.after(async () => { clearTimeout(timeout); refresh.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, 'session.jsonl'), 'fixture');
  await Promise.race([changed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('watch did not refresh')), 3000); })]);
});
