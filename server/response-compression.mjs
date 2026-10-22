import { gzip as gzipCallback } from 'node:zlib';
import { promisify } from 'node:util';
import { routeTemplate } from '../shared/request-log.mjs';

const gzip = promisify(gzipCallback);
const routes = new Set(['/api/bootstrap', '/api/events', '/api/responses/:request_id',
  '/api/relay/devices/:device_id/events', '/api/relay/commands', '/api/relay/poll']);
let active = 0;

export function acceptsGzip(value) {
  if (typeof value !== 'string') return false;
  const encodings = new Map();
  for (const entry of value.toLowerCase().split(',')) {
    const [name, ...parameters] = entry.trim().split(';');
    let quality = 1;
    for (const parameter of parameters) {
      const match = parameter.trim().match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/);
      quality = match ? Number(match[1]) : 0;
    }
    encodings.set(name.trim(), quality);
  }
  return (encodings.get('gzip') ?? encodings.get('*') ?? 0) > 0;
}

/** Compress only successful opaque relay responses, after E2EE, never auth/error bodies. */
export async function compressRelayResponse(request, target, content) {
  if (request.method === 'HEAD' || target.statusCode !== 200 ||
      !routes.has(routeTemplate(request.url)) ||
      !/^application\/json(?:;|$)/i.test(String(target.getHeader('content-type') ?? '')) ||
      target.hasHeader('content-encoding') || target.hasHeader('content-range') ||
      target.hasHeader('set-cookie') || /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(String(target.getHeader('cache-control') ?? ''))) {
    return content;
  }
  const vary = String(target.getHeader('vary') ?? '').split(',').map(x => x.trim()).filter(Boolean);
  if (!vary.some(x => x === '*' || x.toLowerCase() === 'accept-encoding')) vary.push('Accept-Encoding');
  target.setHeader('Vary', vary.join(', '));
  if (content.length < 2048 || !acceptsGzip(request.headers['accept-encoding']) || active >= 4) return content;
  active += 1;
  try {
    const encoded = await gzip(content, { level: 4 });
    if (encoded.length >= content.length || target.destroyed) return content;
    target.setHeader('Content-Encoding', 'gzip');
    target.setHeader('Content-Length', encoded.length);
    // A strong identity ETag must not describe different representation bytes.
    target.removeHeader('ETag');
    return encoded;
  } catch {
    return content; // Compression is optional; do not interrupt encrypted responses.
  } finally {
    active -= 1;
  }
}
