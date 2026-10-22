import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCodeAdapter } from '../relay/claude-adapter.mjs';
import { KimiCodeAdapter } from '../relay/kimi-adapter.mjs';
import { PiAdapter } from '../relay/pi-adapter.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const Adapter of [ClaudeCodeAdapter, KimiCodeAdapter, PiAdapter]) {
  test(`${Adapter.name}: replacement waits for terminal, preserves payload and peer`, async () => {
    const adapter = new Adapter();
    const old = {id:'old'};
    adapter.activeTurns.set('S', old); adapter.activeTurns.set('T','peer');
    const calls=[];
    let cancel;
    const cancelled=new Promise(resolve => {cancel=resolve;});
    adapter.interruptTurnUnlocked=async ({sessionId})=>{calls.push(['stop',sessionId]);cancel();};
    adapter.submitMessageUnlocked=async options=>{calls.push(['start',options]);return {turnId:'new'};};
    const payload={sessionId:'S',interruptRunning:true,content:'replace',requestId:'same-id',attachments:[{base64:'image'}]};
    const sending=adapter.submitMessage(payload);
    await cancelled; await delay(35);
    assert.deepEqual(calls,[['stop','S']]);
    adapter.activeTurns.delete('S');
    assert.equal((await sending).turnId,'new');
    assert.equal(calls[1][1],payload);
    assert.equal(adapter.activeTurns.get('T'),'peer');
    assert.equal(adapter.sessionControls.size,0);
  });
  test(`${Adapter.name}: unconfirmed stop never sends and control queue recovers`,async()=>{
    const adapter=new Adapter();adapter.controlTimeoutMs=20;adapter.activeTurns.set('S','old');
    adapter.interruptTurnUnlocked=async()=>{};
    let starts=0;adapter.submitMessageUnlocked=async()=>{starts++;};
    await assert.rejects(adapter.submitMessage({sessionId:'S',interruptRunning:true}),/not.*confirmed/);
    assert.equal(starts,0);assert.equal(adapter.activeTurns.get('S'),'old');
    adapter.activeTurns.delete('S');
    await adapter.submitMessage({sessionId:'S',interruptRunning:true});assert.equal(starts,1);
  });
}
