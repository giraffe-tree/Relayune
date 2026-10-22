import { createHash } from "node:crypto";
import type { Db } from "mongodb";

type RecordDocument = { _id: string; [key: string]: unknown };
export type AccountDeletionEffects = {
  revokeDevice(id: string): void;
  deleteBlob(key: string): Promise<void>;
  runExclusive?(cleanup: () => Promise<void>): Promise<void>;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Standalone MongoDB: revoke first, clean idempotently, remove identity last.
 * A failed cleanup keeps the password and initiating session solely for retry.
 * authenticate() refuses a deleting account on all other routes.
 */
export async function deleteAccount(
  db: Db, email: string, initiatingSessionHash: string, effects: AccountDeletionEffects,
) {
  const users = db.collection<RecordDocument>("auth_users");
  const now = new Date();
  await users.updateOne({ _id: email }, { $set: {
    account_deletion_started_at: now,
    ...(initiatingSessionHash ? { account_deletion_session_hash: initiatingSessionHash } : {}),
  } });
  const pending = await users.findOne({ _id: email }, { projection: { account_deletion_session_hash: 1 } });
  const retrySessionHash = initiatingSessionHash || pending?.account_deletion_session_hash || "";
  const relayUsers = await db.collection<RecordDocument>("relay_users").find({ email }).toArray();
  const userIds = [...new Set([`usr_${hash(email).slice(0, 32)}`, ...relayUsers.map(user => String(user.id || user._id))])];
  const owner = { user_id: { $in: userIds } };
  const devices = await db.collection<RecordDocument>("relay_devices").find(owner, { projection: { id: 1 } }).toArray();
  const deviceIds = devices.map(device => String(device.id || device._id));
  const route = { $or: [owner, { device_id: { $in: deviceIds } }] };

  await db.collection("relay_devices").updateMany(owner, { $set: { revoked_at: now.getTime(), last_seen_at: null } });
  await db.collection("relay_browser_authorizations").updateMany(route, { $set: { revoked_at: now.getTime() } });
  for (const id of deviceIds) effects.revokeDevice(id);
  await db.collection("auth_sessions").deleteMany({ email, token_hash: { $ne: retrySessionHash } });
  // Preserve the pointers until filesystem cleanup succeeds so retries can finish.
  for (const name of ["relay_commands", "relay_responses"]) {
    const cursor = db.collection(name).find(route, { projection: { blob_key: 1 } });
    for await (const record of cursor) {
      if (typeof record.blob_key === "string") await effects.deleteBlob(record.blob_key);
    }
  }
  for (const name of ["relay_pake_pairings", "relay_desktop_logins", "relay_client_devices",
    "relay_browser_authorizations", "relay_catalogs", "relay_commands", "relay_responses", "relay_events"]) {
    await db.collection(name).deleteMany(route);
  }
  for (const name of ["relay_ios_push_registrations", "relay_ios_push_jobs", "relay_push_bindings", "relay_push_jobs"]) {
    await db.collection(name).deleteMany({ deviceId: { $in: deviceIds } });
  }
  await db.collection("relay_devices").deleteMany(owner);
  await db.collection("relay_users").deleteMany({ email });
  for (const name of ["auth_magic_links", "auth_setup_sessions"]) await db.collection(name).deleteMany({ email });
  await db.collection("auth_login_attempts").deleteMany({ email_hash: hash(email) });
  const feedbackOwners = [hash(`email:${email}`), ...userIds.map(id => hash(`user:${id}`))];
  await db.collection("relay_feedback").deleteMany({ owner: { $in: feedbackOwners } });
  for (const feedbackOwner of feedbackOwners) {
    await db.collection<RecordDocument>("relay_feedback_limits").deleteMany({ _id: { $regex: `^${feedbackOwner}:` } });
  }
  await users.deleteOne({ _id: email });
  await db.collection("auth_sessions").deleteMany({ email });
}

/** Concurrent HTTP operations remain concurrent. Deletion drains them first;
 * later requests wait, so an in-flight pairing/login cannot restore deleted data.
 * Writers take priority; bounded long polls can delay deletion by at most their wait.
 */
export class AccountDeletionGate {
  private readers = 0;
  private writing = false;
  private queue: { exclusive: boolean; resolve: (release: () => void) => void }[] = [];
  enter(exclusive: boolean): Promise<() => void> {
    return new Promise(resolve => { this.queue.push({ exclusive, resolve }); this.drain(); });
  }
  private drain() {
    if (this.writing) return;
    while (this.queue.length) {
      const next = this.queue[0];
      if (next.exclusive && this.readers) return;
      this.queue.shift();
      if (next.exclusive) this.writing = true;
      else this.readers++;
      let released = false;
      next.resolve(() => {
        if (released) return;
        released = true;
        if (next.exclusive) this.writing = false;
        else this.readers--;
        this.drain();
      });
      if (next.exclusive) return;
    }
  }
}
