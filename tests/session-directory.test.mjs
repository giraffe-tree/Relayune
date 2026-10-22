import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionDirectory } from '../relay/session-directory.mjs';
import { MacRelay } from '../relay/mac-relay.mjs';
import { generateE2eeKey, importE2eeKey, keyIdForKey, openJson } from '../relay/e2ee.mjs';
const session = (i, extra = {}) => ({ id: `s${i}`, name: `Task ${i}`, provider: 'codex', cwd: '/work',
  updated_at: new Date(1700000000000 + i * 1000).toISOString(), ...extra });
const all = (directory, revision = null) => {
  const pages = []; let cursor = null;
  do {
    const page = directory.read({revision, cursor}); pages.push(page);
    if (page.reset) revision = null;
    cursor = page.next_cursor;
  } while(cursor);
  return pages;
};

test('directory retains latest 300 across providers, batches 50 and strips heavy metadata', () => {
  const directory = new SessionDirectory();
  directory.replace(Array.from({length: 360}, (_, i) => session(i, {
    provider: i % 2 ? 'claude' : 'codex', session_config_options: [{private: 'config'}], messages: ['private body'],
  })), []);
  const pages = all(directory);
  assert.equal(pages.length, 6);
  const rows = pages.flatMap(p => p.sessions);
  assert.equal(rows.length, 300);
  assert.equal(rows[0].id, 's359'); assert.equal(rows.at(-1).id, 's60');
  assert.equal(new Set(rows.map(s => s.id)).size, 300);
  assert.ok(pages.every(p => p.sessions.length === 50));
  assert.doesNotMatch(JSON.stringify(pages), /private|session_config_options|messages/);
  const unchanged = directory.read({revision: pages.at(-1).revision});
  assert.deepEqual(unchanged.sessions, []); assert.deepEqual(unchanged.removed_ids, []);
  assert.equal(unchanged.reset, false); assert.equal('projects' in unchanged, false);
});

test('new phones fetch all 300 summaries at once and retain incremental responses', () => {
  const directory = new SessionDirectory();
  const rows = Array.from({length: 360}, (_, i) => session(i, {
    messages: ['private body'], session_config_options: [{private: 'config'}],
  }));
  directory.replace(rows, []);
  const first = directory.read({batch_size: 300});
  assert.equal(first.sessions.length, 300);
  assert.equal(first.sessions[0].id, 's359');
  assert.equal(first.sessions.at(-1).id, 's60');
  assert.equal(first.next_cursor, null);
  assert.equal(first.reset, true);
  assert.doesNotMatch(JSON.stringify(first), /private|session_config_options|messages/);
  const unchanged = directory.read({revision: first.revision, batch_size: 300});
  assert.deepEqual(unchanged.sessions, []);
  assert.equal('projects' in unchanged, false);
  directory.replace(rows.map(s => s.id === 's359' ? {...s, name: 'Renamed'} : s), []);
  const delta = directory.read({revision: first.revision, batch_size: 300});
  assert.deepEqual(delta.sessions.map(s => s.id), ['s359']);
  assert.equal(delta.next_cursor, null);
});

test('a phone can finish a saved legacy cursor with a larger batch without mixing snapshots', () => {
  const directory = new SessionDirectory();
  directory.replace(Array.from({length: 300}, (_, i) => session(i)), []);
  const first = directory.read();
  assert.equal(first.sessions.length, 50);
  directory.replace([session(500)], []);
  const remaining = directory.read({cursor: first.next_cursor, batch_size: 300});
  assert.equal(remaining.revision, first.revision);
  assert.equal(remaining.sessions.length, 250);
  assert.equal(remaining.next_cursor, null);
  assert.equal(remaining.sessions.some(s => s.id === 's500'), false);
  const ids = [...first.sessions, ...remaining.sessions].map(s => s.id);
  assert.equal(new Set(ids).size, 300);
});

test('batch requests reject unbounded or malformed sizes', () => {
  const directory = new SessionDirectory();
  for (const batch_size of [0, -1, 301, 1.5, '300', null, Infinity]) {
    assert.throws(() => directory.read({batch_size}));
  }
});

test('delta sends only updates, additions and evictions; pages hold a stable snapshot', () => {
  const directory = new SessionDirectory();
  const rows = Array.from({length: 300}, (_, i) => session(i));
  directory.replace(rows, [{id: 'p', cwd: '/work', name: 'Work', provider: 'codex'}]);
  const revision = all(directory).at(-1).revision;
  directory.replace([...rows.slice(1).map(s => s.id === 's150' ? {...s, name: 'Renamed'} : s), session(300)], []);
  const delta = directory.read({revision});
  assert.deepEqual(delta.sessions.map(s => s.id), ['s300', 's150']);
  assert.deepEqual(delta.removed_ids, ['s0']); assert.deepEqual(delta.projects, []);
  const first = directory.read();
  directory.replace([session(500)], []);
  const second = directory.read({cursor: first.next_cursor});
  assert.equal(second.revision, first.revision);
  assert.equal(second.sessions.length, 50);
  assert.equal(second.sessions.some(s => s.id === 's500'), false);
});

test('expired snapshots and relay restart reset cleanly; malformed cursors are rejected', () => {
  const directory = new SessionDirectory();
  directory.replace(Array.from({length: 100}, (_, i) => session(i)), []);
  const first = directory.read();
  for (let i = 0; i < 40; i++) directory.replace([session(1000 + i)], []);
  assert.ok(directory.snapshots.size <= 32);
  const reset = directory.read({cursor: first.next_cursor});
  assert.equal(reset.reset, true); assert.equal(reset.sessions[0].id, 's1039');
  directory.replace(Array.from({length: 100}, (_, i) => session(i)), []);
  assert.equal(all(directory, 'previous-relay-revision').flatMap(p => p.sessions).length, 100);
  assert.throws(() => directory.read({cursor: 'not-json'}));
  assert.throws(() => directory.read({revision: 42}));
});

