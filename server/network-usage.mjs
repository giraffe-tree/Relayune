import { requestMethod, routeTemplate } from '../shared/request-log.mjs';
import packageInfo from '../package.json' with { type: 'json' };

const kinds = new Set(['ready', 'presence', 'invalidate', 'heartbeat', 'ping', 'pong', 'subscribe']);
const sizeOf = (data, encoding) => typeof data === 'string' ? Buffer.byteLength(data, encoding) : data?.byteLength ?? 0;

/** Application payload counters, NOT NIC/billing bytes. Fixed dimensions only. */
export function createNetworkUsage({ write = (record) => console.log(JSON.stringify(record)),
  now = () => Date.now(), version = packageInfo.version, intervalMs = 60_000 } = {}) {
  const buckets = new Map();
  let started = now();
  function add(transport, method, route, kind, rx, tx, units = 0, aborted = 0) {
    method = requestMethod(method);
    route = routeTemplate(route);
    kind = transport === 'http' ? 'body' : kinds.has(kind) ? kind : 'other';
    const key = [transport, method, route, kind].join('|');
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { transport, request_method: method, request_uri: route, message_kind: kind,
        rx_payload_bytes: 0, tx_payload_bytes: 0, units: 0, aborted: 0 };
      buckets.set(key, bucket);
    }
    bucket.rx_payload_bytes += rx;
    bucket.tx_payload_bytes += tx;
    bucket.units += units;
    bucket.aborted += aborted;
  }
  function flush() {
    const end = now();
    const records = [...buckets.values()];
    buckets.clear();
    const start = started;
    started = end;
    for (const bucket of records) {
      try { write({ schema_version: 1, service: 'relayune-api',
        service_version: /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version) ? version : '0.0.0',
        event: 'network_usage', window_start_ms: start, window_end_ms: end, ...bucket }); }
      catch { /* Observability must not interrupt traffic. Failed writes are not retried/doubled. */ }
    }
  }
  const timer = intervalMs > 0 ? setInterval(flush, intervalMs) : null;
  timer?.unref();
  return {
    flush,
    close() { if (timer) clearInterval(timer); flush(); },
    receiveHttp(request, chunk) {
      add('http', request.method, request.url, 'body', sizeOf(chunk), 0);
    },
    observeHttp(request, response) {
      // Count bytes submitted to Node, including backpressure (write(false) accepts data).
      // HEAD/204/304 do not transmit a body. Never retain chunks, URLs or headers.
      const method = requestMethod(request.method);
      const route = routeTemplate(request.url);
      const bodyAllowed = () => method !== 'HEAD' && response.statusCode >= 200 &&
        response.statusCode !== 204 && response.statusCode !== 304;
      for (const name of ['write', 'end']) {
        const original = response[name];
        response[name] = function(chunk, encoding, ...rest) {
          const bytes = bodyAllowed() ? sizeOf(chunk, typeof encoding === 'string' ? encoding : undefined) : 0;
          const result = original.call(this, chunk, encoding, ...rest);
          add('http', method, route, 'body', 0, bytes);
          return result;
        };
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        add('http', method, route, 'body', 0, 0, 1, response.writableFinished ? 0 : 1);
      };
      response.once('finish', finish);
      response.once('close', finish);
    },
    websocket(direction, kind, bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) return;
      add('websocket', 'GET', '/api/realtime', kind,
        direction === 'rx' ? bytes : 0, direction === 'tx' ? bytes : 0, 1);
    },
  };
}
