import {
  createHash,
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  openSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_INLINE_BYTES = 512 * 1024 * 1024;

export class AttachmentStore {
  constructor({ path, key, deviceId, maxInlineBytes = DEFAULT_MAX_INLINE_BYTES }) {
    if (!path || !isAbsolute(path)) {
      throw storeError("attachment_store_invalid", "Attachment store path must be absolute.");
    }
    if (!deviceId?.trim()) {
      throw storeError("attachment_store_invalid", "Attachment store device ID is required.");
    }
    this.path = path;
    this.deviceId = deviceId;
    this.key = decodeStoreKey(key);
    this.maxInlineBytes = maxInlineBytes;
    this.closed = false;

    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      prepareDatabaseFile(path);
      this.database = new DatabaseSync(path);
      this.database.exec("PRAGMA journal_mode = WAL");
      this.database.exec("PRAGMA synchronous = FULL");
      this.database.exec("PRAGMA foreign_keys = ON");
      this.database.exec("PRAGMA trusted_schema = OFF");
      this.database.exec("PRAGMA busy_timeout = 5000");
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS store_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          key_check BLOB NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS attachment_entries (
          session_id TEXT NOT NULL,
          attachment_id TEXT NOT NULL,
          source_kind TEXT NOT NULL CHECK (source_kind IN ('local_path', 'inline')),
          metadata_nonce BLOB NOT NULL,
          metadata_ciphertext BLOB NOT NULL,
          body_nonce BLOB,
          body_ciphertext BLOB,
          source_digest BLOB NOT NULL,
          byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
          created_at_ms INTEGER NOT NULL,
          accessed_at_ms INTEGER NOT NULL,
          PRIMARY KEY (session_id, attachment_id)
        ) STRICT, WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS attachment_entries_accessed
          ON attachment_entries(source_kind, accessed_at_ms);
        CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
          source_id BLOB PRIMARY KEY,
          byte_offset INTEGER NOT NULL CHECK (byte_offset >= 0),
          updated_at_ms INTEGER NOT NULL
        ) STRICT, WITHOUT ROWID;
      `);
      const version = Number(this.database.prepare("PRAGMA user_version").get().user_version);
      if (version > SCHEMA_VERSION) {
        throw storeError(
          "attachment_store_too_new",
          "Attachment store was created by a newer Relayune version.",
        );
      }
      verifyStoreKey(this.database, this.key);
      // Keep quota sums and eviction order off the encrypted body pages.
      // WITHOUT ROWID also appends both primary-key columns to this index.
      // Build once for existing stores, only after authenticating the key.
      this.database.exec(`
        CREATE INDEX IF NOT EXISTS attachment_entries_inline_budget
          ON attachment_entries(source_kind, accessed_at_ms, created_at_ms, byte_size)
      `);
      this.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      protectDatabaseFiles(path);
    } catch (error) {
      this.key.fill(0);
      try {
        this.database?.close();
      } catch {
        // Preserve the original startup error.
      }
      throw normalizeStoreError(error);
    }
  }

  put(sessionId, attachmentId, attachment) {
    this.assertOpen();
    validateIdentity(sessionId, attachmentId);
    const prepared = prepareAttachment(attachment);
    const now = Date.now();
    const metadata = Buffer.from(JSON.stringify(prepared.metadata), "utf8");
    const metadataEnvelope = encrypt(
      this.key,
      metadata,
      aad(this.deviceId, sessionId, attachmentId, "metadata"),
    );
    const bodyEnvelope = prepared.body
      ? encrypt(
          this.key,
          prepared.body,
          aad(this.deviceId, sessionId, attachmentId, "body"),
        )
      : null;
    const digest = sourceDigest(this.key, prepared);

    try {
      const existing = this.database
        .prepare(`
          SELECT source_digest, source_kind, metadata_nonce, metadata_ciphertext,
                 body_nonce, body_ciphertext
          FROM attachment_entries
          WHERE session_id = ? AND attachment_id = ?
        `)
        .get(sessionId, attachmentId);
      if (existing) {
        const existingDigest = Buffer.from(existing.source_digest);
        if (
          existingDigest.length !== digest.length ||
          !timingSafeEqual(existingDigest, digest)
        ) {
          // Replace old encrypted inline images with durable provider-file
          // references only when the original bytes are proven identical.
          if (!matchingReferencedContent(this.key, this.deviceId, sessionId, attachmentId, existing, prepared))
            throw storeError("attachment_id_conflict", "Attachment ID already refers to different content in this session.");
          this.database.prepare(`UPDATE attachment_entries SET source_kind = ?,
            metadata_nonce = ?, metadata_ciphertext = ?, body_nonce = NULL,
            body_ciphertext = NULL, source_digest = ?, byte_size = 0, accessed_at_ms = ?
            WHERE session_id = ? AND attachment_id = ?`).run(prepared.sourceKind,
              metadataEnvelope.nonce, metadataEnvelope.ciphertext, digest, now, sessionId, attachmentId);
        }
        this.database
          .prepare(`
            UPDATE attachment_entries
            SET accessed_at_ms = ?
            WHERE session_id = ? AND attachment_id = ?
          `)
          .run(now, sessionId, attachmentId);
        return;
      }

      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database
          .prepare(`
            INSERT INTO attachment_entries (
              session_id, attachment_id, source_kind,
              metadata_nonce, metadata_ciphertext,
              body_nonce, body_ciphertext, source_digest,
              byte_size, created_at_ms, accessed_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            sessionId,
            attachmentId,
            prepared.sourceKind,
            metadataEnvelope.nonce,
            metadataEnvelope.ciphertext,
            bodyEnvelope?.nonce ?? null,
            bodyEnvelope?.ciphertext ?? null,
            digest,
            prepared.body?.length ?? 0,
            now,
            now,
          );
        if (prepared.sourceKind === "inline") this.pruneInlineBytes();
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
      protectDatabaseFiles(this.path);
    } catch (error) {
      throw normalizeStoreError(error);
    } finally {
      metadata.fill(0);
      prepared.body?.fill(0);
    }
  }

  get(sessionId, attachmentId) {
    this.assertOpen();
    validateIdentity(sessionId, attachmentId);
    try {
      const row = this.database
        .prepare(`
          SELECT source_kind, metadata_nonce, metadata_ciphertext,
                 body_nonce, body_ciphertext
          FROM attachment_entries
          WHERE session_id = ? AND attachment_id = ?
        `)
        .get(sessionId, attachmentId);
      if (!row) return null;

      const metadataBytes = decrypt(
        this.key,
        Buffer.from(row.metadata_nonce),
        Buffer.from(row.metadata_ciphertext),
        aad(this.deviceId, sessionId, attachmentId, "metadata"),
      );
      let metadata;
      try {
        metadata = JSON.parse(metadataBytes.toString("utf8"));
      } finally {
        metadataBytes.fill(0);
      }
      const source =
        row.source_kind === "local_path"
          ? metadata.source ?? { type: "local_path", path: metadata.path }
          : {
              type: "stored_bytes",
              bytes: decrypt(
                this.key,
                Buffer.from(row.body_nonce),
                Buffer.from(row.body_ciphertext),
                aad(this.deviceId, sessionId, attachmentId, "body"),
              ),
            };
      this.database
        .prepare(`
          UPDATE attachment_entries
          SET accessed_at_ms = ?
          WHERE session_id = ? AND attachment_id = ?
        `)
        .run(Date.now(), sessionId, attachmentId);
      return {
        sessionId,
        source,
        name: metadata.name,
        type: metadata.type,
        mimeType: metadata.mimeType,
        detail: metadata.detail,
      };
    } catch (error) {
      throw normalizeStoreError(error);
    }
  }

  deleteSession(sessionId) {
    this.assertOpen();
    if (!sessionId?.trim()) return;
    try {
      this.database
        .prepare("DELETE FROM attachment_entries WHERE session_id = ?")
        .run(sessionId);
    } catch (error) {
      throw normalizeStoreError(error);
    }
  }

  getIngestionCheckpoint(source) {
    this.assertOpen();
    try {
      const row = this.database
        .prepare(`
          SELECT byte_offset
          FROM ingestion_checkpoints
          WHERE source_id = ?
        `)
        .get(checkpointId(this.key, source));
      return row ? Number(row.byte_offset) : null;
    } catch (error) {
      throw normalizeStoreError(error);
    }
  }

  setIngestionCheckpoint(source, byteOffset) {
    this.assertOpen();
    if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) {
      throw storeError(
        "attachment_store_invalid",
        "Attachment ingestion checkpoint is invalid.",
      );
    }
    try {
      this.database
        .prepare(`
          INSERT INTO ingestion_checkpoints (source_id, byte_offset, updated_at_ms)
          VALUES (?, ?, ?)
          ON CONFLICT(source_id) DO UPDATE SET
            byte_offset = excluded.byte_offset,
            updated_at_ms = excluded.updated_at_ms
        `)
        .run(checkpointId(this.key, source), byteOffset, Date.now());
    } catch (error) {
      throw normalizeStoreError(error);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      this.database.close();
    } finally {
      this.key.fill(0);
    }
  }

  pruneInlineBytes() {
    const total = Number(
      this.database
        .prepare(`
          SELECT COALESCE(SUM(byte_size), 0) AS total
          FROM attachment_entries INDEXED BY attachment_entries_inline_budget
          WHERE source_kind = 'inline'
        `)
        .get().total,
    );
    let remaining = total;
    if (remaining <= this.maxInlineBytes) return;
    const oldest = this.database
      .prepare(`
        SELECT session_id, attachment_id, byte_size
        FROM attachment_entries INDEXED BY attachment_entries_inline_budget
        WHERE source_kind = 'inline'
        ORDER BY accessed_at_ms ASC, created_at_ms ASC
      `)
      .all();
    const remove = this.database.prepare(`
      DELETE FROM attachment_entries
      WHERE session_id = ? AND attachment_id = ?
    `);
    for (const row of oldest) {
      if (remaining <= this.maxInlineBytes) break;
      remove.run(row.session_id, row.attachment_id);
      remaining -= Number(row.byte_size);
    }
  }

  assertOpen() {
    if (this.closed) {
      throw storeError("attachment_store_closed", "Attachment store is closed.");
    }
  }
}

