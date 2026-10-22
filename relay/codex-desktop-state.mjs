import { connect } from 'node:net';
import { lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const APPROVAL_METHODS = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']);

const failure = () => new Error('无法确认 Codex 电脑端权限，请刷新会话后重试。');
const ROOTS = new Set(['cwd', 'latestThreadSettings', 'latestCollaborationMode', 'currentPermissions', 'threadRuntimeStatus', 'turns', 'turnHistory', 'requests']);
const TURN_FIELDS = new Set(['id', 'turnId', 'status', 'params']);
const SAFE_KEY = key => typeof key === 'number' || (typeof key === 'string' && !['__proto__', 'prototype', 'constructor'].includes(key));
const clone = value => value === undefined ? undefined : structuredClone(value);
const turn = value => value && typeof value === 'object' ? {
  ...(value.id !== undefined ? { id: value.id } : {}),
  ...(value.turnId !== undefined ? { turnId: value.turnId } : {}),
  ...(value.status !== undefined ? { status: value.status } : {}),
  ...(value.params?.cwd !== undefined ? { params: { cwd: value.params.cwd } } : {}),
} : {};
const entities = value => Object.fromEntries(Object.entries(value ?? {}).map(([key, value]) => [key, turn(value)]));
const island = value => ({ id: value?.id, entries: (value?.entries ?? []).map(entry => ({ key: entry.key, value: entry.value })) });
const history = value => value ? { entitiesByKey: entities(value.entitiesByKey),
  // History topology contains references, never turn content.
  islands: (value.islands ?? []).map(island),
} : value;
const turnHistory = value => value?.kind === 'canonical' ? { kind: value.kind, history: history(value.history) } : { kind: value?.kind };
const settings = value => value ? Object.fromEntries(['approvalPolicy', 'approvalsReviewer', 'sandboxPolicy', 'sandbox', 'collaborationMode']
  .filter(key => value[key] !== undefined).map(key => [key, clone(value[key])])) : value;

// Retain only the state used by control operations. Tool items, transcript text
// and inline image payloads never survive initial snapshot handling.
export function projectDesktopState(value) {
  // Detach even the small routing strings from the parsed native snapshot.
  return clone({
    cwd: value?.cwd,
    latestThreadSettings: settings(value?.latestThreadSettings),
    latestCollaborationMode: clone(value?.latestCollaborationMode),
    currentPermissions: settings(value?.currentPermissions),
    threadRuntimeStatus: value?.threadRuntimeStatus ? { type: value.threadRuntimeStatus.type } : undefined,
    turns: (value?.turns ?? []).map(turn),
    turnHistory: turnHistory(value?.turnHistory),
    // Preserve array indices for native patches without keeping unrelated RPCs.
    requests: (value?.requests ?? []).map(request => APPROVAL_METHODS.has(request.method) ? clone(request) : {}),
  });
}

function projectedPatch(patch, state) {
  const path = patch?.path;
  if (!Array.isArray(path) || !path.length || !path.every(SAFE_KEY) || !['add', 'remove', 'replace'].includes(patch.op)) throw failure();
  const root = path[0];
  if (!ROOTS.has(root)) return null;
  let value = patch.value;
  if (root === 'turns') {
    if (path.length === 1) value = (value ?? []).map(turn);
    else if (path.length === 2) value = turn(value);
    else if (!TURN_FIELDS.has(path[2]) || (path[2] === 'params' && path.length > 3 && path[3] !== 'cwd')) return null;
    else if (path[2] === 'params' && path.length === 3) value = { cwd: value?.cwd };
  } else if (root === 'turnHistory') {
    if (path.length === 1) value = turnHistory(value);
    else if (path[1] === 'history') {
      if (path.length === 2) value = history(value);
      else if (path[2] === 'entitiesByKey') {
        if (path.length === 3) value = entities(value);
        else if (path.length === 4) value = turn(value);
        else if (!TURN_FIELDS.has(path[4]) || (path[4] === 'params' && path.length > 5 && path[5] !== 'cwd')) return null;
        else if (path[4] === 'params' && path.length === 5) value = { cwd: value?.cwd };
      } else if (path[2] === 'islands') {
        if (path.length === 3) value = (value ?? []).map(island);
        else if (path.length === 4) value = island(value);
        else if (path[4] === 'entries') {
          if (path.length === 5) value = (value ?? []).map(entry => ({ key: entry.key, value: entry.value }));
          else if (path.length === 6) value = { key: value?.key, value: value?.value };
          else if (!['key', 'value'].includes(path[6])) return null;
        } else if (path[4] !== 'id') return null;
      } else return null;
    } else if (path[1] !== 'kind') return null;
  } else if (root === 'latestThreadSettings' || root === 'currentPermissions') {
    if (path.length === 1) value = settings(value);
    else if (!['approvalPolicy', 'approvalsReviewer', 'sandboxPolicy', 'sandbox', 'collaborationMode'].includes(path[1])) return null;
  } else if (root === 'threadRuntimeStatus') {
    if (path.length === 1) value = { type: value?.type };
    else if (path[1] !== 'type') return null;
  } else if (root === 'requests') {
    if (path.length > 2 && !APPROVAL_METHODS.has(state.requests?.[path[1]]?.method)) {
      // An unrelated RPC can update arbitrary tool fields. Only a complete
      // approval request may replace its placeholder, never a partial patch.
      if (path[2] === 'method' && APPROVAL_METHODS.has(value)) throw failure();
      return null;
    }
    if (patch.op !== 'remove') {
      if (path.length === 1) value = (value ?? []).map(request => APPROVAL_METHODS.has(request.method) ? clone(request) : {});
      else if (path.length === 2) value = APPROVAL_METHODS.has(value?.method) ? clone(value) : {};
    }
  }
  return { ...patch, value: clone(value) };
}

function applyPatch(state, patch) {
  const { path, op, value } = patch;
  let parent = state;
  for (const key of path.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) throw failure();
    parent = parent[key];
  }
  if (!parent || typeof parent !== 'object') throw failure();
  const key = path.at(-1);
  if (Array.isArray(parent)) {
    if (!Number.isInteger(key) || key < 0 || key > parent.length || (op !== 'add' && key === parent.length)) throw failure();
    if (op === 'add') parent.splice(key, 0, value);
    else if (op === 'remove') parent.splice(key, 1);
    else parent[key] = value;
  } else {
    if (op !== 'add' && !Object.hasOwn(parent, key)) throw failure();
    if (op === 'remove') delete parent[key];
    else parent[key] = value;
  }
}

