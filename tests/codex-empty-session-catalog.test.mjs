import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';

test('new empty sessions remain discoverable until the native catalog includes them', async () => {
  const a = new CodexAppServerAdapter({ workspace: '/tmp/core-catalog' });
  a.loadModelCatalog = async () => [];
  a.syncExternalRolloutActivity = async () => {};
  let catalog = [];
  a.request = async method => {
    if (method === 'thread/start') return { thread: { id: 'new-empty', cwd: '/tmp/core-catalog', status: { type: 'idle' }, createdAt: 1, updatedAt: 1 } };
    if (method === 'thread/list') return { data: catalog };
    throw new Error(`Unexpected ${method}`);
  };
  const created = await a.createSession({ cwd: '/tmp/core-catalog', name: 'Empty QA' });
  const initial = await a.listSessions();
  assert.equal(initial.filter(s => s.id === created.id).length, 1);
  assert.equal(initial.find(s => s.id === created.id).name, 'Empty QA');
  catalog = [{ id: created.id, cwd: created.cwd, name: 'Native title', status: { type: 'idle' }, createdAt: 1, updatedAt: 2 }];
  assert.equal((await a.listSessions()).filter(s => s.id === created.id).length, 1);
  catalog = [];
  assert.equal((await a.listSessions()).some(s => s.id === created.id), false, 'once published, archived or excluded native sessions must not be resurrected');
});