function prepareAttachment(attachment) {
  const source = attachment?.source;
  const metadata = {
    name: attachment?.name ?? null,
    type: attachment?.type ?? "file",
    mimeType: attachment?.mimeType ?? null,
    detail: attachment?.detail ?? null,
  };
  if (source?.type === "local_path" && isAbsolute(source.path ?? "")) {
    metadata.path = source.path;
    return { sourceKind: "local_path", metadata, body: null };
  }
  if (source?.type === 'rollout_jsonl' && isAbsolute(source.path ?? '') &&
      Number.isSafeInteger(source.offset) && source.offset >= 0 &&
      Number.isSafeInteger(source.length) && source.length > 0 && source.length <= 64 * 1024 * 1024 &&
      Number.isSafeInteger(source.data_url_index) && source.data_url_index >= 0 &&
      /^[0-9]+:[0-9]+$/.test(source.identity ?? '') && /^[a-f0-9]{64}$/.test(source.digest ?? '') &&
      /^[a-f0-9]{64}$/.test(source.content_digest ?? '')) {
    metadata.source = { type: source.type, path: source.path, offset: source.offset, length: source.length,
      identity: source.identity, digest: source.digest, data_url_index: source.data_url_index,
      content_digest: source.content_digest };
    if (isAbsolute(source.provenance_path ?? '')) metadata.source.provenance_path = source.provenance_path;
    return { sourceKind: 'local_path', metadata, body: null };
  }
  if (source?.type === "data_url") {
    const body = bytesFromDataUrl(source.url);
    return { sourceKind: "inline", metadata, body };
  }
  if (source?.type === "stored_bytes" && Buffer.isBuffer(source.bytes)) {
    return {
      sourceKind: "inline",
      metadata,
      body: Buffer.from(source.bytes),
    };
  }
  throw storeError("attachment_store_invalid", "Attachment source cannot be persisted.");
}

