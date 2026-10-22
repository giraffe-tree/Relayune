import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpJsonRpcClient, KimiCodeAdapter } from '../relay/kimi-adapter.mjs';
import { MacRelay } from '../relay/mac-relay.mjs';

const fixture = new URL('./fixtures/fake-kimi-acp.mjs', import.meta.url).href;

async function resistantFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'relay-kimi-shutdown-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'agent.mjs'), marker = join(directory, 'term');
  await writeFile(path, `import {writeFileSync} from 'node:fs';
process.on('SIGTERM',()=>writeFileSync(${JSON.stringify(marker)},'received'));
setInterval(()=>{},1000);
await import(${JSON.stringify(fixture)});
`);
  return { directory, path, marker };
}

// A real child deliberately survives both stdin EOF and TERM; no real Agent,
// account, application history or external service is involved.
test('ACP close rejects pending RPCs, coalesces calls, then waits for KILL exit', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const { directory, path, marker } = await resistantFixture(t);
  const client = new AcpJsonRpcClient({ command: process.execPath, args: [path], cwd: directory,
    env: { PATH: process.env.PATH, HOME: directory }, spawnProcess: spawn, shutdownGraceMs: 100 });
  await client.start();
  const child = client.child;
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; } });
  await client.request('initialize', { protocolVersion: 1 });
  const pending = assert.rejects(client.request('fixture/no-response', {}, { timeoutMs: null }), /connection closed/);
  const closed = client.close();
  assert.equal(client.close(), closed, 'concurrent closes share termination');
  await pending;
  await closed;
  assert.equal(await readFile(marker, 'utf8'), 'received', 'child observed TERM before force termination');
  assert.equal(child.signalCode, 'SIGKILL');
  assert.equal(client.child, null);
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  await client.close();
});

test('Relay stop waits for the synthetic Kimi child to be reaped', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const { directory, path } = await resistantFixture(t);
  const adapter = new KimiCodeAdapter({ kimiBin: process.execPath, kimiArgs: [path], workspace: directory,
    kimiHome: directory, historyReader: async () => ({ messages: [], agents: [] }),
    sessionStateReader: async () => new Map(), usageReader: async () => [], quotaReader: async () => [] });
  const relay = new MacRelay({ serverUrl: 'https://fixture.invalid', deviceId: 'dev_fixture', deviceToken: 'synthetic',
    e2eeKey: Buffer.alloc(32, 1).toString('base64url'), adapter, statePath: null });
  relay.connect = async () => {};
  t.after(() => relay.stop());
  await relay.start();
  const child = adapter.client.child;
  await relay.stop();
  assert.equal(child.signalCode, 'SIGKILL');
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  assert.equal(adapter.client, null);
});

test('ACP close handles an already exited child, failed spawn and unopened client', { timeout: 10000 }, async () => {
  const exited = new AcpJsonRpcClient({ command: process.execPath, args: ['-e', 'process.exit(0)'], spawnProcess: spawn });
  await exited.start();
  await once(exited.child, 'exit');
  await exited.close();
  assert.equal(exited.child, null);
  const missing = new AcpJsonRpcClient({ command: join(tmpdir(), 'nonexistent-fixture-agent'), args: [], spawnProcess: spawn });
  await missing.start();
  await missing.close();
  assert.equal(missing.child, null);
  const unopened = new AcpJsonRpcClient({ command: process.execPath, args: [], spawnProcess: spawn });
  await unopened.close();
  await assert.rejects(unopened.start(), /connection closed/);
});

test('ACP reports a bounded failure if neither TERM nor KILL produces an exit', { timeout: 1000 }, async () => {
  const signals = [], child = new EventEmitter();
  Object.assign(child, { pid: 123, exitCode: null, signalCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: signal => { signals.push(signal); return false; } });
  const client = new AcpJsonRpcClient({ command: 'synthetic', args: [], spawnProcess: () => child, shutdownGraceMs: 10, shutdownKillMs: 10 });
  await client.start();
  await assert.rejects(client.close(), /shutdown timed out/);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(client.child, child, 'failed cleanup must not claim the process was gone');
});
