import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const dir=mkdtempSync(join(tmpdir(),'relayune-monitor-test-'));
await build({stdin:{contents:'export * from "./server/monitoring.ts"; export {EmailAuth} from "./server/email-auth.ts"; export {createMonitoringDirectory} from "./server/monitoring-users.ts";',resolveDir:process.cwd()},outfile:join(dir,'api.cjs'),bundle:true,platform:'node',format:'cjs'});
const {createMonitoring,createSlsQuery,monitoringQueries,EmailAuth,createMonitoringDirectory}=createRequire(import.meta.url)(join(dir,'api.cjs'));
const MONITOR_EMAIL='admin@example.test';
const slsConfig={project:'test-project',logstore:'test-logstore',region:'cn-test',internal:true};
test.after(()=>rmSync(dir,{recursive:true,force:true}));
const req=(suffix='',opts={})=>new Request('https://relayune.test/api/monitoring'+suffix,opts);

test('only a verified allowed email session can read monitoring, even after cache fill',async()=>{
 let queries=0;
 const api=createMonitoring({adminEmail:MONITOR_EMAIL,query:async()=>{queries++;return[{requests:'2',secret:'must-not-escape'}];}});
 for(const email of [MONITOR_EMAIL,'another@gmail.com',null]){
  const auth=new EmailAuth({collection(){return {async findOne(){return email?{email,expires_at:new Date(Date.now()+86400000)}:null;}};}},{publicOrigin:'https://relayune.test',mailFrom:'noreply@test.local'});
  const identity=await auth.authenticate({headers:{cookie:'relay_session='+'a'.repeat(43),'oai-authenticated-user-email':MONITOR_EMAIL}});
  const response=await api(req('',{headers:{'oai-authenticated-user-email':MONITOR_EMAIL,authorization:'Bearer fake'}}),identity);
  assert.equal(response.status,email===MONITOR_EMAIL?200:email?403:401);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.ok(!(await response.text()).includes('must-not-escape'));
 }
 assert.equal(queries,6);
});

test('rejects SQL, invalid ranges, user-ref injection and methods before querying',async()=>{
 let calls=0;const api=createMonitoring({adminEmail:MONITOR_EMAIL,query:async()=>{calls++;return[];}});
 for(const q of ['?range=__proto__','?range=365d','?query=SELECT+secret','?user_ref=v1_%27+OR+1=1'])assert.equal((await api(req(q),MONITOR_EMAIL)).status,400);
 assert.equal((await api(req('',{method:'POST'}),MONITOR_EMAIL)).status,405);
 assert.equal(calls,0);
});

test('coalesces requests and reauthenticates before serving cached data',async()=>{
 let calls=0;let time=100000;const api=createMonitoring({adminEmail:MONITOR_EMAIL,now:()=>time,query:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return[];}});
 await Promise.all([api(req(),MONITOR_EMAIL),api(req(),MONITOR_EMAIL)]);assert.equal(calls,6);
 await api(req(),MONITOR_EMAIL);assert.equal(calls,6);
 assert.equal((await api(req(),null)).status,401);
 time+=31000;await api(req(),MONITOR_EMAIL);assert.equal(calls,12);
});

test('provider errors are sanitized and not cached as zero metrics',async()=>{
 let fail=true;const api=createMonitoring({adminEmail:MONITOR_EMAIL,query:async()=>{if(fail)throw new Error('SECRET provider key');return[];}});
 let r=await api(req(),MONITOR_EMAIL);assert.equal(r.status,503);assert.ok(!(await r.text()).includes('SECRET'));
 fail=false;r=await api(req(),MONITOR_EMAIL);assert.equal(r.status,200);
 assert.equal((await createMonitoring({adminEmail:MONITOR_EMAIL,query:null})(req(),MONITOR_EMAIL)).status,503);
});

