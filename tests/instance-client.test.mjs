import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['app/instance-client.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const instance = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
const origin = 'https://10.12.0.4:8443';

test('Web instance discovery omits credentials and never follows redirects', async () => {
  let called = false;
  const value = await instance.discoverInstance('', origin, undefined, async (url, options) => {
    called = true; assert.equal(url, `${origin}/api/instance`);
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store'); assert.equal(options.headers, undefined);
    return Response.json({ schema_version: 1, auth_mode: 'username', setup_required: false });
  });
  assert.ok(called); assert.equal(value.auth_mode, 'username');
});

test('Web rejects API-origin transplants before any credential or discovery request', async () => {
  let requests = 0;
  await assert.rejects(instance.discoverInstance('https://other.invalid', origin, undefined,
    async () => { requests++; return Response.json({}); }), /instance_origin_mismatch/);
  assert.equal(requests, 0);
  for (const value of ['https://user:password@10.12.0.4:8443', `${origin}?token=a`, `${origin}#secret`]) {
    assert.throws(() => instance.sameOriginApiUrl('/api/auth/password', value, origin));
  }
});

test('Web refuses plaintext remote credentials before making a request', async () => {
  for (const origin of ['http://192.168.1.2:8080', 'http://localhost.example.invalid', 'ftp://127.0.0.1']) {
    assert.throws(() => instance.sameOriginApiUrl('/api/auth/password', '', origin), /instance_https_required/);
  }
  assert.equal(instance.sameOriginApiUrl('/api/auth/password', '', 'http://127.0.0.1:8080'), 'http://127.0.0.1:8080/api/auth/password');
  await assert.rejects(instance.discoverInstance('', origin, undefined, async () => new Response('x'.repeat(16385))), /instance_invalid_response/);
});

test('unknown server cannot silently fall back to email authentication', async () => {
  const request = async () => new Response('', { status: 404 });
  await assert.rejects(instance.discoverInstance('', origin, undefined, request), /instance_unavailable/);
  assert.equal((await instance.discoverInstance('', 'https://relayune.giraffetree.cn', undefined, request)).auth_mode, 'email');
  for (const value of [{}, { schema_version: 1, auth_mode: 'username' },
    { schema_version: 2, auth_mode: 'username', setup_required: false }]) {
    assert.throws(() => instance.parseInstanceCapabilities(value));
  }
});

test('local account UI displays username without representing it as a verified email', () => {
  assert.equal(instance.instanceUserLabel({ account_id: 'acct_local', email: null, username: 'admin', auth_mode: 'username' }), 'admin');
  assert.equal(instance.instanceUserLabel({ email: 'synthetic@example.invalid' }), 'synthetic@example.invalid');
});
