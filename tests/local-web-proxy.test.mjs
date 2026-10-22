import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { LocalWebProxy, localWebUrl, WEB_REQUEST_LIMIT } from '../relay/local-web-proxy.mjs';
import { MacRelay } from '../relay/mac-relay.mjs';
import { generateE2eeKey, importE2eeKey, keyIdForKey, openJson } from '../relay/e2ee.mjs';

async function fixture(t, handler, options) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const proxy = new LocalWebProxy(options);
  t.after(() => { proxy.closeAll(); server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const opened = proxy.open('owner', 'session', `${url}/#auth`);
  return { server, proxy, url, opened, request: (payload) => proxy.request('owner', 'session', { preview_id: opened.preview_id, path: '/', ...payload }) };
}

test('local web accepts only explicit loopback ports without URL credentials or alternate IPs', () => {
  for (const value of ['http://127.0.0.1:8766/#auth', 'http://localhost:3000', 'https://[::1]:8443/']) assert.ok(localWebUrl(value));
  for (const value of ['http://127.1:8000', 'http://2130706433:8000', 'http://0x7f000001:8000', 'http://127.0.0.1:80', 'http://localhost', 'http://localhost.evil:8000', 'http://user@localhost:8000', 'file:///private/file', 'http://192.168.1.1:8000', 'http://127.0.0.1:8000@evil.com']) assert.throws(() => localWebUrl(value));
});

test('forwards real HTML, image bytes, JSON API bodies and cookies without desktop credentials', async (t) => {
  const received = [];
  const f = await fixture(t, async (req, res) => {
    const body = []; for await (const chunk of req) body.push(chunk);
    received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(body) });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Set-Cookie', 'preview_login=abc; HttpOnly; Path=/');
    res.end(req.url === '/image' ? Buffer.from([0, 255, 1]) : '{"ok":true}');
  });
  const post = await f.request({ path: '/api/save?q=1', method: 'POST', base64: Buffer.from('{"text":"你好"}').toString('base64'), headers: { 'content-type': 'application/json', authorization: 'Bearer page-token', host: 'evil.test', connection: 'upgrade', origin: f.url } });
  assert.equal(post.status, 200);
  assert.equal(Buffer.from(post.base64, 'base64').toString(), '{"ok":true}');
  assert.deepEqual(post.headers['set-cookie'], ['preview_login=abc; HttpOnly; Path=/']);
  assert.equal(received[0].body.toString(), '{"text":"你好"}');
  assert.equal(received[0].headers.host, new URL(f.url).host);
  assert.equal(received[0].headers.cookie, undefined);
  assert.equal(received[0].headers['accept-encoding'], 'identity');
  assert.notEqual(received[0].headers.connection, 'upgrade');
  const image = await f.request({ path: '/image', headers: { cookie: 'preview_login=abc' } });
  assert.deepEqual(Buffer.from(image.base64, 'base64'), Buffer.from([0, 255, 1]));
  assert.equal(received[1].headers.cookie, 'preview_login=abc');
});

test('redirects stay on the exact selected origin and are not followed on desktop', async (t) => {
  let hits = 0;
  const f = await fixture(t, (req, res) => { hits++; res.writeHead(302, { location: req.url === '/safe' ? '/next#auth' : 'http://127.0.0.1:1/private' }); res.end(); });
  assert.equal((await f.request({ path: '/safe' })).headers.location, '/next#auth');
  await assert.rejects(f.request({ path: '/unsafe' }), { code: 'web_redirect_blocked' });
  assert.equal(hits, 2);
});

