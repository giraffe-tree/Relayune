// Real installed Claude/Kimi CLI; isolated files and bounded execution.
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClaudeCodeAdapter} from '../relay/claude-adapter.mjs';
import {KimiCodeAdapter} from '../relay/kimi-adapter.mjs';
const provider=process.argv[2];
assert.ok(['claude','kimi'].includes(provider));
const cwd=await mkdtemp(join(tmpdir(),`relayune-${provider}-replace-`));
const adapter=new ({claude:ClaudeCodeAdapter,kimi:KimiCodeAdapter}[provider])({workspace:cwd});
const events=[];
const wait=async predicate=>{const deadline=Date.now()+180000;while(!predicate()){if(Date.now()>deadline)throw Error('deadline');await new Promise(r=>setTimeout(r,100));}};
try {
 await adapter.start({emitEvent:async(id,e)=>{events.push({at:new Date().toISOString(),sessionId:id,...e});},requestApproval:async a=>{
  const display=a.action.display.trim();
  const allowed=a.action.cwd===cwd && ['Bash: sleep 180','Bash: Requesting approval to Running: sleep 180','sleep 180',"/bin/zsh -lc 'sleep 180'"].includes(display);
  await adapter.resolveApproval({approvalId:a.approval_id,decision:allowed?'approved':'rejected'});
 }});
 const session=await adapter.createSession({cwd,name:'QA replacement'});
 const first=await adapter.submitMessage({sessionId:session.id,requestId:'old',content:'Use Bash to run exactly sleep 180 now. Do not edit files. After it finishes reply OLD_DONE.'});
 await wait(()=>events.some(e=>e.turn_id===first.turnId && e.kind==='command.started'));
 const clicked=new Date().toISOString();
 const replacement=await adapter.submitMessage({sessionId:session.id,requestId:'new',interruptRunning:true,content:'Reply only QA_REPLACED. Do not run tools.'});
 await wait(()=>events.some(e=>e.turn_id===replacement.turnId && ['turn.completed','turn.failed'].includes(e.kind)));
 const oldTerminal=events.findIndex(e=>e.turn_id===first.turnId && e.kind==='turn.completed' && e.status==='interrupted');
 const newStart=events.findIndex(e=>e.turn_id===replacement.turnId && e.kind==='turn.started');
 assert.ok(oldTerminal>=0 && newStart>oldTerminal);
 assert.ok(events.some(e=>e.turn_id===replacement.turnId && e.kind==='message.completed'&& e.text?.includes('QA_REPLACED')));
 console.log(JSON.stringify({provider,layer:'real-cli-adapter-not-phone',status:'passed',cwd,sessionId:session.id,clicked,events:events.filter(e=>['turn.started','turn.completed','turn.failed'].includes(e.kind))}));
}finally{await adapter.close();}
