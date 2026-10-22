import test from 'node:test';
import assert from 'node:assert/strict';
import { findLiveTurnCompletion, hasLiveTurnReply, acceptsLiveTurnCompletion, selectLiveClaudeManualMode } from '../scripts/lib/agent-live-turn.mjs';

test('direct turns match their own terminal event', () => {
  const result = { mode: 'started', turnId: 'turn-a' };
  assert.equal(findLiveTurnCompletion(result, 'req-a', [{kind:'turn.completed',turn_id:'other'}]), null);
  assert.deepEqual(findLiveTurnCompletion(result, 'req-a', [{kind:'turn.completed',turn_id:'turn-a',status:'completed'}]), {turnId:'turn-a',status:'completed'});
});
test('native Claude and Kimi end_turn is successful, other reasons stay distinct', () => {
  const result = { mode: 'started', turnId: 'native' };
  for (const provider of ['claude', 'kimi']) {
    assert.deepEqual(findLiveTurnCompletion(result, 'request', [{kind:'turn.completed', turn_id:'native', provider, status:'end_turn'}]), {turnId:'native', status:'completed'});
  }
  for (const status of ['max_tokens', 'interrupted', 'failed']) {
    assert.deepEqual(findLiveTurnCompletion(result, 'request', [{kind:'turn.completed', turn_id:'native', status}]), {turnId:'native', status});
  }
});
test('queued acceptance resolves actual turn and rejects unrelated requests', () => {
  const result = { mode:'queued',turnId:null };
  const events = [{kind:'codex.queue.updated',request_id:'other',turn_id:'wrong',status:'completed'},
    {kind:'codex.queue.updated',request_id:'req-a',turn_id:'actual',status:'running'}];
  assert.equal(findLiveTurnCompletion(result,'req-a',events),null);
  events.push({kind:'codex.queue.updated',request_id:'req-a',client_message_id:'req-a',turn_id:'actual',status:'completed'});
  assert.deepEqual(findLiveTurnCompletion(result,'req-a',events),{turnId:'actual',status:'completed'});
});
test('queued failures and interrupted outcomes are terminal, unconfirmed is not', () => {
  const result = {mode:'queued',turnId:null};
  for (const status of ['failed','interrupted']) assert.deepEqual(findLiveTurnCompletion(result,'a',[{kind:'codex.queue.updated',request_id:'a',turn_id:'t',status}]),{turnId:'t',status});
  assert.equal(findLiveTurnCompletion(result,'a',[{kind:'codex.queue.updated',request_id:'a',turn_id:'t',status:'unconfirmed'}]),null);
  assert.equal(findLiveTurnCompletion(result,'a',[{kind:'codex.queue.updated',request_id:'a',client_message_id:'other',turn_id:'t',status:'completed'}]),null);
});
test('history reply validation cannot reuse a prior turn answer', () => {
  assert.equal(hasLiveTurnReply([{role:'codex',turn_id:'old',content:'TOKEN'}],'new','TOKEN'),false);
  assert.equal(hasLiveTurnReply([{role:'codex',turn_id:'new',content:'TOKEN'}],'new','TOKEN'),true);
});

test('only the rejected Codex tool fixture accepts native interruption', () => {
  const interrupted = {turnId:'denied-turn', status:'interrupted'};
  assert.equal(acceptsLiveTurnCompletion(interrupted, {provider:'codex'}), false);
  assert.equal(acceptsLiveTurnCompletion(interrupted, {provider:'codex', rejectedTool:true}), true);
  for (const provider of ['claude','kimi']) assert.equal(acceptsLiveTurnCompletion(interrupted, {provider,rejectedTool:true}), false);
  for (const status of ['failed','max_tokens','unconfirmed']) {
    assert.equal(acceptsLiveTurnCompletion({status}, {provider:'codex',rejectedTool:true}), false);
  }
  assert.equal(acceptsLiveTurnCompletion({status:'completed'}, {provider:'claude'}), true);
  assert.deepEqual(interrupted, {turnId:'denied-turn',status:'interrupted'});
});
test('manual Claude fixture selects only CLI-advertised manual aliases', () => {
  assert.equal(selectLiveClaudeManualMode(['auto','manual','default']), 'manual');
  assert.equal(selectLiveClaudeManualMode(['bypassPermissions','default']), 'default');
  for (const modes of [undefined, [], ['auto','bypassPermissions','acceptEdits']]) {
    assert.throws(() => selectLiveClaudeManualMode(modes), /did not advertise/);
  }
});
