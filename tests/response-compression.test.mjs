import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { compressRelayResponse, acceptsGzip } from '../server/response-compression.mjs';

test('gzip negotiation respects explicit refusal over wildcard and invalid q values', () => {
  for (const value of ['gzip', 'br, gzip;q=0.8', '*', 'GZip; q=1.0']) assert.equal(acceptsGzip(value), true);
  for (const value of [undefined, '', 'br', 'gzip;q=0, *;q=1', '*;q=0', 'gzip;q=2', 'gzip;q=no']) assert.equal(acceptsGzip(value), false);
});

test('real HTTP compressed bytes decode identically, length and Vary match, restricted routes stay untouched', async () => {
  const large = Buffer.from(JSON.stringify({ envelope: { ciphertext: randomBytes(40_000).toString('base64url') } }));
  const small = Buffer.from('{"events":[]}');
  const server = createServer(async (req, res) => {
    res.statusCode = req.url.includes('error') ? 401 : 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Vary', 'Origin');
    if (req.url.includes('cookie')) res.setHeader('Set-Cookie', 'synthetic=secret');
    if (req.url.includes('transform')) res.setHeader('Cache-Control', 'no-transform');
    const body = req.url.includes('small') ? small : large;
    res.setHeader('Content-Length', body.length);
    res.end(await compressRelayResponse(req, res, body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = (path, encoding = 'gzip') => new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port: server.address().port, path, headers: { 'Accept-Encoding': encoding } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    }).on('error', reject);
  });
  try {
    for (const path of ['/api/events', '/api/bootstrap', '/api/responses/synthetic', '/api/relay/commands']) {
      const result = await request(path);
      assert.equal(result.headers['content-encoding'], 'gzip');
      assert.equal(Number(result.headers['content-length']), result.body.length);
      assert.equal(result.headers.vary, 'Origin, Accept-Encoding');
      assert.deepEqual(gunzipSync(result.body), large);
      assert.ok(result.body.length < large.length * 0.8);
    }
    for (const path of ['/api/auth/session', '/api/events?error', '/api/events?cookie', '/api/events?transform', '/api/events?small']) {
      const result = await request(path);
      assert.equal(result.headers['content-encoding'], undefined);
      assert.deepEqual(result.body, path.includes('small') ? small : large);
    }
    const identity = await request('/api/events', 'gzip;q=0, *;q=1');
    assert.deepEqual(identity.body, large);
    assert.equal(identity.headers['content-encoding'], undefined);
    assert.match(identity.headers.vary, /Accept-Encoding/);
    const automatic = await fetch(`http://127.0.0.1:${server.address().port}/api/events`);
    assert.equal(automatic.headers.get('content-encoding'), 'gzip');
    assert.deepEqual(await automatic.json(), JSON.parse(large));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
