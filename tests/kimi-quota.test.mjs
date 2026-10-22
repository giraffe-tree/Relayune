import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeKimiQuota, readKimiQuota } from '../relay/kimi-quota.mjs';
import { KimiCodeAdapter } from '../relay/kimi-adapter.mjs';
const payload = {usage:{used:'40',limit:'100',resetTime:'2026-09-15T00:00:00Z'},limits:[{window:{duration:300,timeUnit:'TIME_UNIT_MINUTE'},detail:{remaining:'75',limit:'100',resetTime:'2026-09-09T00:00:00Z'}}]};

test('Kimi weekly summary and 5h window normalize decimal strings and remaining quota', () => {
  assert.deepEqual(normalizeKimiQuota(payload).map(w=>[w.id,w.used_percent]),[['seven_day',40],['five_hour',25]]);
  for(const value of [null,'',0,'invalid']) {
    assert.equal(normalizeKimiQuota({usage:{used:'3',limit:value}})[0].used_percent,null);
  }
  assert.equal(normalizeKimiQuota({usage:{limit:'100'}})[0].used_percent,null);
  assert.equal(normalizeKimiQuota({usage:{limit:'100',used:'0'}})[0].used_percent,0);
  assert.deepEqual(normalizeKimiQuota({limits:[{window:{duration:1,timeUnit:'TIME_UNIT_HOUR'},detail:{used:1,limit:2}}]}),[]);
});

test('Kimi reader uses selected file credential only for official HTTPS endpoints', async t => {
  const home=await mkdtemp(join(tmpdir(),'relayune-kimi-quota-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  await writeFile(join(home,'config.toml'),''); await mkdir(join(home,'credentials'));
  const credential=join(home,'credentials','kimi-code.json');
  await writeFile(credential,JSON.stringify({access_token:'test-secret',expires_at:Date.now()/1000+600}));
  let provider={baseUrl:'https://api.kimi.com/coding/v1',oauth:{storage:'file',key:'oauth/kimi-code'}};
  let calls=0;
  const options={kimiHome:home,configReader:async()=>({providers:{'managed:kimi-code':provider}}),env:{},fetchImpl:async(url,opts)=>{
    calls++;assert.equal(url,provider.baseUrl+'/usages');assert.equal(opts.headers.Authorization,'Bearer test-secret');assert.equal(opts.redirect,'error');assert.ok(opts.signal);
    return {ok:true,json:async()=>payload};
  }};
  assert.equal((await readKimiQuota(options)).length,2);
  assert.equal(JSON.stringify(await readKimiQuota(options)).includes('test-secret'),false);
  provider={...provider,baseUrl:'https://api.kimi.ai/coding/v1'};
  assert.equal((await readKimiQuota(options)).length,2);
  provider={...provider,baseUrl:'https://attacker.invalid/coding/v1'};
  assert.deepEqual(await readKimiQuota(options),[]);assert.equal(calls,3);
  provider={...provider,baseUrl:'https://api.kimi.com/coding/v1'};
  await writeFile(credential,JSON.stringify({access_token:'test-secret',expires_at:1}));
  assert.deepEqual(await readKimiQuota(options),[]);assert.equal(calls,3);
  await rm(credential); await symlink(join(home,'config.toml'),credential);
  assert.deepEqual(await readKimiQuota(options),[]);assert.equal(calls,3);
});

test('Kimi quota survives missing token statistics and refresh clears unavailable account', async () => {
  let calls=0;
  const adapter=new KimiCodeAdapter({quotaReader:async()=>{calls++;return normalizeKimiQuota(payload);}});
  adapter.readTokenUsage=async()=>({});
  const [first,second]=await Promise.all([adapter.readUsage(),adapter.readUsage()]);
  assert.deepEqual(first,second);assert.equal(calls,1);assert.equal(first.kimi.quota_windows.length,2);
  adapter.quotaReader=async()=>[];
  assert.deepEqual(await adapter.readUsage({refresh:true}),{});
});