function matchingReferencedContent(key, deviceId, sessionId, attachmentId, row, prepared) {
  const expected = prepared.metadata.source?.content_digest;
  if (!expected) return false;
  const metadataBytes = decrypt(key, Buffer.from(row.metadata_nonce), Buffer.from(row.metadata_ciphertext),
    aad(deviceId, sessionId, attachmentId, 'metadata'));
  let metadata;
  try { metadata = JSON.parse(metadataBytes.toString('utf8')); } finally { metadataBytes.fill(0); }
  for (const field of ['name', 'type', 'mimeType', 'detail'])
    if (metadata[field] !== prepared.metadata[field]) return false;
  if (metadata.source?.content_digest) return metadata.source.content_digest === expected;
  if (row.source_kind === 'local_path' && metadata.path &&
      metadata.path === prepared.metadata.source.provenance_path) return true;
  if (row.source_kind !== 'inline') return false;
  const body = decrypt(key, Buffer.from(row.body_nonce), Buffer.from(row.body_ciphertext),
    aad(deviceId, sessionId, attachmentId, 'body'));
  try { return createHash('sha256').update(body).digest('hex') === expected; }
  finally { body.fill(0); }
}

function bytesFromDataUrl(value) {
  const match = /^data:[^;,]+;base64,([A-Za-z0-9+/]*={0,2})$/.exec(value ?? "");
  if (!match) {
    throw storeError("attachment_store_invalid", "Attachment data URL is invalid.");
  }
  return Buffer.from(match[1], "base64");
}

