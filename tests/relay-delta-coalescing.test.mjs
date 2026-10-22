import assert from 'node:assert/strict';
import test from 'node:test';
import { MacRelay } from '../relay/mac-relay.mjs';

test('concurrent adjacent deltas share one event without moving the terminal', async () => {
  const relay = new MacRelay({serverUrl:'https://example.test',deviceId:'test',deviceToken:'test',adapter:{},statePath:null});
  const events=[];
  relay.outbox.appendWithSequence=async create=>{ const record=await create(events.length+1);events.push(record);return record; };
  relay.send=()=>true;
  // Inspect the pre-encryption event through push transition, with no browser keys.
  const plain=[];
  relay.iosPushState.transition=(_,event)=>{plain.push(event);return null;};
  const delta=text=>({kind:'message.delta',turn_id:'turn',item_id:'item',text});
  await Promise.all([relay.emitEvent('session',delta('a')),relay.emitEvent('session',delta('b')),relay.emitEvent('session',{kind:'turn.completed',turn_id:'turn'})]);
  assert.deepEqual(plain.map(e=>[e.kind,e.text]),[['message.delta','ab'],['turn.completed',undefined]]);
});

import { DeltaCoalescer } from '../relay/delta-coalescer.mjs';

test('delta merge respects session, turn, item, phase and routing boundaries', async () => {
  const written=[];
  const coalescer=new DeltaCoalescer(async (session,event,extra)=>written.push({session,...event,extra}));
  const base={kind:'message.delta',turn_id:'t',item_id:'i',text:'a'};
  const pending=[
    coalescer.enqueue('s',base),
    coalescer.enqueue('other',base),
    coalescer.enqueue('other',{...base,turn_id:'t2'}),
    coalescer.enqueue('other',{...base,turn_id:'t2',item_id:'i2'}),
    coalescer.enqueue('other',{...base,turn_id:'t2',item_id:'i2',message_phase:'commentary'}),
    coalescer.enqueue('other',{...base,turn_id:'t2',item_id:'i2',message_phase:'commentary'},{agent_id:'child'}),
  ];
  coalescer.flush(); await Promise.all(pending);
  assert.equal(written.length,6);
  assert.ok(written.every(e=>e.text==='a'));
});

test('unidentified deltas pass through and UTF-8 byte bound forces ordered flush', async () => {
  const written=[];
  const coalescer=new DeltaCoalescer(async (_,e)=>written.push(e),{maxBytes:4});
  const base={kind:'message.delta',turn_id:'t',item_id:'i'};
  const pending=[coalescer.enqueue('s',{...base,text:'中'}),coalescer.enqueue('s',{...base,text:'文'}),coalescer.enqueue('s',{kind:'message.delta',text:'x'})];
  await Promise.all(pending);
  assert.deepEqual(written.map(e=>e.text),['中','文','x']);
});

test('a lone delta flushes without requiring a subsequent terminal', async () => {
  const written=[];
  const coalescer=new DeltaCoalescer(async (_,e)=>written.push(e),{windowMs:1});
  await coalescer.enqueue('s',{kind:'message.delta',turn_id:'t',item_id:'i',text:'a'});
  assert.equal(written.length,1);
});

test('a failed persisted batch rejects every contributing caller and permits recovery', async () => {
  let failing = true;
  const written = [];
  const coalescer = new DeltaCoalescer(async (_, event) => {
    if (failing) throw new Error('fixture persistence failure');
    written.push(event.text);
  });
  const delta = text => ({kind:'message.delta',turn_id:'t',item_id:'i',text});
  const settled = Promise.allSettled([
    coalescer.enqueue('s',delta('a')),
    coalescer.enqueue('s',delta('b')),
  ]);
  coalescer.flush();
  assert.ok((await settled).every(result => result.status === 'rejected'));
  failing = false;
  const next = coalescer.enqueue('s',delta('c'));
  coalescer.flush();
  await next;
  assert.deepEqual(written,['c']);
});

test('shutdown flushes pending text and writes late adapter deltas without timers', async () => {
  const written = [];
  const coalescer = new DeltaCoalescer(async (_, event) => written.push(event.text));
  const delta = text => ({kind:'message.delta',turn_id:'t',item_id:'i',text});
  const before = coalescer.enqueue('s',delta('before'));
  coalescer.close();
  const late = coalescer.enqueue('s',delta('late'));
  assert.equal(coalescer.pending, null);
  await Promise.all([before,late]);
  assert.deepEqual(written,['before','late']);
});
