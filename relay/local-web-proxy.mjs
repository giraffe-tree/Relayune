import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

export const WEB_REQUEST_LIMIT = 256 * 1024;
export const WEB_RESPONSE_LIMIT = 12 * 1024 * 1024;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const REQUEST_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'authorization', 'cookie', 'range', 'if-none-match', 'if-modified-since', 'origin', 'referer']);
const RESPONSE_HEADERS = new Set(['content-type', 'content-language', 'location', 'etag', 'last-modified', 'content-range', 'accept-ranges', 'set-cookie']);
const fail = (code) => Object.assign(new Error(code), { code });

// No DNS lookup, userinfo, alternate numeric IP spelling, or arbitrary destination.
export function localWebUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 ||
      !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):[0-9]+(?:[/?#]|$)/.test(value)) throw fail('web_url_invalid');
  const url = new URL(value);
  if (url.username || url.password || Number(url.port) < 1024 || Number(url.port) > 65535) throw fail('web_url_invalid');
  return url;
}

export class LocalWebProxy {
  constructor({ now = Date.now, maxBytes = WEB_RESPONSE_LIMIT, timeoutMs = 20000 } = {}) {
    this.now = now;
    this.maxBytes = maxBytes;
    this.timeoutMs = timeoutMs;
    this.previews = new Map();
  }

  open(owner, sessionId, value) {
    this.prune();
    if (!owner || !sessionId || this.previews.size >= 32) throw fail('web_preview_unavailable');
    const url = localWebUrl(value);
    const id = randomBytes(24).toString('hex');
    this.previews.set(id, { owner, sessionId, origin: url.origin, expires: this.now() + 30 * 60000, active: new Set() });
    return { preview_id: id, origin: url.origin, expires_at: this.previews.get(id).expires };
  }

  prune() {
    for (const [id, preview] of this.previews) if (preview.expires <= this.now()) this.close(id);
  }

  close(id) {
    const preview = this.previews.get(id);
    this.previews.delete(id);
    for (const abort of preview?.active ?? []) abort.abort();
  }

  closeAll() { for (const id of this.previews.keys()) this.close(id); }

  async request(owner, sessionId, payload, authorized = () => true) {
    this.prune();
    const preview = this.previews.get(payload?.preview_id);
    if (!preview || preview.owner !== owner || preview.sessionId !== sessionId || !authorized()) throw fail('web_preview_expired');
    if (payload.close === true) { this.close(payload.preview_id); return { closed: true }; }
    if (preview.active.size >= 8) throw fail('web_preview_busy');
    const { path, method = 'GET', headers = {}, base64 = '' } = payload;
    if (typeof path !== 'string' || path.length > 8192 || !path.startsWith('/') || path.startsWith('//') || /[\\\r\n#]/.test(path) || !METHODS.has(method)) throw fail('web_request_invalid');
    const url = new URL(path, preview.origin);
    if (url.origin !== preview.origin) throw fail('web_request_invalid');
    if (typeof base64 !== 'string' || base64.length > Math.ceil(WEB_REQUEST_LIMIT / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw fail('web_request_too_large');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > WEB_REQUEST_LIMIT || (['GET', 'HEAD'].includes(method) && bytes.length)) throw fail('web_request_invalid');
    if (!headers || typeof headers !== 'object' || Array.isArray(headers) || JSON.stringify(headers).length > 16384) throw fail('web_headers_invalid');
    const forwarded = { 'accept-encoding': 'identity' };
    for (const [name, value] of Object.entries(headers)) {
      const key = name.toLowerCase();
      if (!REQUEST_HEADERS.has(key) && !/^x-(?:csrf-token|xsrf-token|requested-with)$/.test(key)) continue;
      if (typeof value !== 'string' || /[\r\n]/.test(value)) throw fail('web_headers_invalid');
      if (key === 'origin' && value !== preview.origin) throw fail('web_headers_invalid');
      if (key === 'referer' && new URL(value).origin !== preview.origin) throw fail('web_headers_invalid');
      forwarded[key] = value;
    }
    forwarded.host = url.host;
    if (bytes.length) forwarded['content-length'] = String(bytes.length);
    const abort = new AbortController();
    preview.active.add(abort);
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    // Revoke pending reads as soon as the existing authorization becomes stale.
    const authorizationTimer = setInterval(() => { if (!authorized()) abort.abort(); }, 250);
    try {
      return await new Promise((resolve, reject) => {
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request({
          protocol: url.protocol, hostname: url.hostname === '[::1]' ? '::1' : '127.0.0.1',
          servername: url.hostname === 'localhost' ? 'localhost' : undefined,
          port: url.port, path: url.pathname + url.search, method,
          headers: forwarded, signal: abort.signal, agent: false,
        }, (res) => {
          const chunks = [];
          let length = 0;
          res.on('data', (chunk) => {
            length += chunk.length;
            if (length > this.maxBytes) { res.destroy(); reject(fail('web_response_too_large')); }
            else chunks.push(chunk);
          });
          res.on('error', () => reject(fail('web_request_failed')));
          res.on('end', () => {
            if (!authorized()) { reject(fail('web_preview_expired')); return; }
            const resultHeaders = {};
            for (const [key, value] of Object.entries(res.headers)) if (RESPONSE_HEADERS.has(key)) resultHeaders[key] = value;
            // Redirects are returned to the phone; never follow them on the computer.
            if (res.headers.location) {
              try {
                const destination = new URL(res.headers.location, url);
                if (destination.origin !== preview.origin || destination.username || destination.password) throw new Error();
                resultHeaders.location = destination.pathname + destination.search + destination.hash;
              } catch { reject(fail('web_redirect_blocked')); return; }
            }
            if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { reject(fail('web_encoding_unsupported')); return; }
            resolve({ status: res.statusCode, headers: resultHeaders, base64: Buffer.concat(chunks).toString('base64') });
          });
        });
        req.on('error', () => reject(fail(abort.signal.aborted ? 'web_request_timeout' : 'web_request_failed')));
        req.end(bytes);
      });
    } finally {
      clearTimeout(timer);
      clearInterval(authorizationTimer);
      preview.active.delete(abort);
    }
  }
}