function sourceDigest(key, prepared) {
  const hmac = createHmac("sha256", key);
  hmac.update(prepared.sourceKind);
  hmac.update("\0");
  hmac.update(JSON.stringify(prepared.metadata));
  hmac.update("\0");
  if (prepared.body) hmac.update(prepared.body);
  return hmac.digest();
}

function checkpointId(key, source) {
  if (typeof source !== "string" || !source) {
    throw storeError(
      "attachment_store_invalid",
      "Attachment ingestion source is invalid.",
    );
  }
  return createHmac("sha256", key)
    .update("relayune/attachment-ingestion/v1\0")
    .update(source)
    .digest();
}

function verifyStoreKey(database, key) {
  const expected = createHmac("sha256", key)
    .update("relayune/attachment-store/key-check/v1")
    .digest();
  const row = database
    .prepare("SELECT key_check FROM store_config WHERE id = 1")
    .get();
  if (!row) {
    const attachmentCount = Number(
      database.prepare("SELECT COUNT(*) AS count FROM attachment_entries").get()
        .count,
    );
    const checkpointCount = Number(
      database.prepare("SELECT COUNT(*) AS count FROM ingestion_checkpoints").get()
        .count,
    );
    if (attachmentCount || checkpointCount) {
      throw storeError(
        "attachment_store_corrupt",
        "Attachment store key verification record is missing.",
      );
    }
    database
      .prepare("INSERT INTO store_config (id, key_check) VALUES (1, ?)")
      .run(expected);
    return;
  }
  const actual = Buffer.from(row.key_check);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw storeError(
      "attachment_store_key_invalid",
      "Attachment store key does not match this database.",
    );
  }
}

function encrypt(key, plaintext, additionalData) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(additionalData);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    nonce,
    ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]),
  };
}

function decrypt(key, nonce, ciphertext, additionalData) {
  if (nonce.length !== 12 || ciphertext.length < 16) {
    throw storeError("attachment_store_corrupt", "Attachment store record is malformed.");
  }
  const body = ciphertext.subarray(0, -16);
  const tag = ciphertext.subarray(-16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(additionalData);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function aad(deviceId, sessionId, attachmentId, segment) {
  return Buffer.from(
    `relayune/attachment-store/v1\0${deviceId}\0${sessionId}\0${attachmentId}\0${segment}`,
    "utf8",
  );
}

function decodeStoreKey(value) {
  if (typeof value !== "string") {
    throw storeError("attachment_store_key_invalid", "Attachment store key is required.");
  }
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32) {
    key.fill(0);
    throw storeError(
      "attachment_store_key_invalid",
      "Attachment store key must contain 32 bytes.",
    );
  }
  return key;
}

function validateIdentity(sessionId, attachmentId) {
  if (!sessionId?.trim() || !attachmentId?.trim()) {
    throw storeError(
      "attachment_store_invalid",
      "Attachment session and ID are required.",
    );
  }
}

function protectDatabaseFiles(path) {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    try {
      chmodSync(candidate, 0o600);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function prepareDatabaseFile(path) {
  try {
    const descriptor = openSync(
      path,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    closeSync(descriptor);
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  if (!lstatSync(path).isFile()) {
    throw storeError(
      "attachment_store_invalid",
      "Attachment store path is not a regular file.",
    );
  }
  chmodSync(path, 0o600);
}

function normalizeStoreError(error) {
  if (error?.code?.startsWith?.("attachment_")) return error;
  const normalized = storeError(
    "attachment_store_unavailable",
    "The encrypted attachment store is unavailable.",
  );
  normalized.cause = error;
  return normalized;
}

function storeError(code, message) {
  return Object.assign(new Error(message), { code });
}
