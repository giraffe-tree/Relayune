import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { requestMethod, routeTemplate } from '../shared/request-log.mjs';
import errors from '../shared/request-log-errors.json' with { type: 'json' };
import packageInfo from '../package.json' with { type: 'json' };

const context = new AsyncLocalStorage();
const safeErrors = new Set(errors);
const authTypes = new Set(['anonymous', 'email_session', 'device_token', 'browser_token', 'password', 'email_token']);
const clientTypes = new Set(['web', 'desktop', 'mobile', 'unknown']);

/** No ephemeral key or reuse of authentication secrets. Missing key omits user_ref. */
export function loadLogIdentity(filename) {
  if (!filename) return null;
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || (info.uid !== 0 && info.uid !== process.getuid()) || (info.mode & 0o027) !== 0 || info.size > 4096) {
      throw new Error('request_log_key_file_invalid');
    }
    const value = JSON.parse(readFileSync(fd, 'utf8'));
    if (!/^v[1-9][0-9]{0,3}$/.test(value.version) || !/^[a-f0-9]{64}$/.test(value.key)) {
      throw new Error('request_log_key_invalid');
    }
    return { version: value.version, key: Buffer.from(value.key, 'hex') };
  } catch {
    throw new Error('request_log_key_invalid');
  } finally { closeSync(fd); }
}

export function userReference(email, identity) {
  if (!identity || typeof email !== 'string') return undefined;
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return undefined;
  return `${identity.version}_${createHmac('sha256', identity.key).update('relayune-log-user\0').update(normalized).digest('hex')}`;
}

export function markAuthenticated(email, authType, clientType = 'unknown') {
  const state = context.getStore();
  if (!state || !authTypes.has(authType) || authType === 'anonymous') return;
  state.auth_type = authType;
  state.client_type = clientTypes.has(clientType) ? clientType : 'unknown';
  state.user_ref = userReference(email, state.identity);
  state.account_email = typeof email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ? email.trim().toLowerCase() : undefined;
}

/** Called only after device credentials were validated. Lookup failure must not fail a request. */
export async function markAuthenticatedDevice(resolveEmail) {
  const state = context.getStore();
  if (!state) return;
  markAuthenticated(undefined, 'device_token', 'desktop');
  if (!state.identity) return;
  try { markAuthenticated(await resolveEmail(), 'device_token', 'desktop'); } catch { /* omit user_ref */ }
}

export function markBrowserAuthorization() {
  const state = context.getStore();
  if (state?.auth_type === 'email_session') state.auth_type = 'browser_token';
}

export function recordResponseError(body, status) {
  const state = context.getStore();
  if (!state || status < 400) return;
  const code = typeof body?.error === 'string' ? body.error : body?.error?.code;
  state.error = safeErrors.has(code) ? code : undefined;
}

function fallbackError(status) {
  return ({ 400: 'invalid_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
    405: 'method_not_allowed', 409: 'conflict', 413: 'payload_too_large', 429: 'rate_limited',
    499: 'client_closed' })[status] || (status >= 500 ? 'internal_error' : 'http_error');
}

/**
 * @param {any} request
 * @param {any} response
 * @param {() => any} handler
 * @param {{identity?: {version: string, key: Buffer}|null, version?: string, now?: () => number, write?: (record: any) => void, observeClient?: (email: string, headers: any) => Promise<unknown>}} options
 */
export function runRequestLog(request, response, handler, {
  identity = null, version = packageInfo.version, now = () => performance.now(), observeClient,
  write = (record) => record.level === 'error' ? console.error(JSON.stringify(record)) : console.log(JSON.stringify(record)),
} = {}) {
  const clientMetadata = {
    "x-relay-client-platform": request.headers?.["x-relay-client-platform"],
    "x-relay-client-version": request.headers?.["x-relay-client-version"],
  };
  const started = now();
  const traceId = randomUUID();
  const state = { identity, auth_type: 'anonymous', client_type: 'unknown', user_ref: undefined, error: undefined };
  let logged = false;
  const finish = (early = false) => {
    if (logged) return;
    logged = true;
    const status = early && !response.writableFinished ? 499 : response.statusCode;
    const elapsed = now() - started;
    const record = {
      schema_version: 2,
      service: 'relayune-api',
      service_version: /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version) ? version : '0.0.0',
      event: 'http_request',
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      request_method: requestMethod(request.method),
      request_uri: routeTemplate(request.url),
      status,
      request_time: Number.isFinite(elapsed) ? Math.min(999999999999, Math.max(0, Math.round(elapsed * 1000) / 1000)) : 0,
      ...(status >= 400 ? { error: status === 499 ? 'client_closed' : state.error || fallbackError(status) } : {}),
      trace_id: traceId,
      ...(state.user_ref ? { user_ref: state.user_ref } : {}),
      auth_type: state.auth_type,
      client_type: state.client_type,
    };
    write(record);
    if (status < 400 && state.account_email && observeClient) {
      Promise.resolve().then(() => observeClient(state.account_email, clientMetadata)).catch(() => {});
    }
  };
  response.once('finish', () => finish());
  response.once('close', () => finish(true));
  return context.run(state, handler);
}
