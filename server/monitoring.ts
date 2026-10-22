import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import os from 'node:os';
import type { MonitoringDirectory } from './monitoring-users';
import routes from '../shared/request-log-routes.json';
const routeNames = new Set(routes.map(row => row.template));
const methods = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','CONNECT','TRACE','UNKNOWN']);

export const RANGES = { '15m': 900, '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, '30d': 2592000, '120d': 10368000 } as const;
type Row = Record<string, string | number | null>;
type Query = (sql: string, from: number, to: number) => Promise<Row[]>;
const MS = '(CASE WHEN schema_version = 2 THEN request_time ELSE request_time * 1000 END)';
const API = "request_uri LIKE '/api/%'";

export function monitoringQueries(range: keyof typeof RANGES, userRef: string, route = '', method = '') {
  const bucket = RANGES[range] / 60;
  const where = `${API}${userRef ? ` AND user_ref = '${userRef}'` : ''}${route ? ` AND request_uri = '${route}'` : ''}${method ? ` AND request_method = '${method}'` : ''}`;
  return {
    summary: `* | SELECT count(*) AS requests, count_if(status >= 500) AS errors, approx_percentile(${MS},0.95) AS p95_ms, approx_percentile(${MS},0.99) AS p99_ms, approx_distinct(nullif(user_ref, '')) AS users FROM log WHERE ${where}`,
    trend: `* | SELECT floor(__time__ / ${bucket}) * ${bucket} AS time, count(*) AS requests, count_if(status >= 500) AS errors, approx_percentile(${MS},0.95) AS p95_ms FROM log WHERE ${where} GROUP BY time ORDER BY time LIMIT 62`,
    endpoints: `* | SELECT request_method, request_uri, count(*) AS requests, count_if(status >= 500) AS errors, approx_percentile(${MS},0.95) AS p95_ms, approx_percentile(${MS},0.99) AS p99_ms FROM log WHERE ${where} GROUP BY request_method, request_uri ORDER BY requests DESC LIMIT 30`,
    recent_requests: `* | SELECT __time__ AS time, request_method, request_uri, status, ${MS} AS duration_ms, error, trace_id, user_ref FROM log WHERE ${where} ORDER BY __time__ DESC LIMIT 100`,
    errors: `* | SELECT __time__ AS time, request_method, request_uri, status, ${MS} AS duration_ms, error, trace_id, user_ref FROM log WHERE ${where} AND status >= 400 ORDER BY __time__ DESC LIMIT 50`,
    ingestion: '* | SELECT max(__time__) AS latest FROM log',
  };
}

function readCredentials(filename: string) {
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o027) || ![0, process.getuid?.()].includes(stat.uid)) throw new Error('invalid_credentials_file');
    const value = JSON.parse(readFileSync(fd, 'utf8'));
    for (const key of ['access_key_id', 'access_key_secret']) {
      if (typeof value[key] !== 'string' || !value[key] || /\s/.test(value[key])) throw new Error('invalid_credentials_file');
    }
    if (value.security_token !== undefined && (typeof value.security_token !== 'string' || !value.security_token || /\s/.test(value.security_token))) throw new Error('invalid_credentials_file');
    return value as { access_key_id: string; access_key_secret: string; security_token?: string };
  } finally { closeSync(fd); }
}