test('opted-in phone catalog stops resending sessions; legacy browser still receives them', async () => {
  const relay = new MacRelay({adapter: {}, statePath: null, readAgentRuntimeInfo: async () => []});
  const key = await importE2eeKey(generateE2eeKey()); const keyId = await keyIdForKey(key);
  relay.activeBrowserKeys.set('phone', {browserId: 'phone', key, keyId});
  relay.activeBrowserKeys.set('web', {browserId: 'web', key, keyId});
  relay.directoryClients.set('phone', keyId);
  const catalog = {type: 'relay.sync_sessions', sessions: [session(1)], projects: []};
  const frames = await relay.encodeRemoteMessage(catalog);
  for (const frame of frames) relay.rememberSuccessfulCatalogUpload(frame);
  assert.deepEqual((await openJson(key, frames.find(f => f.browser_id === 'phone').envelope, frames[0].aad)).sessions, []);
  const next = await relay.encodeRemoteMessage({...catalog, sessions: [session(2)]});
  assert.deepEqual(next.map(f => f.browser_id), ['web']);
  assert.equal(relay.sessionDirectory.read().sessions[0].id, 's2');
});

test('300-row directory request reads memory and bypasses a blocked native project queue', async () => {
  const relay = new MacRelay({adapter: {listSessions: () => { throw new Error('must not query'); }}, statePath: null});
  relay.sessionDirectory.replace(Array.from({length: 300}, (_, i) => session(i)), []);
  relay.projectCommandChain = new Promise(() => {});
  relay.validateCommand = () => true;
  relay.browserForRequest = () => ({browserId: 'phone', keyId: 'key'});
  const sent = []; relay.send = message => sent.push(message);
  relay.acknowledgeCommand = () => {};
  await relay.handleProjectCommand({type: 'project.sessions', request_id: 'r', payload: {directory_sync: true, batch_size: 300}});
  assert.equal(sent[0].directory.sessions[0].id, 's299');
  assert.equal(sent[0].directory.sessions.length, 300);
  assert.equal(sent[0].directory.next_cursor, null);
  assert.equal(relay.directoryClients.get('phone'), 'key');
});

test('Codex collects three native pages for a 300-row cache instead of stopping at 80', async () => {
  const { CodexAppServerAdapter } = await import('../relay/codex-adapters.mjs');
  const adapter = Object.create(CodexAppServerAdapter.prototype);
  const calls = [];
  Object.assign(adapter, {
    unpublishedCreatedThreads: new Set(), threadMetadata: new Map(), permissionRefreshAt: new Map(), historyPermissionRefreshes: new Set(),
    loadModelCatalog: async () => [], rememberThread: () => {}, syncExternalRolloutActivity: async () => {}, toRelaySession: s => s,
    request: async (method, params) => {
      assert.equal(method, 'thread/list'); calls.push(params);
      const offset = Number(params.cursor ?? 0);
      return { data: Array.from({length: 100}, (_, i) => session(offset + i)), nextCursor: String(offset + 100) };
    },
  });
  assert.equal((await adapter.listSessions()).length, 300);
  assert.deepEqual(calls.map(c => c.cursor), [null, '100', '200']);
  assert.ok(calls.every(c => c.limit === 100));
});

test('concurrent native refreshes are coalesced and capped after provider merge', async () => {
  let release; let calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const relay = new MacRelay({ adapter: {listSessions: async () => { calls++; return pending; }}, statePath: null });
  const a = relay.readSessionCatalog(); const b = relay.readSessionCatalog();
  assert.equal(calls, 1);
  release(Array.from({length: 500}, (_, i) => session(i)));
  assert.equal((await a).length, 300); assert.equal((await b)[0].id, 's499');
  assert.equal(relay.lastSessionCatalog.length, 300);
});

test('slow project and usage reads cannot hold back fresh session states or pile up', async () => {
  let releaseProjects, releaseUsage;
  let projects = 0, usage = 0, reads = 0;
  const relay = new MacRelay({statePath: null, readAgentRuntimeInfo: async () => [],
    adapter: { listSessions: async () => [session(++reads, {status: 'active'})],
      readUsage: () => { usage++; return new Promise(resolve => { releaseUsage = resolve; }); } }});
  relay.ready = true;
  relay.lastProjectCatalog = [{id: 'cached-project', name: 'cached'}];
  relay.projectManager.listProjects = () => { projects++; return new Promise(resolve => { releaseProjects = resolve; }); };
  try {
    await relay.syncSessionCatalog();
    assert.equal(relay.sessionDirectory.read().sessions[0].id, 's1');
    await relay.syncSessionCatalog();
    assert.equal(relay.sessionDirectory.read().sessions[0].id, 's2');
    assert.equal(projects, 1);
    assert.equal(usage, 1);
    releaseProjects([{id: 'new-project', name: 'new'}]);
    releaseUsage({codex: {daily: []}});
    await Promise.all([relay.projectCatalogRead, relay.usageCatalogRead]);
    relay.projectManager.listProjects = async () => relay.lastProjectCatalog;
    relay.adapter.readUsage = async () => relay.usageCatalog;
    await relay.syncSessionCatalog();
    assert.equal(relay.sessionDirectory.read().projects[0].id, 'new-project');
    assert.deepEqual(relay.usageCatalog, {codex: {daily: []}});
  } finally {
    releaseProjects?.([]); releaseUsage?.({});
    relay.closed = true;
    await Promise.allSettled([...relay.operations]);
  }
});
