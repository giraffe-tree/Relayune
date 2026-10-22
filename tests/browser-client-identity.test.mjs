import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';

const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('browser identity persists across tabs and reloads, but resets with site data', {
  skip: !existsSync(chrome), timeout: 120000,
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'relay-identity-chrome-'));
  const bundle = await build({ entryPoints: ['app/client-identity.ts'], bundle: true, format: 'esm', write: false, logLevel: 'silent' });
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/identity.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/identity.js' ? bundle.outputFiles[0].text : '<!doctype html><title>Identity test</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(chrome, ['--headless=new', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-pipe', `--user-data-dir=${profile}`], { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let nextId = 0;
  let buffer = '';
  const pending = new Map();
  const loads = new Map();
  child.stdio[4].on('data', chunk => {
    buffer += chunk.toString();
    let separator;
    while ((separator = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, separator));
      buffer = buffer.slice(separator + 1);
      if (message.method === "Page.loadEventFired") loads.get(message.sessionId)?.();
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        clearTimeout(waiter.timer);
        message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
      }
    }
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method} ${params.expression ?? ""}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  const evaluate = async (session, expression) => {
    const reply = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
    assert.equal(reply.exceptionDetails, undefined, JSON.stringify(reply.exceptionDetails));
    return reply.result.value;
  };
  const navigate = async (sessionId, destination) => {
    await call('Network.enable', {}, sessionId);
    await call('Page.enable', {}, sessionId);
    let timer;
    const loaded = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Page load timeout')), 30000);
      loads.set(sessionId, resolve);
    });
    try {
      // Register before navigation; evaluating readyState can observe about:blank
      // and send the module import into a context that is about to be destroyed.
      await Promise.all([call('Page.navigate', { url: destination }, sessionId), loaded]);
      await evaluate(sessionId, `import('${url}/identity.js').then(m => { globalThis.readIdentity = m.browserClientIdentity; return true; })`);
    } finally {
      clearTimeout(timer);
      loads.delete(sessionId);
    }
  };
  const open = async () => {
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    await navigate(sessionId, url);
    return sessionId;
  };
  const identity = session => evaluate(session, 'readIdentity()');
  try {
    const firstTab = await open();
    const secondTab = await open();
    const [first, second] = await Promise.all([identity(firstTab), identity(secondTab)]);
    assert.match(first, /^web:[a-f0-9]{64}$/);
    assert.equal(first, second, 'concurrent first use across tabs creates one identity');
    await navigate(firstTab, `${url}/reload`);
    assert.equal(await identity(firstTab), first, 'navigation retains identity');
    await evaluate(secondTab, `new Promise((resolve,reject) => { const r=indexedDB.deleteDatabase('relayune-client-identity'); r.onsuccess=()=>resolve(true); r.onerror=()=>reject(r.error); })`);
    const fresh = await identity(firstTab);
    assert.notEqual(fresh, first, 'clearing site data creates a new identity');
    await evaluate(secondTab, `Object.defineProperty(window, 'indexedDB', {get(){throw new Error('blocked')}}); true`);
    assert.equal(await identity(secondTab), undefined, 'blocked storage does not prevent pairing');
  } finally {
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    child.stdio[3].destroy();
    child.stdio[4].destroy();
    server.closeAllConnections();
    for (const waiter of pending.values()) clearTimeout(waiter.timer);
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