// GET-only SLS v1 signing. Neither the destination nor SQL can be supplied by a browser.
export function createSlsQuery(filename: string, config: { project?: string; logstore?: string; region?: string; internal?: boolean }, fetcher: typeof fetch = fetch): Query {
  const { project, logstore, region, internal = true } = config;
  // Construct destinations only from validated identifiers; never accept an arbitrary URL.
  if (!project || !/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(project) ||
      !logstore || !/^[a-z][a-z0-9_-]{1,61}[a-z0-9]$/.test(logstore) ||
      !region || !/^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+){0,2}$/.test(region) || region.length > 40) {
    throw new Error('invalid_sls_configuration');
  }
  const resource = `/logstores/${logstore}`;
  const endpoint = `https://${project}.${region}${internal ? '-internal' : ''}.log.aliyuncs.com`;
  return async (sql, from, to) => {
    const key = readCredentials(filename);
    const date = new Date().toUTCString();
    const headers: Record<string, string> = { 'x-log-apiversion': '0.6.0', 'x-log-bodyrawsize': '0', 'x-log-signaturemethod': 'hmac-sha1' };
    if (key.security_token) headers['x-acs-security-token'] = key.security_token;
    const params = { from: String(from), to: String(to), type: 'log', query: sql, line: '100', offset: '0', reverse: 'true' };
    const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
    const canonical = sorted.map(([k, v]) => `${k}=${v}`).join('&');
    const message = `GET\n\n\n${date}\n${Object.keys(headers).sort().map(k => `${k}:${headers[k]}\n`).join('')}${resource}?${canonical}`;
    headers.Date = date;
    headers.Authorization = `LOG ${key.access_key_id}:${createHmac('sha1', key.access_key_secret).update(message).digest('base64')}`;
    const response = await fetcher(`${endpoint}${resource}?${new URLSearchParams(sorted)}`, {
      headers, redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    if (!response.ok || response.headers.get('x-log-progress') !== 'Complete') { await response.body?.cancel(); throw new Error('sls_unavailable'); }
    // Bound the provider response, even if its Content-Length is missing.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('sls_unavailable');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 1048576) throw new Error('sls_response_too_large'); chunks.push(value); }
    } finally { await reader.cancel(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(data) || data.length > 100) throw new Error('invalid_sls_response');
    return data;
  };
}

const numeric = new Set(['requests', 'errors', 'p95_ms', 'p99_ms', 'users', 'time', 'latest', 'duration_ms', 'status']);
const fields = new Set([...numeric, 'request_method', 'request_uri', 'error', 'trace_id', 'user_ref']);
function clean(rows: Row[]) {
  return rows.map(row => Object.fromEntries(Object.entries(row).filter(([k]) => fields.has(k)).map(([k, v]) => [k, numeric.has(k) ? (v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)) : String(v === 'null' ? '' : v ?? '').slice(0, 256)])));
}

