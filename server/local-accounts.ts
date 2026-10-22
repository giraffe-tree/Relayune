import { randomBytes } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Db } from "mongodb";
import { passwordRecord } from "./password-hash";

export const LOCAL_ACCOUNT_ID = /^acct_[a-f0-9]{32}$/;
export const LOCAL_PASSWORD_MIN_LENGTH = 12;
type Account = {
  _id: string; auth_epoch?: number; username?: string; auth_mode?: string;
  email?: string | null; email_verified?: boolean; is_instance_owner?: boolean;
  created_at?: Date; updated_at?: Date; account_deletion_started_at?: Date;
  password_algorithm?: string; password_salt?: string; password_hash?: string; password_set_at?: Date;
};

export function localUsername(value: unknown): string {
  const username = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username)) throw localAccountError(400, "invalid_username");
  return username;
}

function localPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < LOCAL_PASSWORD_MIN_LENGTH || value.length > 128) {
    throw localAccountError(400, "invalid_password");
  }
  return value;
}

export function localAccountError(status: number, code: string): Error & { status: number; code: string } {
  return Object.assign(new Error(code), { status, code });
}

export async function initializeLocalAccounts(db: Db) {
  const users = db.collection<Account>("auth_users");
  // The unique owner constraint is enforced by MongoDB, including independent
  // HTTP workers and local initialization commands on standalone installations.
  await users.createIndex({ is_instance_owner: 1 }, {
    unique: true, partialFilterExpression: { is_instance_owner: true }, name: "auth_single_instance_owner",
  });
  await users.createIndex({ username: 1 }, {
    unique: true, partialFilterExpression: { auth_mode: "username" }, name: "auth_local_username_uq",
  });
  await db.collection("auth_password_limits").createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
  if (await users.findOne({ auth_mode: { $ne: "username" } })) {
    throw new Error("username_mode_requires_separate_database");
  }
}

export async function localOwner(db: Db): Promise<Account | null> {
  return db.collection<Account>("auth_users").findOne({ is_instance_owner: true, auth_mode: "username" });
}

/** Local CLI callers need local OS/database privileges; HTTP callers must first
 * verify the per-instance setup token. This function has no remote bypass. */
export async function initializeLocalOwner(db: Db, username: unknown, password: unknown): Promise<Account> {
  const name = localUsername(username);
  const record: Account = {
    _id: `acct_${randomBytes(16).toString("hex")}`, username: name,
    auth_mode: "username", email: null, email_verified: false,
    is_instance_owner: true, auth_epoch: 1,
    ...await passwordRecord(localPassword(password)),
    created_at: new Date(), updated_at: new Date(),
  };
  try { await db.collection<Account>("auth_users").insertOne(record); }
  catch (error) {
    if ((error as { code?: number }).code === 11000) throw localAccountError(409, "instance_already_initialized");
    throw error;
  }
  return record;
}

/** Local recovery only: the generation update makes every old cookie invalid
 * immediately, including a racing login that verified the old password. */
export async function resetLocalOwnerPassword(db: Db, password: unknown): Promise<void> {
  const fields = await passwordRecord(localPassword(password));
  const owner = await db.collection<Account>("auth_users").findOneAndUpdate(
    { is_instance_owner: true, auth_mode: "username", account_deletion_started_at: { $exists: false } },
    { $set: { ...fields, updated_at: new Date() }, $inc: { auth_epoch: 1 } },
    { returnDocument: "after" },
  );
  if (!owner) throw localAccountError(409, "instance_not_initialized");
  // A slower recovery must not delete sessions created by a newer recovery.
  // Generation checks also reject old sessions inserted after this cleanup.
  await db.collection("auth_sessions").deleteMany({
    account_id: owner._id,
    $or: [
      { auth_epoch: { $lt: owner.auth_epoch } },
      { auth_epoch: { $exists: false } },
    ],
  });
}

export function publicAccount(user: Account) {
  if (user.auth_mode === "username" && LOCAL_ACCOUNT_ID.test(user._id)) {
    return { email: null, email_verified: false, username: user.username as string,
      account_id: user._id, auth_mode: "username" as const, display_name: user.username as string };
  }
  return { email: user._id, account_id: user._id, auth_mode: "email" as const, display_name: user._id };
}

/** Setup material stays in an administrator-owned file outside source/build
 * directories. Never accept a token in PUBLIC_ORIGIN, a URL, or a log message. */
export function readSetupToken(filename: string, projectDirectory: string): string {
  if (!path.isAbsolute(filename)) throw new Error("setup_token_file_invalid");
  const project = realpathSync(projectDirectory);
  const parent = realpathSync(path.dirname(filename));
  const resolved = path.join(parent, path.basename(filename));
  const relative = path.relative(project, resolved);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("setup_token_file_must_be_outside_project");
  }
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.uid !== 0 || ![0o600, 0o640].includes(info.mode & 0o777) || info.size > 256) {
      throw new Error("setup_token_file_invalid");
    }
    const token = readFileSync(fd, "utf8").trim();
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error("setup_token_invalid");
    return token;
  } finally { closeSync(fd); }
}