test('capabilities reject other clients, sessions, absolute URLs, websocket upgrades and expired previews', async (t) => {
  let now = 100;
  const f = await fixture(t, (_, res) => res.end('ok'), { now: () => now });
  const base = { preview_id: f.opened.preview_id, path: '/' };
  await assert.rejects(f.proxy.request('other', 'session', base), { code: 'web_preview_expired' });
  await assert.rejects(f.proxy.request('owner', 'other', base), { code: 'web_preview_expired' });
  for (const payload of [{ path: '//evil.test/' }, { path: '/\\evil.test' }, { path: 'http://localhost:1234/' }, { method: 'CONNECT' }, { method: 'TRACE' }, { headers: { origin: 'https://evil.test' } }]) await assert.rejects(f.request(payload));
  now += 31 * 60000;
  await assert.rejects(f.request({}), { code: 'web_preview_expired' });
});

test('bounded uploads, responses, deadlines and authorization revocation', async (t) => {
  const f = await fixture(t, (req, res) => { if (req.url === '/slow') return; res.end('too large'); }, { maxBytes: 4, timeoutMs: 400 });
  await assert.rejects(f.request({}), { code: 'web_response_too_large' });
  await assert.rejects(f.request({ method: 'POST', base64: Buffer.alloc(WEB_REQUEST_LIMIT + 1).toString('base64') }));
  await assert.rejects(f.request({ path: '/slow' }), { code: 'web_request_timeout' });
  await assert.rejects(f.proxy.request('owner', 'session', { preview_id: f.opened.preview_id, path: '/' }, () => false), { code: 'web_preview_expired' });
});

test('[MOB-ATT-012][relay] web responses are encrypted exclusively for the requesting authorized client', async () => {
  const rawKey = generateE2eeKey();
  const key = await importE2eeKey(rawKey);
  const relay = new MacRelay({ serverUrl: 'https://relay.test', adapter: {}, statePath: null });
  relay.activeBrowserKeys.set('browser', { browserId: 'browser', key, keyId: await keyIdForKey(key) });
  relay.requestBrowsers.set('request', 'browser');
  const message = { type: 'session.web_result', request_id: 'request', session_id: 'session', status: 200, base64: Buffer.from('private webpage').toString('base64') };
  const frames = await relay.encodeRemoteMessage(message);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].browser_id, 'browser');
  assert.equal(JSON.stringify(frames).includes(message.base64), false);
  assert.deepEqual(await openJson(key, frames[0].envelope, frames[0].aad), message);
});

test('a POST replay uses its durable receipt instead of executing the local API again', async (t) => {
  let writes = 0;
  const f = await fixture(t, (_, res) => { writes++; res.end('saved'); });
  const key = await importE2eeKey(generateE2eeKey());
  const browser = { browserId: 'browser', key, keyId: await keyIdForKey(key) };
  const relay = new MacRelay({ serverUrl: 'https://relay.test', adapter: {}, statePath: null });
  relay.activeBrowserKeys.set('browser', browser);
  relay.authorizationObservedAt = Date.now();
  relay.flushRemoteUploads = async () => {};
  const opened = relay.localWebProxy.open(`browser:${browser.keyId}`, 'session', f.url);
  const command = { type: 'session.web_request', browser_id: 'browser', device_id: relay.deviceId,
    session_id: 'session', request_id: 'post-once', issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 35000).toISOString(), payload: {
      preview_id: opened.preview_id, path: '/', method: 'POST', base64: Buffer.from('save=1').toString('base64'),
    } };
  relay.dispatchRemoteCommand(command, browser, Date.now());
  await relay.remoteCommandTasks.get(command.request_id);
  await Promise.all([...relay.operations]);
  assert.equal(writes, 1);
  assert.ok(relay.outbox.transportRequests[command.request_id]);
  relay.dispatchRemoteCommand(command, browser, Date.now());
  await Promise.all([...relay.operations]);
  assert.equal(writes, 1);
  // A receipt whose response was lost is also not permission to repeat a write.
  relay.outbox.transportRequests[command.request_id].frames = [];
  relay.dispatchRemoteCommand(command, browser, Date.now());
  assert.equal(writes, 1);
  relay.localWebProxy.closeAll();
});
