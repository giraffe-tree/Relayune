import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ApnsClient, readPrivateFile } from './apns-client.mjs';

const hex = /^[a-f0-9]{32,512}$/i;
const routePattern = /^[a-f0-9]{64}$/;
const keyPattern = /^sha256:[A-Za-z0-9_-]{43}$/;
const b64 = /^[A-Za-z0-9_-]+$/;
export class IosPushError extends Error {
  constructor(status,code,message) { super(message); this.status=status; this.code=code; }
}
function invalid() { throw new IosPushError(400,'invalid_ios_push','Invalid iOS push request'); }

export function validateIosPush(value, aad, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'activity_route,alert,envelope,expires_at,operation') return invalid();
  const {envelope:e,activity_route:route,operation,alert,expires_at:expiry} = value;
  if ((route !== null && !routePattern.test(route)) || !['update','end'].includes(operation) || typeof alert !== 'boolean' ||
      !Number.isSafeInteger(expiry) || expiry > Date.parse(aad.created_at) + 300000) return invalid();
  if (!e || Object.keys(e).sort().join(',') !== 'aad,alg,ciphertext,iv,kid,v' || e.v !== 2 || e.alg !== 'A256GCM' || !keyPattern.test(e.kid) ||
      ![e.aad,e.iv,e.ciphertext].every(x => typeof x === 'string' && b64.test(x)) || Buffer.from(e.iv,'base64url').length !== 12 ||
      Buffer.from(e.ciphertext,'base64url').length < 17 || JSON.stringify(e).length > 3000) return invalid();
  let actual;
  try { actual = JSON.parse(Buffer.from(e.aad,'base64url')); } catch { return invalid(); }
  const expected = {...aad,type:'ios.push',expires_at:new Date(expiry).toISOString()};
  if (Object.keys(actual).length !== Object.keys(expected).length || Object.entries(expected).some(([k,v]) => actual[k] !== v)) return invalid();
  if (expiry <= now || Date.parse(aad.created_at) > now + 30000) return null;
  return value;
}

export function tokenBox(key, value, binding) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(binding));
  return Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64url');
}
export function openTokenBox(key, value, binding) {
  const packed = Buffer.from(value,'base64url');
  const cipher = createDecipheriv('aes-256-gcm',key,packed.subarray(0,12));
  cipher.setAAD(Buffer.from(binding)); cipher.setAuthTag(packed.subarray(-16));
  return JSON.parse(Buffer.concat([cipher.update(packed.subarray(12,-16)),cipher.final()]));
}

export class IosPushService {
  constructor(db, clients, storageKey) {
    this.db=db; this.clients=clients; this.storageKey=storageKey;
    if (storageKey.length !== 32) throw new Error('Invalid push token encryption key');
    this.registrations=db.collection('relay_ios_push_registrations');
    this.jobs=db.collection('relay_ios_push_jobs');
  }
  async initialize() {
    await this.registrations.createIndex({expiresAt:1},{expireAfterSeconds:0});
    await this.jobs.createIndex({expiresAt:1},{expireAfterSeconds:0});
    await this.jobs.createIndex({status:1,nextAttempt:1});
    this.timer=setInterval(() => void this.drain().catch(() => {}),2000);
    this.timer.unref();
  }
  close() { clearInterval(this.timer); }

  async register(deviceId,browserId,body) {
    if (body.enabled === false) {
      await this.registrations.deleteOne({_id:browserId,deviceId});
      await this.jobs.deleteMany({browserId,deviceId});
      return {registered:false};
    }
    const {environment,token,push_key_id:pushKeyId,activities=[]} = body;
    if (!this.clients[environment]) throw new IosPushError(503,'ios_push_unavailable','Push environment unavailable');
    if (!hex.test(token) || !keyPattern.test(pushKeyId) || !Array.isArray(activities) || activities.length > 8) return invalid();
    const routes=new Set();
    for (const activity of activities) {
      if (!activity || Object.keys(activity).sort().join(',') !== 'route,token' || !routePattern.test(activity.route) || !hex.test(activity.token) || routes.has(activity.route)) return invalid();
      routes.add(activity.route);
    }
    const generation=createHash('sha256').update(`${environment}:${token}:${pushKeyId}`).digest('hex');
    await this.registrations.updateOne({_id:browserId},{$set:{deviceId,environment,pushKeyId,generation,
      tokens:tokenBox(this.storageKey,{token,activities},browserId),expiresAt:new Date(Date.now()+30*86400000)}},{upsert:true});
    return {registered:true};
  }

