import { connect } from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';

// Credentials are loaded from a private regular file, never from a payload,
// database row, source file or a user-selected network endpoint.
export async function readPrivateFile(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    const serviceReadable = stat.uid === 0 && stat.gid === process.getgid?.() && (stat.mode & 0o777) === 0o640;
    if (!stat.isFile() || ((stat.mode & 0o077) !== 0 && !serviceReadable) || stat.size > 16384) throw new Error('Private file permissions are invalid');
    return await file.readFile();
  } finally { await file.close(); }
}

export class ApnsClient {
  constructor({ environment, teamId, keyId, privateKey, bundleId = 'cn.giraffetree.relayune' }) {
    if (!['sandbox', 'production'].includes(environment) || !/^[A-Z0-9]{10}$/.test(teamId) ||
        !/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Za-z0-9.-]{1,200}$/.test(bundleId)) throw new Error('Invalid APNs configuration');
    this.environment = environment; this.teamId = teamId; this.keyId = keyId;
    this.bundleId = bundleId; this.key = createPrivateKey(privateKey);
    if (this.key.asymmetricKeyType !== 'ec' || this.key.asymmetricKeyDetails.namedCurve !== 'prime256v1') throw new Error('APNs requires a P256 key');
  }

  authorization(now = Date.now()) {
    if (this.jwt && now - this.issuedAt < 40 * 60_000) return this.jwt;
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({alg: 'ES256', kid: this.keyId})}.${encode({iss: this.teamId, iat: Math.floor(now / 1000)})}`;
    this.jwt = `${unsigned}.${sign('sha256', Buffer.from(unsigned), {key: this.key, dsaEncoding: 'ieee-p1363'}).toString('base64url')}`;
    this.issuedAt = now;
    return this.jwt;
  }

  async send({ token, payload, type = 'alert', expiration, collapseId, priority = 10 }) {
    if (!/^[a-f0-9]{32,512}$/i.test(token) || !['alert', 'liveactivity'].includes(type) ||
        ![5,10].includes(priority) || (collapseId && Buffer.byteLength(collapseId) > 64)) throw new Error('Invalid APNs message');
    const bytes = Buffer.from(JSON.stringify(payload));
    if (bytes.length > 4096) throw new Error('APNs payload exceeds limit');
    return new Promise(resolve => {
      let settled = false;
      const session = connect(`https://${this.environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'}`);
      const finish = result => { if (!settled) { settled = true; clearTimeout(timer); session.destroy(); resolve(result); } };
      const timer = setTimeout(() => finish({status: 0, reason: 'transport_unavailable'}), 15000);
      session.on('error', () => finish({status: 0, reason: 'transport_unavailable'}));
      const request = session.request({
        ':method': 'POST', ':path': `/3/device/${token}`,
        authorization: `bearer ${this.authorization()}`,
        'apns-topic': this.bundleId + (type === 'liveactivity' ? '.push-type.liveactivity' : ''),
        'apns-push-type': type, 'apns-priority': String(priority),
        'apns-expiration': String(expiration ?? Math.floor(Date.now() / 1000) + 300),
        ...(collapseId ? {'apns-collapse-id': collapseId} : {}),
      });
      let status = 0, body = '';
      request.on('response', headers => { status = Number(headers[':status']); });
      request.on('data', chunk => { if (body.length < 1024) body += chunk.toString(); });
      request.on('error', () => finish({status: 0, reason: 'transport_unavailable'}));
      request.on('end', () => {
        let reason;
        try { reason = JSON.parse(body).reason; } catch { /* Empty success body. */ }
        const allowed = ['BadDeviceToken','DeviceTokenNotForTopic','Unregistered','TopicDisallowed','InvalidProviderToken','ExpiredProviderToken','Forbidden','TooManyRequests','BadPayload','PayloadTooLarge','BadTopic','MissingTopic','BadEnvironmentKeyIdInToken'];
        finish({status, reason: status === 200 ? 'accepted' : allowed.includes(reason) ? reason : 'provider_rejected'});
      });
      request.end(bytes);
    });
  }
}
