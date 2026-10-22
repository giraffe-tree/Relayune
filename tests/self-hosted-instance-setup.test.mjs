import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, get } from 'node:https';
import { once } from 'node:events';
import { X509Certificate } from 'node:crypto';
import { normalizeInstanceOrigin, prepareSelfHostedInstance, nginxInstanceConfiguration } from '../scripts/prepare-self-hosted.mjs';

test('instance origin rejects credential URLs, insecure origins and configuration injection', () => {
  assert.equal(normalizeInstanceOrigin('https://10.12.0.4:8443/'), 'https://10.12.0.4:8443');
  assert.equal(normalizeInstanceOrigin('https://[fd00::4]/'), 'https://[fd00::4]');
  for (const value of ['http://10.0.0.1', 'https://user:pass@example.test', 'https://example.test/path',
    'https://example.test/?token=secret', 'https://example.test/#token', 'file:///etc/passwd',
    'https://evil{test}.example', 'https://*.example', 'https://bad_name.example']) {
    assert.throws(() => normalizeInstanceOrigin(value));
  }
  assert.throws(() => nginxInstanceConfiguration({ origin: 'https://10.0.0.1', directory: '/etc/a$bad', projectRoot: '/opt/relayune' }));
});

test('generated isolated instance has no fixed password and uses genuine hostname-verified TLS', async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'relayune-setup-test-'));
  const directory = path.join(temporary, 'instance');
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const result = await prepareSelfHostedInstance({ directory, projectRoot: process.cwd(), origin: 'https://127.0.0.1:8443' });
  const connection = JSON.parse(await readFile(path.join(directory, 'instance-connection.json'), 'utf8'));
  const ca = await readFile(path.join(directory, 'tls/ca.pem'));
  const cert = await readFile(path.join(directory, 'tls/server-chain.pem'));
  const key = await readFile(path.join(directory, 'tls/server-key.pem'));
  assert.equal(new X509Certificate(ca).fingerprint256, result.caFingerprint);
  assert.equal(connection.ca_sha256, result.caFingerprint);
  assert.equal(connection.ca_pem, ca.toString());
  const environment = await readFile(path.join(directory, 'instance.env'), 'utf8');
  assert.match(environment, /RELAY_AUTH_MODE=username/);
  assert.doesNotMatch(environment, /SMTP_|MAIL_FROM|123456|PASSWORD=/);
  const secret = await readFile(path.join(directory, 'setup-token'), 'utf8');
  assert.match(secret.trim(), /^[A-Za-z0-9_-]{43}$/);
  for (const name of ['setup-token', 'mongo-password', 'instance.env', 'tls/ca-key.pem', 'tls/server-key.pem']) {
    assert.equal((await stat(path.join(directory, name))).mode & 0o777, 0o600);
  }
  const nginx = await readFile(path.join(directory, 'nginx.conf'), 'utf8');
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3192/);
  assert.match(nginx, /proxy_set_header Host \$http_host/);
  assert.match(nginx, /access_log off/);
  assert.doesNotMatch(nginx, /listen 80[; ]|proxy_ssl_verify off/);
  assert.ok(!nginx.includes(secret.trim()));
  await assert.rejects(prepareSelfHostedInstance({ directory, projectRoot: process.cwd(), origin: result.origin }), /already_exists/);
  const server = createServer({ cert, key }, (_req, response) => response.end('instance-ok'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `https://127.0.0.1:${server.address().port}/`;
  const request = (options) => new Promise((resolve, reject) => {
    get(url, options, (response) => { let body = ''; response.on('data', (chunk) => body += chunk); response.on('end', () => resolve(body)); }).on('error', reject);
  });
  assert.equal(await request({ ca }), 'instance-ok');
  await assert.rejects(request({}), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
  await assert.rejects(request({ ca, servername: 'wrong.example.invalid' }), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
});

test('instance material cannot be generated inside the repository or through an existing symlink', async (t) => {
  await assert.rejects(prepareSelfHostedInstance({ directory: path.join(process.cwd(), '.public-prep', 'forbidden-instance'),
    projectRoot: process.cwd(), origin: 'https://127.0.0.1' }), /instance_configuration_invalid/);
  const temporary = await mkdtemp(path.join(tmpdir(), 'relayune-setup-link-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, 'linked'); await symlink(tmpdir(), directory);
  await assert.rejects(prepareSelfHostedInstance({ directory, projectRoot: process.cwd(), origin: 'https://127.0.0.1' }), /already_exists/);
});
