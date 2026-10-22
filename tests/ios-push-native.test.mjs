// [MOB-NOT-019][server]
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {IosPushState,iosPushKey} from '../relay/ios-push.mjs';

test('CryptoKit decrypts Node envelope; rejects wrong device, expired and modified payloads', {skip:process.platform!=='darwin',timeout:60000}, async()=>{
  const directory=mkdtempSync(join(tmpdir(),'relayune-push-interop-'));
  try{
    writeFileSync(join(directory,'main.swift'),`import Foundation
let input = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String: Any]
let envelope = input["envelope"] as! [String: Any]
let binding = input["binding"] as! [String: Any]
let now = Date(timeIntervalSince1970: (input["now"] as! Double) / 1000)
let state = try PushCrypto.decrypt(envelope, binding: binding, now: now)
precondition(state["state"] as? String == "approval")
var scoped = binding; scoped["browserId"] = "authorization"
let route = PushCrypto.sessionRoute("会话/path", binding: scoped)
precondition(route == input["expectedRoute"] as? String)
let identity = PushCrypto.identity(route)!
precondition(identity.device == "dev_test" && identity.browser == "authorization" && identity.session == "会话/path")
var wrong = binding; wrong["deviceId"] = "wrong"
do { _ = try PushCrypto.decrypt(envelope, binding: wrong, now: now); fatalError("wrong device accepted") } catch {}
do { _ = try PushCrypto.decrypt(envelope, binding: binding, now: now.addingTimeInterval(400)); fatalError("expired accepted") } catch {}
var modified = envelope; modified["iv"] = "AAAAAAAAAAAAAAAA"
do { _ = try PushCrypto.decrypt(modified, binding: binding, now: now); fatalError("tampering accepted") } catch {}
print("native crypto checks passed")
`);
    const binary=join(directory,'check');
    const compile=spawnSync('xcrun',['swiftc',resolve('mobile/ios/RelayuneLiveActivity/PushCrypto.swift'),join(directory,'main.swift'),'-o',binary],{encoding:'utf8',timeout:50000});
    assert.equal(compile.status,0,compile.stderr);
    const now=Date.now(),contentKey=Buffer.alloc(32,7).toString('base64url'),key=await iosPushKey(contentKey),s=new IosPushState();
    const p=await s.seal(contentKey,s.transition('session',{kind:'approval.requested',approval_id:'a',expires_at:new Date(now+120000).toISOString()},now),{direction:'relay_to_web',device_id:'dev_test',created_at:new Date(now).toISOString()});
    const result=spawnSync(binary,[],{encoding:'utf8',input:JSON.stringify({expectedRoute:'computer:'+Buffer.from(JSON.stringify(['dev_test','authorization','会话/path'])).toString('base64url'),envelope:p.envelope,binding:{key,kid:`sha256:${createHash('sha256').update(Buffer.from(key,'base64url')).digest('base64url')}`,deviceId:'dev_test'},now}),timeout:5000});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/native crypto checks passed/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
