import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgentRuntimeInfoReader,parseAgentVersion,probeAgentVersion} from '../relay/agent-runtime-info.mjs';
test('all agent versions and live state are reported without raw process errors',async()=>{
 let clock=0,calls=0;
 const activeTurns=new Map();
 const adapters=new Map(['codex','kimi','claude','claude-cowork','opencode','zcode','mcode'].map(provider=>[provider,{command:provider,activeTurns:provider==='opencode'?activeTurns:new Map()}]));
 const reader=createAgentRuntimeInfoReader({adapters,status:()=>({kimi:{ready:false,error:'private/path/token'},claude:{ready:false,error:'auth required'},opencode:{ready:true}})},
 {now:()=>clock,probe:async(provider)=>{calls++;return {version:provider==='kimi'?null:'1.2.3',missing:provider==='kimi'};}});
 const info=await reader();assert.equal(info.length,7);assert.equal(info.find(a=>a.provider==='kimi').status,'not_installed');assert.equal(info.find(a=>a.provider==='claude').status,'unavailable');
 assert.doesNotMatch(JSON.stringify(info),/private|token|auth required/);
 activeTurns.set('turn',{});assert.equal((await reader()).find(a=>a.provider==='opencode').status,'running');assert.equal(calls,7);
 clock=60001;await reader();assert.equal(calls,14);
});
test('old or missing adapters are unconfigured, not incorrectly ready',async()=>{
 const info=await createAgentRuntimeInfoReader(undefined)();assert.ok(info.every(a=>a.status==='not_enabled'));
});
test('ZCode reports its runtime version and missing executable is detected',async()=>{
 assert.equal(parseAgentVersion('zcode','zcode-app-cli 3.11.2-22\nzcode-runtime 0.16.5'),'0.16.5');
 assert.deepEqual(await probeAgentVersion('zcode','/nonexistent/relayune-agent'),{version:null,missing:true});
 assert.equal(parseAgentVersion('kimi','unstructured diagnostic'),null);
});
