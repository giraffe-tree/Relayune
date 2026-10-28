import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resumePermissionsFromRollout, resumePermissionParams } from '../relay/codex-resume-permissions.mjs';
const context = sandbox => JSON.stringify({type:'turn_context',payload:{approval_policy:'untrusted',approvals_reviewer:'user',sandbox_policy:sandbox}})+'\n';
test('resume preserves last native sandbox across large output records and does not inherit global access', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'relayune-resume-permissions-'));const path=join(dir,'rollout.jsonl');
  try {
    await writeFile(path,context({type:'danger-full-access'})+context({type:'workspace-write',network_access:false,writable_roots:['/workspace']})+JSON.stringify({type:'response_item',payload:'x'.repeat(2*1024*1024)})+'\n');
    assert.deepEqual(await resumePermissionsFromRollout(path),{sandbox:'workspace-write',approvalPolicy:'untrusted',approvalsReviewer:'user',config:{'sandbox_workspace_write.network_access':false,'sandbox_workspace_write.exclude_tmpdir_env_var':false,'sandbox_workspace_write.exclude_slash_tmp':false,'sandbox_workspace_write.writable_roots':['/workspace']}});
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('unsupported and malformed persisted policies fail closed',()=>{
  assert.throws(()=>resumePermissionParams({sandbox_policy:{type:'external-sandbox'}}));
  assert.throws(()=>resumePermissionParams({sandbox_policy:{type:'workspace-write',network_access:'false'}}));
  assert.deepEqual(resumePermissionParams({sandbox_policy:{type:'read-only'},approval_policy:'never'}),{sandbox:'read-only',approvalPolicy:'never'});
});

test('cold adapter sends persisted sandbox overrides on explicit continuation', async()=>{
  const { CodexAppServerAdapter } = await import('../relay/codex-adapters.mjs');
  const dir=await mkdtemp(join(tmpdir(),'relayune-resume-adapter-'));const path=join(dir,'rollout.jsonl');
  try {
    await writeFile(path,context({type:'workspace-write',network_access:false}));
    const adapter=new CodexAppServerAdapter({workspace:dir});
    adapter.threadMetadata.set('thread-test',{id:'thread-test',cwd:dir,path,status:{type:'notLoaded'}});
    adapter.handlers={emitEvent:async()=>{}};
    adapter.readDesktopPermissions=async()=>{throw new Error('No active Desktop owner');};
    adapter.verifyUserMessage=async()=>true;
    const calls=[];
    adapter.request=async(method,params)=>{
      calls.push({method,params});
      if(method==='thread/resume')return {thread:{id:'thread-test',cwd:dir,path,status:{type:'idle'}}};
      if(method==='turn/start')return {turn:{id:'turn-test'}};
      throw new Error('Unexpected '+method);
    };
    await adapter.submitMessage({sessionId:'thread-test',content:'Resume test',requestId:'request-test'});
    const mutations = calls.filter(c => !['thread/read','thread/queue/list'].includes(c.method));
    assert.equal(mutations[0].method,'thread/resume');
    assert.equal(mutations[0].params.sandbox,'workspace-write');
    assert.equal(mutations[0].params.approvalPolicy,'untrusted');
    assert.equal(mutations[0].params.config['sandbox_workspace_write.network_access'],false);
    assert.equal(mutations[1].method,'turn/start');
  } finally {await rm(dir,{recursive:true,force:true});}
});