test('all duration SQL uses version conversion and user filter excludes ingestion freshness',()=>{
 const ref='v1_'+'a'.repeat(64),queries=monitoringQueries('24h',ref);
 for(const name of ['summary','trend','endpoints','errors']){assert.ok(queries[name].includes('request_time * 1000'));assert.ok(queries[name].includes(ref));}
 assert.ok(!queries.ingestion.includes(ref));assert.ok(queries.trend.includes('/ 1440'));
});

test('SLS client signs GETs, rejects unsafe files, redirects and incomplete queries',async()=>{
 const file=join(dir,'key.json');writeFileSync(file,JSON.stringify({access_key_id:'synthetic-id',access_key_secret:'synthetic-secret',security_token:'synthetic-token'}),{mode:0o600});
 let calls=0;
 const fetcher=async(url,options)=>{calls++;assert.ok(url.startsWith('https://test-project.cn-test-internal.log.aliyuncs.com/logstores/test-logstore?'));assert.equal(options.redirect,'error');assert.ok(options.headers.Authorization.startsWith('LOG synthetic-id:'));assert.equal(options.headers['x-acs-security-token'],'synthetic-token');return Response.json([],{headers:{'x-log-progress':'Complete'}});};
 await createSlsQuery(file,slsConfig,fetcher)('* | SELECT count(*)',1,2);assert.equal(calls,1);
 chmodSync(file,0o644);await assert.rejects(()=>createSlsQuery(file,slsConfig,fetcher)('*',1,2));assert.equal(calls,1);chmodSync(file,0o600);
 symlinkSync(file,join(dir,'link'));await assert.rejects(()=>createSlsQuery(join(dir,'link'),slsConfig,fetcher)('*',1,2));
 await assert.rejects(()=>createSlsQuery(file,{...slsConfig,internal:false},async()=>Response.json([],{headers:{'x-log-progress':'Incomplete'}}))('*',1,2));
});

test('endpoint and method filters reach every metric query, with isolated cache entries',async()=>{
 const queries=monitoringQueries('1h','', '/api/relay/push', 'POST');
 for(const name of ['summary','trend','endpoints','errors']){
  assert.ok(queries[name].includes("request_uri = '/api/relay/push'"));
  assert.ok(queries[name].includes("request_method = 'POST'"));
 }
 assert.ok(!queries.ingestion.includes('request_uri'));
 let calls=0;const api=createMonitoring({adminEmail:MONITOR_EMAIL,query:async()=>{calls++;return[];}});
 await api(req('?route=/api/relay/push&method=POST'),MONITOR_EMAIL);
 await api(req('?route=/api/relay/push&method=POST'),MONITOR_EMAIL);assert.equal(calls,6);
 await api(req('?route=/api/relay/push&method=GET'),MONITOR_EMAIL);assert.equal(calls,12);
 for(const q of ["?route=/api/relay/push%27%20OR%201=1",'?method=POST%27','?route=/api/arbitrary'])assert.equal((await api(req(q),MONITOR_EMAIL)).status,400);
 assert.equal(calls,12);
});

test('email directory reads only account IDs and closes its cursor; unknown refs stay unresolved',async()=>{
 let closed=false; const db={collection(name){assert.equal(name,'auth_users');return{find(filter,options){assert.deepEqual(filter,{});assert.deepEqual(options.projection,{_id:1});assert.equal(options.maxTimeMS,10000);return{async *[Symbol.asyncIterator](){yield{_id:'Alice@Example.test'};yield{_id:'bob@example.test'};},async close(){closed=true;}};}};}};
 const directory=createMonitoringDirectory(db,{version:'v1',key:Buffer.alloc(32,7)});
 const ref=directory.reference('alice@example.test');const missing='v1_'+'0'.repeat(64);
 assert.equal(ref,directory.reference(' ALICE@example.test '));
 assert.deepEqual(await directory.emails([ref,missing]),new Map([[ref,'alice@example.test']]));assert.ok(closed);
 assert.equal(createMonitoringDirectory(db,null),null);
});

