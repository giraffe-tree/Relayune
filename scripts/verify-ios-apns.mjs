// Explicit simulator-only smoke test. Tokens and random synthetic keys stay in
// memory. This loopback harness never accesses an account or conversation.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { ApnsClient, readPrivateFile } from '../server/apns-client.mjs';
import { IosPushState, iosPushKey, iosActivityRoute } from '../relay/ios-push.mjs';

const [keyPath, keyId, teamId, portText = '19843', mode = 'auto'] = process.argv.slice(2);
const port = Number(portText);
if (!keyPath || !keyId || !teamId || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Usage: verify-ios-apns.mjs KEY_FILE KEY_ID TEAM_ID [PORT]');
const client = new ApnsClient({environment:'sandbox', keyId, teamId, privateKey:await readPrivateFile(keyPath)});
const contentKey=randomBytes(32).toString('base64url'), key=await iosPushKey(contentKey);
const kid=`sha256:${createHash('sha256').update(Buffer.from(key,'base64url')).digest('base64url')}`;
const labels={running:'正在工作',approval:'等待确认',question:'等待回答',completed:'已完成',failed:'任务失败',stopped:'已停止',stale:'状态待同步',open:'查看任务',review:'前往处理',elapsed:'已用时',updated:'最近同步'};
let turn='';
const binding={key,kid,deviceId:'dev_apns_qa',labels,previewTurnId:turn};
let route='';
function resetFixture() {turn='design-preview-'+randomBytes(8).toString('hex');binding.previewTurnId=turn;route=iosActivityRoute(key,'design-preview',turn);activityToken=undefined;sending=false;state.tasks.clear();for(const timer of timers)clearTimeout(timer);timers.clear();}
const state=new IosPushState();
let token, activityToken, sending=false;
const timers=new Set();
function later(action,delay) { const timer=setTimeout(()=>{timers.delete(timer); void action().catch(()=>console.log(JSON.stringify({testFailed:true})));},delay);timers.add(timer); }
async function send(phase, {expand=false} = {}) {
  const now=Date.now();
  const phases=['running','approval','question','resumed','completed','failed','stopped','stale'];
  if(!phases.includes(phase)) throw new Error('Unknown phase');
  if(!state.tasks.has('design-preview')) state.transition('design-preview',{kind:'turn.started',turn_id:turn},now-240000);
  const terminal=['completed','failed','stopped'].includes(phase);
  const snapshot={sessionId:'design-preview',turnId:turn,state:phase==='resumed'||phase==='stale'?'running':phase,
    startedAt:now-240000,updatedAt:now,staleAt:now+(phase==='stale'?-1000:300000),finishedAt:terminal?now:null,
    startKnown:true,alert:['approval','question','completed','failed','stopped'].includes(phase),expiresAt:now+300000};
  const push=await state.seal(contentKey,snapshot,{direction:'relay_to_web',type:'session.event',device_id:binding.deviceId,session_id:'design-preview',request_id:null,event_seq:phases.indexOf(phase)+1,created_at:new Date(now).toISOString(),expires_at:null});
  const result={phase};
  if(token&&snapshot.alert&&!expand) result.alert=await client.send({token,payload:{aps:{alert:{title:'Relayune QA',body:'Encrypted notification fallback'},'mutable-content':1,sound:'default'},relayune_push:push.envelope}});
  if(activityToken) result.liveActivity=await client.send({token:activityToken,type:'liveactivity',payload:{aps:{timestamp:Math.floor(now/1000),event:push.operation,'relevance-score':200,...(expand?{alert:{title:'Relayune',body:'查看任务',sound:'default'}}:{}),'content-state':{sealed:push.envelope},'stale-date':Math.floor(snapshot.staleAt/1000),...(terminal?{'dismissal-date':Math.floor(now/1000)+120}:{})}}});
  console.log(JSON.stringify(result));return result;
}
const server=createServer(async(req,res)=>{
  if(req.method==='GET' && req.url==='/status') {res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({registered:!!token,activityRegistered:!!activityToken}));return;}
  const phase=req.url?.match(/^\/scenario\/(running|approval|question|resumed|completed|failed|stopped|stale)(?:\/expanded)?$/)?.[1];
  if(req.method==='POST' && (phase||req.url==='/send')) {try{const result=await send(phase||'approval',{expand:req.url.endsWith('/expanded')});res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));}catch{res.writeHead(500).end();}return;}
  if(req.method==='GET' && req.url==='/fixture') {resetFixture();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(binding));return;}
  if(req.method!=='POST'||req.url!=='/registration'){res.writeHead(404).end();return;}
  let input='';for await(const chunk of req){input+=chunk;if(input.length>8192){res.writeHead(413).end();return;}}
  let body;try{body=JSON.parse(input);}catch{res.writeHead(400).end();return;}
  res.writeHead(204).end();
  for(const field of ['permission','keyStored','registered']) if(typeof body[field]==='boolean') console.log(JSON.stringify({[field]:body[field],...(field==='registered'&&body[field]===false?{errorCode:body.errorCode}:{})}));
  if(body.registered&&/^[a-f0-9]{32,512}$/i.test(body.token)) token=body.token;
  const activity=body.activities?.find(a=>a.route===route&&/^[a-f0-9]{32,512}$/i.test(a.token));
  if(activity){activityToken=activity.token;console.log(JSON.stringify({activityRegistered:true}));}
  if(mode!=='manual'&&token&&!sending){sending=true;console.log(JSON.stringify({sendingInSeconds:25}));later(()=>send('approval'),25000);later(()=>send('completed'),60000);}
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({listening:true,port,environment:'sandbox'})));
process.on('SIGINT',()=>{for(const timer of timers)clearTimeout(timer);server.close(()=>process.exit(0));});