export function createMonitoring({ query, adminEmail, authorizeAccount, allowLocalOnly = false, directory = null, ping = async () => {}, now = Date.now }: { query: Query | null; adminEmail?: string; authorizeAccount?: (principal: string) => Promise<boolean>; allowLocalOnly?: boolean; directory?: MonitoringDirectory | null; ping?: () => Promise<unknown>; now?: () => number }) {
  const administrator = adminEmail?.trim().toLowerCase();
  if (administrator && (administrator.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(administrator))) throw new Error('invalid_monitor_admin_email');
  const cache = new Map<string, { until: number; value: Record<string, unknown> }>();
  const pending = new Map<string, Promise<Record<string, unknown>>>();
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' } });
  let usersCache: { until: number; rows: Record<string, unknown>[] } | null = null;
  let usersPending: Promise<Record<string, unknown>[]> | null = null;
  async function runtimeMetrics() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let databaseOk = false;
    try {
      databaseOk = await Promise.race([ping().then(() => true, () => false), new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), 2000); timer.unref?.();
      })]);
    } finally { if (timer) clearTimeout(timer); }
    return { database_ok: databaseOk, process_uptime_s: Math.floor(process.uptime()),
      process_memory_mb: Math.round(process.memoryUsage().rss / 1048576),
      host_memory_used_percent: Math.round((1 - os.freemem() / os.totalmem()) * 100),
      load_1m: os.loadavg()[0], cpu_count: os.cpus().length };
  }
  async function activeUsers() {
    if (!directory || !query) return { active_users: [], active_users_status: 'unavailable' };
    try {
      if (usersCache && usersCache.until > now()) return { active_users: usersCache.rows, active_users_status: 'ready' };
      if (!usersPending) {
        usersPending = (async () => {
          const to = Math.floor(now() / 1000);
          const rows = clean(await query("* | SELECT user_ref, max(__time__) AS latest, count(*) AS requests FROM log WHERE user_ref IS NOT NULL AND user_ref <> '' GROUP BY user_ref ORDER BY latest DESC, user_ref ASC LIMIT 100", to - 120 * 86400, to));
          const refs = rows.map(row => String(row.user_ref)).filter(ref => /^v[1-9][0-9]{0,2}_[0-9a-f]{64}$/.test(ref));
          const emails = await directory.emails(refs);
          const versions = await directory.versions?.([...emails.values()]).catch(() => new Map()) ?? new Map();
          const users = rows.filter(row => refs.includes(String(row.user_ref))).map(row => ({ ...row, email: emails.get(String(row.user_ref)) ?? null, client_versions: versions.get(emails.get(String(row.user_ref))) ?? {} }));
          usersCache = { until: now() + 60000, rows: users };
          return users;
        })();
        void usersPending.finally(() => { usersPending = null; }).catch(() => {});
      }
      return { active_users: await usersPending, active_users_status: 'ready' };
    } catch { return { active_users: [], active_users_status: 'unavailable' }; }
  }
  return async (request: Request, email: string | null): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!['/api/monitoring', '/api/monitoring/resolve-user'].includes(url.pathname)) return null;
    // Must precede cache access, query parsing and any provider/database work.
    if (!email) return reply({ error: { code: 'unauthorized' } }, 401);
    const allowed = authorizeAccount ? await authorizeAccount(email) : Boolean(administrator && email.trim().toLowerCase() === administrator);
    if (!allowed) return reply({ error: { code: 'forbidden' } }, 403);
    if (url.pathname === '/api/monitoring/resolve-user') {
      if (request.method !== 'POST') return reply({ error: { code: 'method_not_allowed' } }, 405);
      if (request.headers.get('origin') !== url.origin) return reply({ error: { code: 'forbidden' } }, 403);
      if (!directory) return reply({ error: { code: 'monitoring_identity_unavailable' } }, 503);
      try {
        const text = await request.text();
        if (Buffer.byteLength(text) > 2048) return reply({ error: { code: 'invalid_request' } }, 400);
        const input = JSON.parse(text);
        if (!input || typeof input.email !== 'string' || Object.keys(input).some(key => key !== 'email')) return reply({ error: { code: 'invalid_request' } }, 400);
        const normalized = input.email.trim().toLowerCase();
        const ref = directory.reference(normalized);
        if (!ref) return reply({ error: { code: 'invalid_request' } }, 400);
        return reply({ email: normalized, user_ref: ref });
      } catch { return reply({ error: { code: 'invalid_request' } }, 400); }
    }
    if (request.method !== 'GET') return reply({ error: { code: 'method_not_allowed' } }, 405);
    const range = url.searchParams.get('range') ?? '1h';
    const userRef = url.searchParams.get('user_ref') ?? '';
    const route = url.searchParams.get('route') ?? '';
    const method = url.searchParams.get('method') ?? '';
    if ((route && !routeNames.has(route)) || (method && !methods.has(method))) return reply({ error: { code: 'invalid_request' } }, 400);
    if (!Object.hasOwn(RANGES, range) || (userRef && !/^v[1-9][0-9]{0,2}_[0-9a-f]{64}$/.test(userRef)) || [...url.searchParams.keys()].some(k => !['range', 'user_ref', 'route', 'method'].includes(k))) return reply({ error: { code: 'invalid_request' } }, 400);
    if (!query) {
      if (!allowLocalOnly) return reply({ error: { code: 'monitoring_not_configured' } }, 503);
      const to = Math.floor(now() / 1000);
      return reply({ generated_at: now(), from: to - RANGES[range as keyof typeof RANGES], to, range,
        user_ref: userRef, logs_available: false, log_source: 'unconfigured',
        summary: [], trend: [], endpoints: [], errors: [], ingestion: [], recent_requests: [],
        active_users: [], active_users_status: 'unavailable', runtime: await runtimeMetrics() });
    }
    const key = JSON.stringify([range, userRef, route, method]);
    try {
      const hit = cache.get(key);
      if (hit && hit.until > now()) return reply(hit.value);
      let work = pending.get(key);
      if (!work) {
        if (pending.size >= 3) return reply({ error: { code: 'rate_limited' } }, 429);
        work = (async () => {
          const to = Math.floor(now() / 1000); const from = to - RANGES[range as keyof typeof RANGES];
          const queries = monitoringQueries(range as keyof typeof RANGES, userRef, route, method);
          const results = await Promise.all(Object.entries(queries).map(async ([name, sql]) => [name, clean(await query(sql, name === 'ingestion' ? to - 86400 : from, to))] as const));
          const runtime = await runtimeMetrics();
          const users = await activeUsers();
          const value = { ...users, generated_at: now(), from, to, range, user_ref: userRef, ...Object.fromEntries(results), logs_available: true, log_source: 'configured', runtime };
          if (cache.size >= 12) cache.delete(cache.keys().next().value!);
          cache.set(key, { until: now() + 30000, value });
          return value;
        })();
        pending.set(key, work);
        void work.finally(() => pending.delete(key)).catch(() => {});
      }
      return reply(await work);
    } catch { return reply({ error: { code: 'monitoring_unavailable' } }, 503); }
  };
}
