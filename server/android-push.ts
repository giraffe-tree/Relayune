import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type { Db } from 'mongodb';

export type PushConfig = {
  appKey: string; masterSecret: string; storageKey: string;
  vivoTest?: boolean;
};
type Binding = { _id: string; userId: string; deviceId: string; registration: string; registrationHash: string;
  generation: string; locale: string; expiresAt: Date };
type Job = { _id: string; browserId: string; deviceId: string; generation: string;
  expiresAt: Date; nextAttemptAt: Date; attempts: number; lease?: string; done?: boolean };
export function readPushConfig(filename = process.env.RELAY_JPUSH_CONFIG_FILE): PushConfig | null {
  if (!filename) return null;
  if (statSync(filename).mode & 0o007) throw new Error('Push configuration must not be world-accessible.');
  let config: PushConfig;
  try { config = JSON.parse(readFileSync(filename, 'utf8')); }
  catch { throw new Error('Invalid push configuration.'); }
  if (!config || !/^[a-f0-9]{24}$/i.test(config.appKey) || typeof config.masterSecret !== 'string' || !config.masterSecret ||
      typeof config.storageKey !== 'string' || Buffer.from(config.storageKey, 'base64').length !== 32) {
    throw new Error('Invalid push configuration.');
  }
  return config;
}
export function encryptRegistration(value: string, key: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), nonce);
  cipher.setAAD(Buffer.from('relayune:push-registration:v1'));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function decryptRegistration(value: string, key: string): string {
  const bytes = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from('relayune:push-registration:v1'));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Provider receives only generic copy and an opaque receipt, never a task title,
 * status, session id, command, encrypted content key, email, or login token. */
export function jpushPayload(registration: string, receipt: string, locale: string, config: PushConfig) {
  const zh = locale.startsWith('zh');
  return {
    platform: ['android'], audience: { registration_id: [registration] },
    notification: { android: {
      title: 'Relayune', alert: zh ? '有新的任务动态，轻点查看。' : 'New task activity. Tap to view.',
      channel_id: 'relayune_remote_activity', priority: 1,
      intent: { url: 'intent:#Intent;component=cn.giraffetree.relayune/.PushOpenActivity;end' },
      extras: { relayune_receipt: receipt },
    } },
    options: { time_to_live: 120, third_party_channel: {
      vivo: { push_mode: config.vivoTest === true ? 1 : 0 },
    } },
  };
}
export class AndroidPush {
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;
  private registrationWrites: Promise<void> = Promise.resolve();
  constructor(private db: Db, private config: PushConfig, private send = fetch) {}
  async initialize() {
    await this.db.collection<Binding>('relay_push_bindings').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    const bindings = this.db.collection<Binding>('relay_push_bindings');
    // Startup migration: one phone may retain authorizations for several
    // computers. _id still uniquely identifies each browser authorization.
    for (const index of await bindings.listIndexes().toArray()) {
      if (index.unique && index.key?.registrationHash === 1 && Object.keys(index.key).length === 1 && index.name) {
        await bindings.dropIndex(index.name);
      }
    }
    await bindings.createIndex({ registrationHash: 1 });
    await this.db.collection<Job>('relay_push_jobs').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.db.collection<Job>('relay_push_jobs').createIndex({ done: 1, nextAttemptAt: 1 });
    this.timer = setInterval(() => { void this.drain().catch(() => {}); }, 3000);
    this.timer.unref();
  }
  close() { if (this.timer) clearInterval(this.timer); }
  async register(browserId: string, deviceId: string, registration: string | null, locale: string) {
    // Serialize register and opt-out together. The self-hosted service is a
    // single Node process; an in-flight registration cannot undo a later logout.
    const operation = this.registrationWrites.catch(() => {}).then(async () => {
      const bindings = this.db.collection<Binding>('relay_push_bindings');
      if (registration === null) { await bindings.deleteOne({ _id: browserId, deviceId }); return; }
      const registrationHash = hash(registration);
      const authorization = await this.db.collection('relay_browser_authorizations').findOne({
        id: browserId, device_id: deviceId, revoked_at: null,
    });
    if (!authorization || typeof authorization.user_id !== 'string') throw new Error('Push authorization unavailable');
    const userId = authorization.user_id;
    // Retain this account's other computers; remove legacy/unowned bindings
    // and bindings belonging to another account on this app installation.
    await bindings.deleteMany({ registrationHash, userId: { $ne: userId } });
    const existing = await bindings.findOne({ _id: browserId });
    await bindings.updateOne({ _id: browserId }, { $set: {
      userId, deviceId, registration: encryptRegistration(registration, this.config.storageKey), registrationHash,
      generation: existing?.registrationHash === registrationHash ? existing.generation : randomUUID(),
      locale, expiresAt: new Date(Date.now() + 7 * 86400_000),
    } }, { upsert: true });
    });
    this.registrationWrites = operation.catch(() => {});
    await operation;
  }