  async enqueue(deviceId,browserId,eventId,eventSeq,push) {
    const registration=await this.registrations.findOne({_id:browserId,deviceId,pushKeyId:push.envelope.kid,expiresAt:{$gt:new Date()}});
    if (!registration) return;
    const id=createHash('sha256').update(`${browserId}:${eventId}`).digest('hex');
    try {
      await this.jobs.updateOne({_id:id},{$setOnInsert:{deviceId,browserId,eventSeq,push,generation:registration.generation,
        expiresAt:new Date(push.expires_at),status:'pending',attempts:0,nextAttempt:new Date()}},{upsert:true});
    } catch (error) { if (error?.code !== 11000) throw error; }
  }

  async drain() {
    if (this.running) return;
    this.running=true;
    try {
      for (let n=0;n<10;n++) {
        const now=new Date();
        const job=await this.jobs.findOneAndUpdate({status:'pending',expiresAt:{$gt:now},nextAttempt:{$lte:now}},
          {$set:{nextAttempt:new Date(Date.now()+60000)},$inc:{attempts:1}},{sort:{eventSeq:1},returnDocument:'after'});
        if (!job) break;
        try { await this.deliver(job); }
        catch { await this.retry(job); }
      }
    } finally { this.running=false; }
  }
  async retry(job) {
    await this.jobs.updateOne({_id:job._id},{$set:job.attempts >= 6 ? {status:'failed'} :
      {nextAttempt:new Date(Date.now()+Math.min(60000,2000*2**job.attempts))}});
  }
  async deliver(job) {
    const [authorization,device,registration]=await Promise.all([
      this.db.collection('relay_browser_authorizations').findOne({id:job.browserId,device_id:job.deviceId,revoked_at:null}),
      this.db.collection('relay_devices').findOne({id:job.deviceId,revoked_at:null}),
      this.registrations.findOne({_id:job.browserId,deviceId:job.deviceId,generation:job.generation,expiresAt:{$gt:new Date()}}),
    ]);
    if (!authorization || !device || !registration) { await this.jobs.updateOne({_id:job._id},{$set:{status:'cancelled'}}); return; }
    const tokens=openTokenBox(this.storageKey,registration.tokens,job.browserId);
    const client=this.clients[registration.environment];
    if (!client) { await this.retry(job); return; }
    const push=job.push, collapseId=job._id;
    let retry=false, failed=false;
    if (push.alert && !job.alertSent) {
      const response=await client.send({token:tokens.token,collapseId,expiration:Math.floor(push.expires_at/1000),payload:{
        aps:{alert:{title:'Relayune',body:'Open Relayune to view your update.'},'mutable-content':1,sound:'default'},
        relayune_push:push.envelope,
      }});
      if (response.status===200) await this.jobs.updateOne({_id:job._id},{$set:{alertSent:true}});
      else if ([0,429,500,503].includes(response.status)) retry=true;
      else {
        failed=true;
        if (['Unregistered','BadDeviceToken','DeviceTokenNotForTopic'].includes(response.reason))
          await this.registrations.deleteOne({_id:job.browserId,generation:job.generation});
      }
    }
    const activity=tokens.activities.find(a => a.route===push.activity_route);
    if (activity && !job.activitySent) {
      const timestamp=Math.floor(Date.parse(JSON.parse(Buffer.from(push.envelope.aad,'base64url')).created_at)/1000);
      const response=await client.send({token:activity.token,type:'liveactivity',priority:push.alert?10:5,collapseId,
        expiration:Math.floor(push.expires_at/1000),payload:{aps:{timestamp,event:push.operation,
          'content-state':{sealed:push.envelope},'stale-date':timestamp+75,
          'relevance-score':push.alert && push.operation==='update'?100:50,
          ...(push.operation==='end'?{'dismissal-date':Math.floor(Date.now()/1000)+120}:{})}}});
      if (response.status===200) await this.jobs.updateOne({_id:job._id},{$set:{activitySent:true}});
      else if ([0,429,500,503].includes(response.status)) retry=true;
      else failed=true;
    }
    if (retry) await this.retry(job);
    else await this.jobs.updateOne({_id:job._id},{$set:{status:failed?'failed':'done'}});
  }
}

export async function createIosPushService(db, env=process.env) {
  const clients={};
  for (const environment of ['sandbox','production']) {
    const prefix=`APNS_${environment.toUpperCase()}`;
    const file=env[`${prefix}_KEY_FILE`];
    if (file) clients[environment]=new ApnsClient({environment,teamId:env.APNS_TEAM_ID,keyId:env[`${prefix}_KEY_ID`],
      privateKey:await readPrivateFile(file),bundleId:'cn.giraffetree.relayune'});
  }
  if (!Object.keys(clients).length) return undefined;
  const storage=await readPrivateFile(env.APNS_TOKEN_STORAGE_KEY_FILE);
  return new IosPushService(db,clients,Buffer.from(storage.toString().trim(),'base64url'));
}
