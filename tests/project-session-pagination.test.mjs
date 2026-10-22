import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';
import { ProjectManager } from '../relay/project-manager.mjs';

test('Codex project pages pass native cursor and cwd without a total-count scan', async () => {
  const requests = [];
  const adapter = Object.create(CodexAppServerAdapter.prototype);
  adapter.rememberThread = () => {};
  adapter.toRelaySession = thread => ({ ...thread, provider: 'codex' });
  adapter.request = async (method, params) => {
    requests.push({ method, params });
    return { data: Array.from({length: 5}, (_, i) => ({ id: `${params.cursor ?? 'first'}-${i}`, cwd: '/project' })), nextCursor: params.cursor ? null : 'older-than-80' };
  };
  const first = await adapter.listProjectSessions({ cwd: '/project' });
  const second = await adapter.listProjectSessions({ cwd: '/project', cursor: first.next_cursor });
  assert.equal(first.sessions.length, 5);
  assert.equal(second.sessions.length, 5);
  assert.equal(second.next_cursor, null);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].params.cursor, 'older-than-80');
  assert.equal(requests[1].params.cwd, '/project');
  assert.equal(requests[1].params.limit, 5);
});

test('project paging decorates provider IDs and rejects invalid requests', async () => {
  const adapter = { provider: 'codex', listProjectSessions: async () => ({sessions: [{id:'old'}], next_cursor: null}) };
  const manager = new ProjectManager({ adapter: {
    adapters: new Map([['codex', adapter]]),
    decorateSession: (s, provider) => ({...s, provider, id: `${provider}:${s.id}`}),
  }});
  assert.deepEqual(await manager.sessions({provider:'codex', cwd:'/project'}), {
    sessions: [{id:'codex:old',provider:'codex'}], next_cursor: null,
  });
  await assert.rejects(manager.sessions({provider:'codex',cwd:'relative'}));
  await assert.rejects(manager.sessions({provider:'codex',cwd:'/project',cursor:42}));
});

test('Kimi continues native pages and exposes at most five project sessions', async () => {
  const { KimiCodeAdapter } = await import('../relay/kimi-adapter.mjs');
  const adapter = Object.create(KimiCodeAdapter.prototype);
  adapter.rememberSession = () => {};
  adapter.toRelaySession = s => ({id:s.sessionId, cwd:s.cwd});
  adapter.requestAuthenticated = async (_method, params) => ({
    sessions: Array.from({length: params.cursor ? 2 : 7}, (_, i) => ({sessionId:`${params.cursor ?? 'first'}-${i}`,cwd:'/project'})),
    nextCursor: params.cursor ? null : 'native-next',
  });
  let cursor = null;
  const ids = [];
  do {
    const page = await adapter.listProjectSessions({cwd:'/project',cursor});
    assert.ok(page.sessions.length <= 5);
    ids.push(...page.sessions.map(s=>s.id));
    cursor = page.next_cursor;
  } while(cursor);
  assert.equal(ids.length, 9);
  assert.equal(new Set(ids).size, 9);
});

test('Claude project pages read beyond the recent catalog and stop without a total', async t => {
  const { mkdtemp, mkdir, writeFile, rm, utimes } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { readClaudeSessionCatalog } = await import('../relay/claude-adapter.mjs');
  const home = await mkdtemp(join(tmpdir(), 'relayune-page-'));
  t.after(() => rm(home, {recursive:true,force:true}));
  const directory = join(home,'projects','fixture');
  await mkdir(directory,{recursive:true});
  for (let i=0;i<207;i++) {
    const path=join(directory,`00000000-0000-4000-8000-${String(i).padStart(12,'0')}.jsonl`);
    await writeFile(path,JSON.stringify({type:'user',cwd:i<200?'/other':'/older-project',message:{content:`Task ${i}`}})+'\n');
    await utimes(path,207-i,207-i);
  }
  const first=await readClaudeSessionCatalog({claudeHome:home,cwd:'/older-project',offset:0,limit:6});
  const second=await readClaudeSessionCatalog({claudeHome:home,cwd:'/older-project',offset:5,limit:6});
  assert.equal(first.length,6);
  assert.equal(second.length,2);
  assert.equal(new Set([...first.slice(0,5),...second].map(s=>s.sessionId)).size,7);
});