async function checkSocket(socketPath) {
  let identity;
  for (const path of [dirname(socketPath), socketPath]) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new Error('Codex Desktop IPC permissions are unsafe.');
    if (path === socketPath && !info.isSocket()) throw new Error('Invalid Codex Desktop socket.');
    if (path === socketPath) identity = `${info.dev}:${info.ino}`;
  }
  return identity;
}

async function beforeDeadline(operation, deadline, expire = () => {}) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => { expire(); reject(failure()); }, Math.max(0, deadline - Date.now()));
    })]);
  } finally { clearTimeout(timer); }
}

// A pool is owned by one adapter lifecycle. Sessions and socket paths never
// share authority; capacity and idle expiry bound both sockets and retained data.
export function makeDesktopStatePool({ decodeFrames, maxEntries = 16, idleTimeoutMs = 30_000, maxStateBytes = 512 * 1024 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 1 || !Number.isFinite(maxStateBytes) || maxStateBytes < 1) throw new Error('Invalid Codex Desktop state bounds.');
  const entries = new Map();
  const counts = { snapshots: 0, snapshotBytes: 0, patches: 0, reuses: 0, invalidations: 0 };
  let closed = false;
  const pool = {
    get stats() { return { ...counts, entries: entries.size, retainedBytes: [...entries.values()].reduce((n, e) => n + e.bytes, 0) }; },
    invalidate(sessionId, socketPath) {
      for (const entry of entries.values()) if (entry.sessionId === sessionId && (!socketPath || entry.socketPath === socketPath)) entry.close();
    },
    close() { closed = true; for (const entry of [...entries.values()]) entry.close(); },
    async run(sessionId, { socketPath, timeoutMs }, operation) {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw failure();
      const deadline = Date.now() + timeoutMs;
      if (closed) throw failure();
      const socketIdentity = await beforeDeadline(checkSocket(socketPath), deadline);
      if (closed || Date.now() >= deadline) throw failure();
      const key = JSON.stringify([socketPath, sessionId]);
      let entry = entries.get(key);
      if (entry && entry.socketIdentity !== socketIdentity) { entry.close(); entry = null; }
      if (entry) { counts.reuses++; entries.delete(key); entries.set(key, entry); }
      else {
        if (entries.size >= maxEntries) {
          const idle = [...entries.values()].find(value => !value.users);
          if (!idle) throw new Error('Codex Desktop state capacity is busy.');
          idle.close();
        }
        entry = createEntry(sessionId, socketPath, key, socketIdentity);
        entries.set(key, entry);
      }
      entry.users++;
      clearTimeout(entry.idleTimer);
      entry.socket.ref();
      const previous = entry.operation;
      let release;
      entry.operation = new Promise(resolve => { release = resolve; });
      let active = false, expired = false;
      const queued = (async () => {
        try {
          await previous;
          if (expired || entry.dead || Date.now() >= deadline) throw failure();
          active = true;
          entry.timeoutMs = timeoutMs;
          entry.deadline = deadline;
          if (!entry.initialized) await entry.initialize();
          else await entry.discover();
          if (expired || Date.now() >= deadline) { entry.close(); throw failure(); }
          if (entry.dead) throw failure();
          const result = await operation(entry);
          // A busy JS turn can finish promise microtasks before an overdue
          // timer runs. Do not accept a result beyond the absolute budget.
          if (expired || Date.now() >= deadline) { entry.close(); throw failure(); }
          return result;
        } finally {
          active = false;
          release();
          if (--entry.users === 0) {
            if (!entry.cacheable || entry.dead) entry.close();
            else {
              entry.socket.unref();
              entry.idleTimer = setTimeout(() => entry.close(), idleTimeoutMs);
              entry.idleTimer.unref?.();
            }
          }
        }
      })();
      return beforeDeadline(queued, deadline, () => {
        expired = true;
        // A queued caller owns no native operation. Its deadline must not
        // invalidate the subscription currently serving another caller.
        if (active) entry.close();
      });
    },
  };
  function createEntry(sessionId, socketPath, key, socketIdentity) {
    const socket = connect(socketPath), pending = new Map(), waiters = new Set();
    let frameBytes = 0;
    const decoder = decodeFrames({ onFrame: bytes => { frameBytes = bytes; } });
    const entry = { sessionId, socketPath, socketIdentity, socket, initialized: false, dead: false, ownerAbsent: false,
      clientId: 'initializing-client', ownerId: null, revision: null, state: null, bytes: 0, users: 0,
      cacheable: false, timeoutMs: 8000, deadline: Infinity, operation: Promise.resolve(), idleTimer: null,
      close(error = failure()) {
        if (entry.dead) return;
        entry.dead = true;
        counts.invalidations++;
        clearTimeout(entry.idleTimer);
        if (entries.get(key) === entry) entries.delete(key);
        for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
        pending.clear();
        for (const waiter of waiters) waiter.reject(error);
        waiters.clear();
        if (entry.ownerId && !socket.destroyed) entry.following(false);
        entry.state = null; entry.bytes = 0;
        socket.end(); socket.destroy();
      },
      following(value) { send({ type: 'broadcast', sourceClientId: entry.clientId, method: 'thread-stream-following-changed', version: 1,
        targetClientIds: [entry.ownerId], params: { hostId: 'local', conversationId: sessionId, following: value } }); },
      request(method, params, version = 1, targetClientId) {
        if (entry.dead) return Promise.reject(failure());
        const requestId = randomUUID();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => entry.close(), Math.max(0, Math.min(entry.timeoutMs, entry.deadline - Date.now())));
          pending.set(requestId, { resolve, reject, method, targetClientId, timer });
          send({ type: 'request', requestId, sourceClientId: entry.clientId, method, params, version, targetClientId,
            ...(method.startsWith('thread-follower-') ? { hostId: 'local' } : {}) });
        });
      },
      async initialize() {
        const response = await entry.request('initialize', { clientType: 'relayune-settings' }, 0);
        entry.clientId = response.result?.clientId;
        if (!entry.clientId) throw failure();
        await entry.discover();
        entry.initialized = true;
        if (!entry.ownerAbsent) {
          entry.following(true);
          await entry.waitFor(state => !!state);
        }
      },
      async discover() {
        const response = await entry.request('thread-owner-discovery', { hostId: 'local', conversationId: sessionId });
        if (response.ownerAbsent) {
          if (entry.ownerId) { entry.close(); throw failure(); }
          entry.ownerAbsent = true;
          return;
        }
        const ownerId = response.handledByClientId;
        if (!ownerId || (entry.ownerId && entry.ownerId !== ownerId)) { entry.close(); throw failure(); }
        entry.ownerId = ownerId;
      },
      waitFor(predicate, timeoutMs = entry.timeoutMs) {
        if (entry.dead) return Promise.reject(failure());
        if (predicate(entry.state)) return Promise.resolve(entry.state);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { waiters.delete(waiter); reject(failure()); }, Math.max(0, Math.min(timeoutMs, entry.deadline - Date.now())));
          const waiter = { predicate, resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
          waiters.add(waiter);
        });
      },
    };
    function send(message) {
      const body = Buffer.from(JSON.stringify(message)), head = Buffer.alloc(4);
      head.writeUInt32LE(body.length);
      socket.write(Buffer.concat([head, body]));
    }
    function notify() {
      for (const waiter of waiters) if (waiter.predicate(entry.state)) { waiters.delete(waiter); waiter.resolve(entry.state); }
    }
    socket.on('error', () => entry.close()); socket.on('close', () => entry.close());
    socket.on('data', data => {
      try {
        for (const message of decoder(data)) {
          if (message.type === 'client-discovery-request') send({ type: 'client-discovery-response', requestId: message.requestId, response: { canHandle: false } });
          else if (message.type === 'response') {
            const item = pending.get(message.requestId);
            if (!item) continue;
            pending.delete(message.requestId); clearTimeout(item.timer);
            if (message.resultType === 'success' && message.method === item.method && (!item.targetClientId || message.handledByClientId === item.targetClientId)) item.resolve(message);
            else if (item.method === 'thread-owner-discovery' && message.resultType === 'error' && message.error === 'no-client-found' && (message.method == null || message.method === item.method)) item.resolve({ ownerAbsent: true });
            else { item.reject(failure()); entry.close(); }
          } else if (message.type === 'broadcast') {
            if (message.method === 'ipc-connection-reset' || (message.method === 'client-status-changed' && message.params?.clientId === entry.ownerId && message.params?.status !== 'connected')) { entry.close(); continue; }
            if (message.method !== 'thread-stream-state-changed' || message.sourceClientId !== entry.ownerId || message.params?.hostId !== 'local' || message.params?.conversationId !== sessionId ||
                (message.targetClientIds && !message.targetClientIds.includes(entry.clientId))) continue;
            if (message.version !== 11) throw failure();
            const change = message.params.change;
            if (change?.type === 'snapshot') {
              if (entry.revision !== null && (!Number.isSafeInteger(change.revision) || change.revision < entry.revision)) throw failure();
              counts.snapshots++; counts.snapshotBytes += frameBytes;
              entry.state = projectDesktopState(change.conversationState);
              entry.revision = Number.isSafeInteger(change.revision) && change.revision >= 0 ? change.revision : null;
              entry.cacheable = entry.revision !== null;
            } else if (change?.type === 'patches') {
              if (entry.revision === null || change.baseRevision !== entry.revision || !Number.isSafeInteger(change.revision) || change.revision !== entry.revision + 1 || !Array.isArray(change.patches)) throw failure();
              for (const patch of change.patches) { const projected = projectedPatch(patch, entry.state); if (projected) applyPatch(entry.state, projected); }
              entry.revision = change.revision; counts.patches++;
            } else throw failure();
            entry.bytes = Buffer.byteLength(JSON.stringify(entry.state));
            if (entry.bytes > maxStateBytes) { entry.cacheable = false; }
            notify();
          }
        }
      } catch { entry.close(); }
    });
    return entry;
  }
  return pool;
}
