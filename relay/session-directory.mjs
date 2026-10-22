import { randomUUID } from 'node:crypto';

export const SESSION_DIRECTORY_LIMIT = 300;
export const SESSION_DIRECTORY_BATCH = 300;
// Older phones reject responses containing more than 50 rows. Larger batches
// are opt-in through the encrypted request, so either side can upgrade first.
const LEGACY_SESSION_DIRECTORY_BATCH = 50;
const sessionFields = ['id', 'provider', 'name', 'project', 'cwd', 'branch', 'updated_at',
  'status', 'is_subagent', 'root_session_id', 'supports_steering', 'can_interrupt',
  'supports_message_model_settings', 'supports_message_permission_settings', 'fork_mode', 'supports_fork_worktree', 'running_started_at', 'model', 'reasoning_effort', 'service_tier', 'sync_state'];
const projectFields = ['id', 'provider', 'name', 'cwd', 'updated_at'];
const pick = (value, fields) => Object.fromEntries(fields.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
const invalid = () => { throw Object.assign(new Error('Invalid directory cursor'), { code: 'invalid_request' }); };

// Immutable, bounded snapshots let a slow client finish a batch sequence while
// local agents continue changing. No conversation content or config menus.
export class SessionDirectory {
  constructor() {
    this.snapshots = new Map();
    this.replace([], [], '1970-01-01T00:00:00.000Z');
  }
  replace(sessions, projects, observedAt = new Date().toISOString()) {
    const observed = Date.parse(observedAt);
    if (!Number.isFinite(observed) || observed < (this.latestObservedAt ?? -Infinity)) return;
    this.latestObservedAt = observed;
    const seen = new Set();
    const recent = sessions.filter(s => typeof s.id === 'string' && !s.is_subagent)
      .sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0) || a.id.localeCompare(b.id))
      .filter(s => !seen.has(s.id) && seen.add(s.id)).slice(0, SESSION_DIRECTORY_LIMIT)
      .map(s => pick(s, sessionFields));
    const saved = projects.map(p => pick(p, projectFields))
      .sort((a, b) => `${a.provider}:${a.cwd}:${a.id}`.localeCompare(`${b.provider}:${b.cwd}:${b.id}`));
    const content = JSON.stringify([recent, saved]);
    if (this.current?.content === content) return;
    this.current = { revision: randomUUID(), observedAt, sessions: recent, projects: saved, content };
    this.snapshots.set(this.current.revision, this.current);
    while (this.snapshots.size > 32) this.snapshots.delete(this.snapshots.keys().next().value);
  }
  read({ revision = null, cursor = null, batch_size = LEGACY_SESSION_DIRECTORY_BATCH } = {}) {
    if (!Number.isSafeInteger(batch_size) || batch_size < 1 || batch_size > SESSION_DIRECTORY_BATCH) invalid();
    if ((revision !== null && (typeof revision !== 'string' || revision.length > 80)) ||
        (cursor !== null && (typeof cursor !== 'string' || cursor.length > 512))) invalid();
    let from = revision, target = this.current, offset = 0;
    if (cursor !== null) {
      let value;
      try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString()); } catch { invalid(); }
      if (!value || (value.from !== null && typeof value.from !== 'string') ||
          typeof value.to !== 'string' || !Number.isSafeInteger(value.offset) ||
          value.offset < 0 || value.offset > SESSION_DIRECTORY_LIMIT || value.from !== revision) invalid();
      from = value.from;
      target = this.snapshots.get(value.to);
      offset = value.offset;
      // Expired/restarted snapshots restart cleanly; never splice page versions.
      if (!target || (from !== null && !this.snapshots.has(from))) {
        target = this.current; from = null; offset = 0;
      }
    }
    if (!this.snapshots.has(from)) from = null;
    const previous = this.snapshots.get(from);
    const reset = !previous;
    const old = new Map((previous?.sessions ?? []).map(s => [s.id, JSON.stringify(s)]));
    const currentIds = new Set(target.sessions.map(s => s.id));
    const changed = target.sessions.filter(s => old.get(s.id) !== JSON.stringify(s));
    const end = Math.min(offset + batch_size, changed.length);
    return {
      version: 1, revision: target.revision, observed_at: target.observedAt,
      reset: reset && offset === 0,
      sessions: changed.slice(offset, end),
      removed_ids: offset === 0 && previous ? previous.sessions.filter(s => !currentIds.has(s.id)).map(s => s.id) : [],
      ...(offset === 0 && (!previous || JSON.stringify(previous.projects) !== JSON.stringify(target.projects)) ? { projects: target.projects } : {}),
      next_cursor: end < changed.length ? Buffer.from(JSON.stringify({from, to: target.revision, offset: end})).toString('base64url') : null,
    };
  }
}
