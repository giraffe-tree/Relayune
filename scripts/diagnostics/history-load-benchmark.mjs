// Local-only read-only benchmark host. It emits numbers, never conversation text.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { WebSocketServer } from 'ws';
import { CodexAppServerAdapter } from '../../relay/codex-adapters.mjs';
import { MacRelay } from '../../relay/mac-relay.mjs';
import { generateE2eeKey, sealJson, openJson } from '../../relay/e2ee.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (!process.env.HISTORY_BASELINE_REF || !process.env.HISTORY_SAMPLES) throw new Error('Set HISTORY_BASELINE_REF and HISTORY_SAMPLES (comma-separated project thread IDs).');
const baselineRef = execFileSync('git', ['rev-parse', process.env.HISTORY_BASELINE_REF], {cwd:root,encoding:'utf8'}).trim();
const directory = await mkdtemp(join(tmpdir(), 'relayune-history-benchmark-'));
const source = execFileSync('git', ['show', `${baselineRef}:relay/codex-adapters.mjs`], { cwd: root, encoding: 'utf8' });
await build({ stdin: { contents: source, resolveDir: join(root, 'relay'), sourcefile: 'baseline.mjs' }, outfile: join(directory, 'baseline.mjs'), platform: 'node', format: 'esm', bundle: true, packages: 'external', logLevel: 'silent' });
const { CodexAppServerAdapter: BaselineAdapter } = await import(pathToFileURL(join(directory, 'baseline.mjs')));
const baselineController = execFileSync('git', ['show', `${baselineRef}:mobile/lib/src/state/app_controller.dart`], {cwd:root,encoding:'utf8'}).replace(/import '([^']+)';/g, (line, path) => !path.includes(':') ? `import 'package:relayune_mobile/${relative(join(root,'mobile/lib'),resolve(root,'mobile/lib/src/state',path)).replaceAll('\\','/')}';` : line);
await writeFile(join(root, 'mobile/tool/history_baseline_controller.dart'), baselineController);
const samples = process.env.HISTORY_SAMPLES.split(',');
const rounds = Number(process.env.HISTORY_BENCHMARK_ROUNDS || 3);
const rows = [];
let current;
const sockets = new Set();
const json = (response, status, value) => { const body = JSON.stringify(value); response.writeHead(status, {'content-type':'application/json','content-length':Buffer.byteLength(body)}); response.end(body); };
const aad = (run, type, requestId = null) => ({direction:'relay_to_web',type,device_id:'benchmark_device',session_id:type === 'session.history' ? run.sessionId : null,request_id:requestId,event_seq:null,created_at:new Date().toISOString(),expires_at:null});
async function cleanupRun() {
  if (!current) return;
  await current.work?.catch(()=>{});
  await current.adapter.close();
  await Promise.allSettled([...(current.adapter.historyPermissionRefreshes?.values() ?? [])]);
  current = null;
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/plan') return json(response,200,{samples:samples.length,rounds,baseline:baselineRef});
    if (url.pathname === '/setup') {
      await cleanupRun();
      const index = Number(url.searchParams.get('sample'));
      const mode = url.searchParams.get('mode');
      const Adapter = mode === 'before' ? BaselineAdapter : CodexAppServerAdapter;
      const adapter = new Adapter({workspace:root});
      const run = { adapter, mode, sample:index, sessionId:samples[index], key:generateE2eeKey(), frames:new Map(), bodyBytes:0, bootstrapCalls:0, responsePolls:0, rpcBytes:0, rpcCalls:0, childReads:0, rpcMs:0, permissionMs:0, readMs:0, envelopeBytes:0, messageCount:0 };
      current = run;
      const rpc = adapter.request.bind(adapter);
      adapter.request = async (method, params) => {
        if (!['initialize','thread/list','thread/read'].includes(method)) throw new Error('Benchmark only permits read-only RPCs.');
        const start = performance.now();
        const result = await rpc(method, params, {timeoutMs:30_000});
        if (run.measuring) {
          run.rpcMs += performance.now()-start;
          run.rpcCalls++;
          run.rpcBytes += Buffer.byteLength(JSON.stringify(result));
          if(method==='thread/read' && params.threadId!==run.sessionId) run.childReads++;
        }
        return result;
      };
      const permissions = adapter.readDesktopPermissions.bind(adapter);
      adapter.readDesktopPermissions = async (...args) => { const start=performance.now(); try {return await permissions(...args);} finally {run.permissionMs += performance.now()-start;} };
      await adapter.start({emitEvent:async()=>{},loadCodexQueueReceipts:async()=>[]});
      const metadata = await adapter.request('thread/read',{threadId:run.sessionId,includeTurns:false});
      const thread = metadata.thread ?? metadata;
      if(thread.cwd!==root) throw new Error('Sample must belong to this project.');
      adapter.rememberThread(thread);
      run.fileBytes = thread.path ? (await stat(thread.path)).size : null;
      run.measuring = true;
      // Representative synthetic catalog/event overhead, held equal in A/B.
      const catalogAad = aad(run,'relay.sync_sessions');
      const catalog = {type:'relay.sync_sessions',sessions:Array.from({length:80},(_,i)=>({id:i===0?run.sessionId:`fixture_${i}`,name:`Benchmark session ${i}`,cwd:'/benchmark',status:'idle',provider:'codex'})),projects:[]};
      const catalogEnvelope = await sealJson(run.key,catalog,catalogAad);
      const events = [];
      for(let i=0;i<200;i++) {
        const eventAad={...aad(run,'session.event'),session_id:run.sessionId,event_seq:i+1};
        const event={session_id:run.sessionId,created_at:eventAad.created_at,event:{kind:'benchmark.noop',padding:'x'.repeat(300)}};
        events.push({device_id:'benchmark_device',session_id:run.sessionId,event_id:`fixture_event_${i}`,cursor:i+1,created_at:eventAad.created_at,aad:eventAad,envelope:await sealJson(run.key,event,eventAad)});
      }
      run.bootstrap={user:{email:'benchmark@example.invalid'},device:{id:'benchmark_device',name:'Benchmark Mac',online:true,codex_connected:true},catalog:{device_id:'benchmark_device',aad:catalogAad,envelope:catalogEnvelope},events,cursor:200,ack_seq:0,queued_commands:0};
      return json(response,200,{session_id:run.sessionId,key:run.key,bootstrap:{...run.bootstrap,catalog:null,events:[]}});
    }
    const run=current;
    if (!run) return json(response,409,{error:'No active run'});
    if (url.pathname === '/command') {
      const parts=[]; for await(const part of request) parts.push(part);
      const frame=JSON.parse(Buffer.concat(parts));
      const command=await openJson(run.key,frame.envelope,frame.aad);
      if(command.type!=='session.read_history' || command.session_id!==run.sessionId) throw new Error('Only the selected history may be read.');
      for(const socket of sockets) socket.send(JSON.stringify({type:'invalidate',device_id:'benchmark_device',scopes:['queue']}));
      run.work=(async()=>{
        const start=performance.now();
        const options={sessionId:run.sessionId,limit:command.payload.limit,before:command.payload.before,includeAgentDetails:command.payload.include_agent_details!==false,maxBytes:command.payload.max_bytes};
        const page=await adapterRead(run,options);
        run.readMs=performance.now()-start;
        const relay=new MacRelay({adapter:run.adapter,statePath:null,workspace:root,deviceId:'benchmark_device'});
        const messages=relay.registerHistoryAttachments(run.sessionId,page.messages);
        run.messageCount=messages.length;
        const value={type:'session.history',request_id:command.request_id,session_id:run.sessionId,...page,messages};
        const route=aad(run,'session.history',command.request_id);
        const envelope=await sealJson(run.key,value,route);
        const output={device_id:'benchmark_device',session_id:run.sessionId,request_id:command.request_id,aad:route,envelope};
        run.envelopeBytes=Buffer.byteLength(JSON.stringify(output));
        run.frames.set(command.request_id,output);
        for(const socket of sockets) socket.send(JSON.stringify({type:'invalidate',device_id:'benchmark_device',scopes:['responses']}));
      })().catch(error=>{run.failure=error.message;console.log(JSON.stringify({sample:run.sample,mode:run.mode,error:'history_read_failed'}));});
      return json(response,200,{request_id:command.request_id,delivery:'delivered'});
    }
    if(url.pathname.startsWith('/responses/')) {
      run.responsePolls++;
      const frame=run.frames.get(url.pathname.split('/').at(-1));
      if(run.failure) return json(response,500,{error:{message:'History benchmark failed',code:'benchmark_failed'}});
      if(!frame) return json(response,404,{error:{message:'Pending',code:'response_pending'}});
      run.bodyBytes+=Buffer.byteLength(JSON.stringify(frame));
      return json(response,200,frame);
    }
    if(url.pathname==='/bootstrap') {
      run.bootstrapCalls++;
      const body=url.searchParams.get('summary_only')==='1' ? {...run.bootstrap,catalog:null,events:[]} : run.bootstrap;
      run.bodyBytes+=Buffer.byteLength(JSON.stringify(body));
      return json(response,200,body);
    }
    if(url.pathname==='/result') {
      const parts=[];for await(const part of request) parts.push(part);
      const mobile=JSON.parse(Buffer.concat(parts));
      const row={mode:run.mode,sample:run.sample,rollout_bytes:run.fileBytes,read_ms:run.readMs,rpc_ms:run.rpcMs,rpc_calls:run.rpcCalls,rpc_bytes:run.rpcBytes,child_reads:run.childReads,permission_ms:run.permissionMs,permission_pending:(run.adapter.historyPermissionRefreshes?.size ?? 0)>0,messages:run.messageCount,history_response_bytes:run.envelopeBytes,download_body_bytes:run.bodyBytes,bootstrap_calls:run.bootstrapCalls,response_polls:run.responsePolls,...mobile};
      rows.push(row);
      await writeFile(join(directory,'results.json'),JSON.stringify({baseline:baselineRef,scope:'iOS simulator; actual read-only Codex history; loopback transport; synthetic 80-session catalog and 200 events; fresh controllers and adapters; OS disk caches not flushed',rows},null,2));
      console.log(JSON.stringify(row));
      return json(response,200,{ok:true});
    }
    return json(response,404,{error:'Unknown path'});
  } catch(error) {console.log(JSON.stringify({error:error.message}));json(response,500,{error:{message:'Local benchmark failed',code:'benchmark_failed'}});}
});
async function adapterRead(run,options) {
  if(run.adapter.historyPages?.size) throw new Error('Cold run unexpectedly has cached history.');
  return run.adapter.readHistory(options);
}
const wss=new WebSocketServer({server});
wss.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
await new Promise(resolve=>server.listen(18764,'127.0.0.1',resolve));
console.log(JSON.stringify({ready:true,port:18764,result_path:join(directory,'results.json')}));
async function close(){await cleanupRun();for(const socket of sockets)socket.close();wss.close();server.close();await writeFile(join(root,'mobile/tool/history_baseline_controller.dart'), "// Replaced temporarily by the local history benchmark host.\nexport 'package:relayune_mobile/src/state/app_controller.dart';\n");process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);