test('email search requires administrator and same-origin POST, without SQL or database work',async()=>{
 let calls=0;const directory=createMonitoringDirectory({collection(){throw Error('unexpected database access');}},{version:'v1',key:Buffer.alloc(32,7)});
 const api=createMonitoring({adminEmail:MONITOR_EMAIL,query:async()=>{calls++;return[];},directory});
 const request=(origin='https://relayune.test',body={email:' ALICE@example.test '})=>req('/resolve-user',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 for(const email of [null,'other@example.test'])assert.equal((await api(request(),email)).status,email?403:401);
 assert.equal((await api(request('https://evil.test'),MONITOR_EMAIL)).status,403);
 assert.equal((await api(req('/resolve-user?email=alice@example.test'),MONITOR_EMAIL)).status,405);
 assert.equal((await api(request('https://relayune.test',{email:'not-email'}),MONITOR_EMAIL)).status,400);
 assert.equal((await api(request('https://relayune.test',{email:'a'.repeat(2500)}),MONITOR_EMAIL)).status,400);
 const response=await api(request(),MONITOR_EMAIL);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const body=await response.json();assert.equal(body.email,'alice@example.test');assert.equal(body.user_ref,directory.reference(body.email));assert.equal(calls,0);
});

test('recent users keep SLS activity order and safely join emails only after authorization',async()=>{
 const refs=['v1_'+'a'.repeat(64),'v1_'+'b'.repeat(64)];let lookups=0,activeQueries=0;
 const query=async(sql,from,to)=>{
  if(sql.includes('GROUP BY user_ref')){activeQueries++;assert.equal(to-from,120*86400);assert.ok(sql.includes('ORDER BY latest DESC'));assert.ok(sql.endsWith('LIMIT 100'));return refs.map((ref,i)=>({user_ref:ref,latest:String(100-i),requests:'5',email:'untrusted@sls.test'}));}
  return[];
 };
 const directory={reference:()=>refs[0],emails:async values=>{lookups++;assert.deepEqual(values,refs);return new Map([[refs[0],'alice@example.test']]);}};
 const api=createMonitoring({adminEmail:MONITOR_EMAIL,query,directory});
 assert.equal((await api(req(),null)).status,401);assert.equal(lookups,0);
 let data=await(await api(req(),MONITOR_EMAIL)).json();assert.deepEqual(data.active_users.map(u=>u.email),['alice@example.test',null]);assert.equal(data.active_users_status,'ready');
 data=await(await api(req('?range=120d'),MONITOR_EMAIL)).json();assert.equal(data.active_users.length,2);assert.equal(activeQueries,1);assert.equal(lookups,1);
 const failing=createMonitoring({adminEmail:MONITOR_EMAIL,query,directory:{...directory,emails:async()=>{throw Error('sensitive database error');}}});
 data=await(await failing(req(),MONITOR_EMAIL)).json();assert.equal(data.active_users_status,'unavailable');assert.ok(!JSON.stringify(data).includes('sensitive'));
});

test('request history includes successful responses and email searches remain HMAC-filtered',()=>{
 const q=monitoringQueries('120d','v1_'+'a'.repeat(64),'/api/relay/commands','GET');
 assert.ok(q.recent_requests.includes('LIMIT 100'));
 assert.ok(!q.recent_requests.includes('status >= 400'));
 assert.ok(q.recent_requests.includes("request_method = 'GET'"));
 assert.ok(q.recent_requests.includes('request_time * 1000'));
 assert.ok(q.errors.includes('status >= 400'));
});

test('SQL null strings do not become error codes or trace identifiers in successful requests',async()=>{
 const api=createMonitoring({adminEmail:MONITOR_EMAIL,query:async()=>[{status:'200',error:'null',trace_id:'null',duration_ms:'2.34'}]});
 const data=await(await api(req(),MONITOR_EMAIL)).json();
 assert.equal(data.recent_requests[0].status,200);assert.equal(data.recent_requests[0].error,'');assert.equal(data.recent_requests[0].trace_id,'');
});


test('monitoring fails closed without a configured administrator before any data access',async()=>{
 let calls=0;
 const query=async()=>{calls++;throw Error('unexpected query');};
 const directory={reference(){calls++;throw Error('unexpected lookup');},async emails(){calls++;throw Error('unexpected lookup');}};
 for(const adminEmail of [undefined,'','   ']){
  const api=createMonitoring({query,directory,adminEmail});
  for(const path of ['', '/resolve-user']){
   assert.equal((await api(req(path),null)).status,401);
   assert.equal((await api(req(path),MONITOR_EMAIL)).status,403);
  }
 }
 assert.equal(calls,0);
 const normalized=createMonitoring({query:async()=>[],adminEmail:'  ADMIN@EXAMPLE.TEST '});
 assert.equal((await normalized(req(),MONITOR_EMAIL)).status,200);
 assert.throws(()=>createMonitoring({query,adminEmail:'not an email'}),/invalid_monitor_admin_email/);
});

test('SLS configuration rejects missing values and destination injection before credentials or network access',()=>{
 const fetcher=async()=>{throw Error('unexpected network access');};
 for(const field of ['project','logstore','region']){
  for(const value of [undefined,'','../other','example.com/path','bad?query','bad\nheader','evil@host']){
   assert.throws(()=>createSlsQuery('/nonexistent-key',{...slsConfig,[field]:value},fetcher),/invalid_sls_configuration/);
  }
 }
});

test('public SLS endpoint is explicit and signs the configured logstore',async()=>{
 const file=join(dir,'public-key.json');
 writeFileSync(file,JSON.stringify({access_key_id:'synthetic-id',access_key_secret:'synthetic-secret'}),{mode:0o600});
 await createSlsQuery(file,{...slsConfig,internal:false},async url=>{
  assert.ok(url.startsWith('https://test-project.cn-test.log.aliyuncs.com/logstores/test-logstore?'));
  return Response.json([],{headers:{'x-log-progress':'Complete'}});
 })('* | SELECT count(*)',1,2);
});

test('self-hosted monitoring returns real runtime and database status without a log supplier', async () => {
 const principal='acct_'+'a'.repeat(32);
 let pings=0;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw new Error('no external request is allowed');};
 try {
  const api=createMonitoring({query:null,allowLocalOnly:true,authorizeAccount:async value=>value===principal,ping:async()=>{pings++;}});
  assert.equal((await api(req(),null)).status,401);
  assert.equal((await api(req(),'acct_'+'b'.repeat(32))).status,403);assert.equal(pings,0);
  const response=await api(req(),principal);assert.equal(response.status,200);
  const value=await response.json();assert.equal(pings,1);
  assert.equal(value.logs_available,false);assert.equal(value.log_source,'unconfigured');
  assert.equal(value.runtime.database_ok,true);assert.ok(value.runtime.process_memory_mb>0);
  assert.ok(value.runtime.cpu_count>0);assert.ok(value.runtime.process_uptime_s>=0);
  assert.equal(value.active_users_status,'unavailable');
  for(const key of ['summary','trend','endpoints','errors','ingestion','recent_requests','active_users'])assert.deepEqual(value[key],[]);
  const failed=createMonitoring({query:null,allowLocalOnly:true,authorizeAccount:async()=>true,ping:async()=>{throw Error('private database exception');}});
  const degraded=await(await failed(req(),principal)).json();assert.equal(degraded.runtime.database_ok,false);
  assert.ok(!JSON.stringify(degraded).includes('private database exception'));
  assert.equal((await createMonitoring({query:null,adminEmail:MONITOR_EMAIL})(req(),MONITOR_EMAIL)).status,503);
 } finally {globalThis.fetch=originalFetch;}
});
