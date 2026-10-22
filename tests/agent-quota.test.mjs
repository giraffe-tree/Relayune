import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCodexQuota, mergeClaudeQuota } from '../relay/agent-quota.mjs';
import { CodexAppServerAdapter } from '../relay/codex-adapters.mjs';
import { ClaudeCodeAdapter } from '../relay/claude-adapter.mjs';
const five = { usedPercent: 24, windowDurationMins: 300, resetsAt: 1800000000 };
const seven = { usedPercent: 61, windowDurationMins: 10080, resetsAt: 1800500000 };

test('Codex identifies windows by duration including weekly-only and swapped windows', () => {
  const windows = normalizeCodexQuota({ rateLimits: { primary: seven, secondary: five } });
  assert.deepEqual(windows.map(w => [w.id, w.used_percent]), [['seven_day', 61], ['five_hour', 24]]);
  assert.equal(windows[0].resets_at, new Date(seven.resetsAt * 1000).toISOString());
  assert.equal(normalizeCodexQuota({ rateLimits: { primary: seven } })[0].id, 'seven_day');
  assert.deepEqual(normalizeCodexQuota({ rateLimits: { primary: { ...five, windowDurationMins: 60 } } }), []);
  assert.deepEqual(normalizeCodexQuota({ rateLimits: { limitId: 'model_only', primary: five } }), []);
  assert.equal(normalizeCodexQuota({ rateLimitsByLimitId: { codex: { primary: five } } })[0].used_percent, 24);
  for (const value of [null, '25', NaN, -1]) {
    assert.equal(normalizeCodexQuota({rateLimits:{primary:{...five,usedPercent:value}}})[0].used_percent, null);
  }
});

test('Codex quota works without token usage, caches and handles account changes', async () => {
  const adapter = new CodexAppServerAdapter();
  adapter.readTokenUsage = async () => ({});
  let reads = 0;
  adapter.request = async method => {
    assert.equal(method, 'account/rateLimits/read'); reads++;
    return {rateLimits:{primary:five,secondary:seven}};
  };
  const [a,b] = await Promise.all([adapter.readUsage(), adapter.readUsage()]);
  assert.deepEqual(a,b); assert.equal(reads,1);
  assert.equal(a.codex.quota_windows.length,2);
  await adapter.handleNotification({method:'account/rateLimits/updated',params:{rateLimits:{primary:seven}}});
  assert.equal((await adapter.readUsage()).codex.quota_windows.length,1);
  adapter.request=async()=>{throw new Error('unsupported');};
  const preserved=await adapter.readUsage({refresh:true});
  assert.equal(preserved.codex.quota_windows[0].used_percent,61);
  await adapter.handleNotification({method:'account/updated',params:{}});
  assert.deepEqual(await adapter.readUsage(),{});
});

test('bounded Codex quota request removes pending entry and does not block later requests', async () => {
  const adapter = new CodexAppServerAdapter();
  adapter.child={stdin:{write:()=>{}}};
  await assert.rejects(adapter.request('account/rateLimits/read',{}, {timeoutMs:5}), /timed out/);
  assert.equal(adapter.pending.size,0);
});

test('Claude separately merges 5h and 7d events and never fabricates missing utilization', async () => {
  const adapter = new ClaudeCodeAdapter({catalogReader:async()=>[]});
  const connection={}; adapter.processes.set('session',connection);
  for (const [type,utilization] of [['five_hour',.32],['seven_day',.7]]) {
    await adapter.handleTurnMessage('session',{type:'rate_limit_event',rate_limit_info:{rateLimitType:type, utilization, resetsAt:1800000000,status:'allowed'}},connection);
  }
  let usage=await adapter.readUsage();
  assert.deepEqual(usage.claude.quota_windows.map(w=>w.used_percent),[32,70]);
  await adapter.handleTurnMessage('session',{type:'rate_limit_event',rate_limit_info:{rateLimitType:'five_hour',status:'allowed'}},connection);
  usage=await adapter.readUsage();
  assert.equal(usage.claude.quota_windows.find(w=>w.id==='five_hour').used_percent,null);
  assert.equal(usage.claude.quota_windows.find(w=>w.id==='seven_day').used_percent,70);
  assert.deepEqual(mergeClaudeQuota([], {rateLimitType:'seven_day_opus',utilization:.9}),[]);
});

test('in-flight Codex read cannot restore limits after an account change', async () => {
  const adapter = new CodexAppServerAdapter();
  let resolve;
  adapter.request = () => new Promise(done => { resolve = done; });
  const pending = adapter.readQuota();
  await adapter.handleNotification({method:'account/updated',params:{}});
  resolve({rateLimits:{primary:five}});
  await pending;
  assert.deepEqual(adapter.quotaWindows,[]);
});