  async enqueue(browserId: string, deviceId: string, eventId: string, createdAt: number) {
    if (createdAt < Date.now() - 120_000 || createdAt > Date.now() + 30_000) return;
    const binding = await this.db.collection<Binding>('relay_push_bindings').findOne({ _id: browserId, deviceId,
      expiresAt: { $gt: new Date() } });
    if (!binding) return;
    const id = hash(`${browserId}:${eventId}`);
    await this.db.collection<Job>('relay_push_jobs').updateOne({ _id: id }, { $setOnInsert: {
      browserId, deviceId, generation: binding.generation, expiresAt: new Date(createdAt + 120_000),
      nextAttemptAt: new Date(), attempts: 0, done: false,
    } }, { upsert: true });
  }
  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let count = 0; count < 20; count++) {
        const jobs = this.db.collection<Job>('relay_push_jobs');
        const lease = randomUUID();
        const job = await jobs.findOneAndUpdate({ done: false, nextAttemptAt: { $lte: new Date() },
          expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } },
        { $set: { lease, nextAttemptAt: new Date(Date.now() + 30_000) }, $inc: { attempts: 1 } }, { returnDocument: 'after' });
        if (!job) break;
        const binding = await this.db.collection<Binding>('relay_push_bindings').findOne({ _id: job.browserId,
          deviceId: job.deviceId, generation: job.generation, expiresAt: { $gt: new Date() } });
        const [browser, device] = await Promise.all([
          this.db.collection('relay_browser_authorizations').findOne({ id: job.browserId, device_id: job.deviceId, revoked_at: null }),
          this.db.collection('relay_devices').findOne({ id: job.deviceId, revoked_at: null }),
        ]);
        if (!binding || !browser || !device || (binding.userId != null && binding.userId !== browser.user_id)) {
          await jobs.updateOne({ _id: job._id, lease }, { $set: { done: true } }); continue;
        }
        try {
          const response = await this.send('https://api.jpush.cn/v3/push', {
            method: 'POST', signal: AbortSignal.timeout(10_000),
            headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${this.config.appKey}:${this.config.masterSecret}`).toString('base64')}` },
            body: JSON.stringify(jpushPayload(decryptRegistration(binding.registration, this.config.storageKey), job._id, binding.locale, this.config)),
          });
          // No provider body is logged. 429/5xx and network failures retry within TTL.
          const retry = response.status === 429 || response.status >= 500;
          await response.body?.cancel();
          await jobs.updateOne({ _id: job._id, lease }, { $set: { done: !retry,
            nextAttemptAt: new Date(Date.now() + Math.min(60_000, 3000 * 2 ** job.attempts)) } });
        } catch {
          await jobs.updateOne({ _id: job._id, lease }, { $set: {
            nextAttemptAt: new Date(Date.now() + Math.min(60_000, 3000 * 2 ** job.attempts)),
          } });
        }
      }
    } finally { this.draining = false; }
  }
}
