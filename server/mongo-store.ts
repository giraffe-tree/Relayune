import type { Collection, Db } from "mongodb";
import { MongoServerError } from "mongodb";
import { EVENT_WINDOW_MS, RESPONSE_WINDOW_MS, COMMAND_RECEIPT_GRACE_MS } from "../shared/relay-retention.mjs";
const QUERY_TIMEOUT_MS = 2_000;
// Legacy rows have no TTL date yet. Both predicates apply before Mongo's
// asynchronous TTL worker catches up. Deadlines never change on retries.
function retainedPayload(windowMs: number, now = Date.now()) {
  return { created_at: { $gt: now - windowMs }, $or: [
    { retention_expires_at: { $gt: new Date(now) } },
    { retention_expires_at: { $exists: false } },
  ] };
}

type QueryResult<T = Record<string, unknown>> = {
  results: T[];
  success: true;
  meta: {
    changes: number;
    last_row_id: number;
  };
};

type RunResult = Omit<QueryResult, "results">;

type MongoDocument = {
  _id: string;
  sequence?: number;
  [key: string]: unknown;
};

const COLLECTIONS = {
  users: "relay_users",
  devices: "relay_devices",
  catalogs: "relay_catalogs",
  commands: "relay_commands",
  responses: "relay_responses",
  events: "relay_events",
  counters: "relay_counters",
  browserAuthorizations: "relay_browser_authorizations",
} as const;

export async function initializeRelayMongo(db: Db) {
  await Promise.all(
    [
      [COLLECTIONS.catalogs, "relay_catalogs_device_uq"],
      [COLLECTIONS.events, "relay_events_device_seq_uq"],
      [COLLECTIONS.events, "relay_events_device_event_uq"],
    ].map(([collection, name]) =>
      db
        .collection(collection)
        .dropIndex(name)
        .catch((error: unknown) => {
          if (
            typeof error === "object" &&
            error !== null &&
            "codeName" in error &&
            ["IndexNotFound", "NamespaceNotFound"].includes(
              (error as { codeName?: string }).codeName ?? "",
            )
          ) {
            return;
          }
          throw error;
        }),
    ),
  );
  await Promise.all([
    ...[COLLECTIONS.events, COLLECTIONS.responses, COLLECTIONS.commands].flatMap(name => [
      db.collection(name).createIndex({ retention_expires_at: 1 }, { expireAfterSeconds: 0, name: "relay_retention_expiry" }),
      db.collection(name).createIndex({ [name === COLLECTIONS.commands ? "expires_at" : "created_at"]: 1 }, { name: "relay_retention_sweep" }),
    ]),
    db.collection(COLLECTIONS.events).createIndex({ device_id: 1, browser_id: 1, created_at: 1 }, { name: "relay_events_window_idx" }),
    db.collection(COLLECTIONS.events).createIndex({ device_id: 1, event_seq: 1 }, { name: "relay_events_device_seq_idx" }),
    db.collection(COLLECTIONS.users).createIndex(
      { email: 1 },
      { unique: true, name: "relay_users_email_uq" },
    ),
    db.collection(COLLECTIONS.devices).createIndex(
      { relay_token_hash: 1 },
      { unique: true, name: "relay_devices_token_uq" },
    ),
    db.collection(COLLECTIONS.devices).createIndex(
      { user_id: 1, revoked_at: 1, created_at: 1 },
      { name: "relay_devices_user_idx" },
    ),
    db.collection(COLLECTIONS.devices).createIndex(
      { last_seen_at: 1 },
      { name: "relay_devices_seen_idx" },
    ),
    db.collection(COLLECTIONS.browserAuthorizations).createIndex(
      { token_hash: 1 },
      { unique: true, name: "relay_browser_authorizations_token_uq" },
    ),
    db.collection(COLLECTIONS.browserAuthorizations).createIndex(
      { device_id: 1, revoked_at: 1, created_at: -1 },
      { name: "relay_browser_authorizations_device_idx" },
    ),
    db.collection(COLLECTIONS.catalogs).createIndex(
      { device_id: 1, browser_id: 1 },
      { unique: true, name: "relay_catalogs_device_browser_uq" },
    ),
    db.collection(COLLECTIONS.commands).createIndex(
      { user_id: 1, idempotency_key: 1 },
      { unique: true, name: "relay_commands_user_idempotency_uq" },
    ),
    db.collection(COLLECTIONS.commands).createIndex(
      { device_id: 1, status: 1, expires_at: 1, created_at: 1 },
      { name: "relay_commands_poll_idx" },
    ),
    db.collection(COLLECTIONS.responses).createIndex(
      { request_id: 1 },
      { unique: true, name: "relay_responses_request_uq" },
    ),
    db.collection(COLLECTIONS.responses).createIndex(
      { user_id: 1, request_id: 1 },
      { name: "relay_responses_user_request_idx" },
    ),
    db.collection(COLLECTIONS.events).createIndex(
      { cursor: 1 },
      { unique: true, name: "relay_events_cursor_uq" },
    ),
    db.collection(COLLECTIONS.events).createIndex(
      { device_id: 1, browser_id: 1, event_seq: 1 },
      { unique: true, name: "relay_events_device_browser_seq_uq" },
    ),
    db.collection(COLLECTIONS.events).createIndex(
      { device_id: 1, browser_id: 1, event_id: 1 },
      { unique: true, name: "relay_events_device_browser_event_uq" },
    ),
    db.collection(COLLECTIONS.events).createIndex(
      { device_id: 1, browser_id: 1, cursor: 1 },
      { name: "relay_events_device_browser_cursor_idx" },
    ),
    db.collection(COLLECTIONS.events).createIndex(
      { device_id: 1, session_id: 1, cursor: 1 },
      { name: "relay_events_session_cursor_idx" },
    ),
  ]);
}

export class MongoStore {
  constructor(readonly db: Db) {}

  async eventWindow(deviceId: string, browserId: string, cursor: number) {
    if (cursor === 0) return null;
    const filter = { device_id: deviceId, browser_id: browserId, ...retainedPayload(EVENT_WINDOW_MS) };
    const retained = await this.db.collection(COLLECTIONS.events).findOne({ ...filter, cursor },
      { projection: { _id: 1 }, maxTimeMS: QUERY_TIMEOUT_MS });
    if (retained) return null;
    const head = await this.db.collection(COLLECTIONS.events).findOne(filter,
      { sort: { cursor: -1 }, projection: { cursor: 1 }, hint: "relay_events_window_idx", maxTimeMS: QUERY_TIMEOUT_MS });
    return { reset_cursor: Number(head?.cursor ?? 0) };
  }

  prepare(query: string) {
    return new MongoPreparedStatement(this, query);
  }

  async batch(statements: MongoPreparedStatement[]) {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }

  async execute(query: string, values: unknown[]): Promise<QueryResult> {
    const sql = normalizeSql(query);
    const rows = await this.read(sql, values);
    return result(rows);
  }

  async mutate(query: string, values: unknown[]): Promise<RunResult> {
    const sql = normalizeSql(query);
    const changes = await this.write(sql, values);
    return {
      success: true,
      meta: { changes, last_row_id: 0 },
    };
  }

  private collection(name: string): Collection<MongoDocument> {
    return this.db.collection<MongoDocument>(name);
  }

  private async read(
    sql: string,
    values: unknown[],
  ): Promise<Record<string, unknown>[]> {
    if (
      sql.startsWith(
        "select id, name, ack_seq, last_seen_at from relay_devices where user_id = ?",
      )
    ) {
      const [userId] = values;
      const row = await this.collection(COLLECTIONS.devices).findOne(
        { user_id: userId, revoked_at: null },
        {
          sort: { last_seen_at: -1, created_at: -1 },
          projection: {
            _id: 0,
            id: 1,
            name: 1,
            ack_seq: 1,
            last_seen_at: 1,
          },
        },
      );
      return row ? [row] : [];
    }
    if (sql.startsWith("select aad, envelope, updated_at from relay_catalogs")) {
      const [deviceId, browserId] = values;
      const row = await this.collection(COLLECTIONS.catalogs).findOne(
        { device_id: deviceId, browser_id: browserId },
        { projection: { _id: 0, aad: 1, envelope: 1, updated_at: 1 } },
      );
      return row ? [row] : [];
    }
    if (sql.includes("as recent_events")) {
      const [deviceId, browserId] = values;
      const rows = await this.collection(COLLECTIONS.events)
        .find({ device_id: deviceId, browser_id: browserId, ...retainedPayload(EVENT_WINDOW_MS) }, { maxTimeMS: QUERY_TIMEOUT_MS })
        .hint("relay_events_window_idx")
        .sort({ cursor: -1 })
        .limit(200)
        .project(eventProjection(false))
        .toArray();
      return rows.reverse();
    }
    if (sql.startsWith("select sum(case when status = 'queued'")) {
      const [deviceId, browserId, now] = values;
      const counts = await this.collection(COLLECTIONS.commands)
        .aggregate<{ _id: null; queued: number; pending: number }>([
          {
            $match: {
              device_id: deviceId,
              browser_id: browserId,
              expires_at: { $gt: now },
            },
          },
          {
            $group: {
              _id: null,
              queued: {
                $sum: { $cond: [{ $eq: ["$status", "queued"] }, 1, 0] },
              },
              pending: {
                $sum: {
                  $cond: [{ $in: ["$status", ["queued", "leased"]] }, 1, 0],
                },
              },
            },
          },
        ])
        .next();
      return [{ queued: counts?.queued ?? 0, pending: counts?.pending ?? 0 }];
    }
    if (sql.startsWith("select coalesce(max(cursor), 0) as cursor")) {
      const [deviceId, browserId] = values;
      return [
        {
          cursor: await this.maxCursor({
            device_id: deviceId,
            browser_id: browserId,
          }),
        },
      ];
    }
    if (
      sql.startsWith(
        "select device_id, browser_id, session_id, aad, envelope, blob_key, created_at from relay_responses",
      )
    ) {
      const [requestId, userId] = values;
      const row = await this.collection(COLLECTIONS.responses).findOne(
        { request_id: requestId, user_id: userId, ...retainedPayload(RESPONSE_WINDOW_MS) },
        { maxTimeMS: QUERY_TIMEOUT_MS, projection: { _id: 0, user_id: 0 } },
      );
      return row ? [row] : [];
    }
    if (
      sql.startsWith(
        "select id from relay_commands where device_id = ? and expires_at > ?",
      )
    ) {
      const [deviceId, now, leasedBefore, limit] = values;
      return this.collection(COLLECTIONS.commands)
        .find({
          device_id: deviceId,
          expires_at: { $gt: now },
          $or: [
            { status: "queued" },
            { status: "leased", leased_until: { $lte: leasedBefore } },
          ],
        })
        .sort({ created_at: 1 })
        .limit(Number(limit))
        .project({ _id: 0, id: 1 })
        .toArray();
    }
    if (
      sql.startsWith(
        "select id, browser_id, session_id, type, direction, aad, envelope, blob_key, expires_at, created_at from relay_commands",
      )
    ) {
      const [deviceId, leaseId] = values;
      return this.collection(COLLECTIONS.commands)
        .find({ device_id: deviceId, lease_id: leaseId })
        .sort({ created_at: 1 })
        .project({
          _id: 0,
          id: 1,
          browser_id: 1,
          session_id: 1,
          type: 1,
          direction: 1,
          aad: 1,
          envelope: 1,
          blob_key: 1,
          expires_at: 1,
          created_at: 1,
        })
        .toArray();
    }
    if (
      sql.startsWith(
        "select id, device_id, browser_id, session_id, type, direction, aad, envelope, blob_key, status, expires_at, created_at from relay_commands",
      )
    ) {
      const [userId, idempotencyKey] = values;
      const row = await this.collection(COLLECTIONS.commands).findOne(
        { user_id: userId, idempotency_key: idempotencyKey },
        { projection: { _id: 0, user_id: 0 } },
      );
      return row ? [row] : [];
    }
    if (
      sql.startsWith(
        "select blob_key from relay_commands where device_id = ? and expires_at <= ?",
      )
    ) {
      const [deviceId, now] = values;
      return this.collection(COLLECTIONS.commands)
        .find({
          device_id: deviceId,
          expires_at: { $lte: now },
          status: { $in: ["queued", "leased"] },
          blob_key: { $type: "string" },
        })
        .project({ _id: 0, blob_key: 1 })
        .toArray();
    }
    if (
      sql.startsWith(
        "select blob_key from relay_commands where id = ? and device_id = ?",
      )
    ) {
      const [id, deviceId] = values;
      const row = await this.collection(COLLECTIONS.commands).findOne(
        { id, device_id: deviceId },
        { projection: { _id: 0, blob_key: 1 } },
      );
      return row ? [row] : [];
    }
    if (
      sql.startsWith(
        "select cursor, session_id, agent_id, request_id, event_id, event_seq, type, direction, aad, envelope, created_at from relay_events",
      )
    ) {
      const hasSession = sql.includes("and session_id = ?");
      const [deviceId, browserId, cursor, sessionOrLimit, maybeLimit] = values;
      const filter: Record<string, unknown> = {
        device_id: deviceId,
        browser_id: browserId,
        cursor: { $gt: cursor },
        ...retainedPayload(EVENT_WINDOW_MS),
      };
      if (hasSession) filter.session_id = sessionOrLimit;
      const limit = Number(hasSession ? maybeLimit : sessionOrLimit);
      return this.collection(COLLECTIONS.events)
        .find(filter, { maxTimeMS: QUERY_TIMEOUT_MS })
        .hint(Number(cursor) === 0 ? "relay_events_window_idx" : "relay_events_device_browser_cursor_idx")
        .sort({ cursor: 1 })
        .limit(limit)
        .project(eventProjection(true))
        .toArray();
    }
    if (
      sql.startsWith(
        "select session_id, agent_id, request_id, event_id, aad, envelope, created_at from relay_events where device_id = ? and browser_id = ? and event_seq = ?",
      )
    ) {
      const [deviceId, browserId, eventSeq] = values;
      const row = await this.collection(COLLECTIONS.events).findOne(
        {
          device_id: deviceId,
          browser_id: browserId,
          event_seq: eventSeq,
        },
        {
          projection: {
            _id: 0,
            session_id: 1,
            agent_id: 1,
            request_id: 1,
            event_id: 1,
            aad: 1,
            envelope: 1,
            created_at: 1,
          },
        },
      );
      return row ? [row] : [];
    }
    if (sql === "select id, email from relay_users where email = ?") {
      const [email] = values;
      const row = await this.collection(COLLECTIONS.users).findOne(
        { email },
        { projection: { _id: 0, id: 1, email: 1 } },
      );
      return row ? [row] : [];
    }
    if (sql === "select id, email from relay_users where id = ?") {
      const [id] = values;
      const row = await this.collection(COLLECTIONS.users).findOne(
        { id },
        { projection: { _id: 0, id: 1, email: 1 } },
      );
      return row ? [row] : [];
    }
    if (
      sql.startsWith(
        "select id, user_id, name, identity_public_key, encrypted_descriptor, key_epoch, protocol_version, ack_seq, created_at, last_seen_at from relay_devices where relay_token_hash = ?",
      )
    ) {
      const [tokenHash] = values;
      const row = await this.collection(COLLECTIONS.devices).findOne(
        { relay_token_hash: tokenHash, revoked_at: null },
        { projection: { _id: 0, relay_token_hash: 0, revoked_at: 0 } },
      );
      return row ? [row] : [];
    }
    if (
      sql.startsWith(
        "select id, device_id, user_id, name, key_id, created_at, last_seen_at from relay_browser_authorizations where token_hash = ?",
      )
    ) {
      const [tokenHash, deviceId, userId] = values;
      const row = await this.collection(
        COLLECTIONS.browserAuthorizations,
      ).findOne(
        {
          token_hash: tokenHash,
          device_id: deviceId,
          user_id: userId,
          revoked_at: null,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            device_id: 1,
            user_id: 1,
            name: 1,
            key_id: 1,
            created_at: 1,
            last_seen_at: 1,
          },
        },
      );
      return row ? [row] : [];
    }
    if (
      sql.startsWith(
        "select id, device_id, user_id, name, key_id, created_at, last_seen_at from relay_browser_authorizations where device_id = ?",
      )
    ) {
      const [deviceId] = values;
      return this.collection(COLLECTIONS.browserAuthorizations)
        .find({ device_id: deviceId, revoked_at: null })
        .sort({ created_at: 1 })
        .project({
          _id: 0,
          id: 1,
          device_id: 1,
          user_id: 1,
          name: 1,
          key_id: 1,
          created_at: 1,
          last_seen_at: 1,
        })
        .toArray();
    }
    if (
      sql.includes(
        "from relay_devices where id = ? and user_id = ? and relay_token_hash = ?",
      )
    ) {
      const [id, userId, tokenHash] = values;
      const row = await this.collection(COLLECTIONS.devices).findOne(
        {
          id,
          user_id: userId,
          relay_token_hash: tokenHash,
          revoked_at: null,
        },
        { projection: { _id: 0, relay_token_hash: 0, revoked_at: 0 } },
      );
      return row ? [row] : [];
    }
    if (
      sql.includes(
        "from relay_devices where id = ? and user_id = ? and revoked_at is null",
      )
    ) {
      const [id, userId] = values;
      const row = await this.collection(COLLECTIONS.devices).findOne(
        { id, user_id: userId, revoked_at: null },
        { projection: { _id: 0, relay_token_hash: 0, revoked_at: 0 } },
      );
      return row ? [row] : [];
    }
    if (
      sql.startsWith(
        "select event_seq from relay_events where device_id = ? and event_seq > ?",
      )
    ) {
      const [deviceId, eventSeq] = values;
      return this.collection(COLLECTIONS.events)
        .find({ device_id: deviceId, event_seq: { $gt: eventSeq } }, { maxTimeMS: QUERY_TIMEOUT_MS })
        .hint("relay_events_device_seq_idx")
        .sort({ event_seq: 1 })
        .limit(500)
        .project({ _id: 0, event_seq: 1 })
        .toArray();
    }
    throw unsupportedQuery("read", sql);
  }

  private async write(sql: string, values: unknown[]): Promise<number> {
    if (
      sql ===
      "update relay_devices set revoked_at = ?, last_seen_at = null where id = ? and revoked_at is null"
    ) {
      const [revokedAt, id] = values;
      const operation = await this.collection(COLLECTIONS.devices).updateOne(
        { id, revoked_at: null },
        { $set: { revoked_at: revokedAt, last_seen_at: null } },
      );
      return operation.modifiedCount;
    }
    if (
      sql.startsWith(
        "update relay_devices set last_seen_at = ?, protocol_version = ?",
      )
    ) {
      const [lastSeenAt, protocolVersion, keyEpoch, descriptor, id] = values;
      const operation = await this.collection(COLLECTIONS.devices).updateOne(
        { id, revoked_at: null },
        {
          $set: {
            last_seen_at: lastSeenAt,
            protocol_version: protocolVersion,
            key_epoch: keyEpoch,
            encrypted_descriptor: descriptor,
          },
        },
      );
      return operation.matchedCount;
    }
    if (sql.startsWith("update relay_commands set status = 'expired'")) {
      const [deviceId, now] = values;
      const operation = await this.collection(COLLECTIONS.commands).updateMany(
        {
          device_id: deviceId,
          expires_at: { $lte: now },
          status: { $in: ["queued", "leased"] },
        },
        {
          $set: {
            status: "expired",
            lease_id: null,
            leased_until: null,
            envelope: null,
            blob_key: null,
          },
        },
      );
      return operation.modifiedCount;
    }
    if (
      sql ===
      "update relay_devices set last_seen_at = ? where id = ? and revoked_at is null"
    ) {
      const [lastSeenAt, id] = values;
      const operation = await this.collection(COLLECTIONS.devices).updateOne(
        { id, revoked_at: null },
        { $set: { last_seen_at: lastSeenAt } },
      );
      return operation.matchedCount;
    }
    if (
      sql ===
      "update relay_browser_authorizations set last_seen_at = ? where id = ? and revoked_at is null"
    ) {
      const [lastSeenAt, id] = values;
      const operation = await this.collection(
        COLLECTIONS.browserAuthorizations,
      ).updateOne(
        { id, revoked_at: null },
        { $set: { last_seen_at: lastSeenAt } },
      );
      return operation.matchedCount;
    }
    if (
      sql ===
      "update relay_browser_authorizations set last_seen_at = ?, client_version = ? where id = ? and revoked_at is null"
    ) {
      const [lastSeenAt, clientVersion, id] = values;
      const operation = await this.collection(
        COLLECTIONS.browserAuthorizations,
      ).updateOne(
        { id, revoked_at: null },
        { $set: { last_seen_at: lastSeenAt, client_version: clientVersion } },
      );
      return operation.matchedCount;
    }
    if (sql.startsWith("update relay_commands set status = 'leased'")) {
      const [leaseId, leasedUntil, id, deviceId, now, leasedBefore] = values;
      const operation = await this.collection(COLLECTIONS.commands).updateOne(
        {
          id,
          device_id: deviceId,
          expires_at: { $gt: now },
          $or: [
            { status: "queued" },
            { status: "leased", leased_until: { $lte: leasedBefore } },
          ],
        },
        { $set: { status: "leased", lease_id: leaseId, leased_until: leasedUntil } },
      );
      return operation.modifiedCount;
    }
    if (sql.startsWith("insert into relay_catalogs")) {
      const [deviceId, browserId, sessionRefs, aad, envelope, updatedAt] = values;
      try {
        const operation = await this.collection(COLLECTIONS.catalogs).updateOne(
          {
            device_id: deviceId,
            browser_id: browserId,
            $or: [
              { updated_at: { $lte: updatedAt } },
              { updated_at: { $exists: false } },
            ],
          },
          {
            $set: {
              session_refs: sessionRefs,
              aad,
              envelope,
              updated_at: updatedAt,
            },
            $setOnInsert: {
              _id: `${deviceId}:${browserId}`,
              device_id: deviceId,
              browser_id: browserId,
            },
          },
          { upsert: true },
        );
        return operation.upsertedCount || operation.modifiedCount;
      } catch (error) {
        if (isDuplicate(error)) return 0;
        throw error;
      }
    }
    if (sql.startsWith("insert into relay_events")) {
      const [
        deviceId,
        browserId,
        sessionId,
        agentId,
        requestId,
        eventId,
        eventSeq,
        type,
        direction,
        aad,
        envelope,
        createdAt,
        receivedAt,
      ] = values;
      const cursor = await this.nextEventCursor();
      try {
        await this.collection(COLLECTIONS.events).insertOne({
          _id: `${deviceId}:${browserId}:${eventSeq}`,
          cursor,
          device_id: deviceId,
          browser_id: browserId,
          session_id: sessionId,
          agent_id: agentId,
          request_id: requestId,
          event_id: eventId,
          event_seq: eventSeq,
          type,
          direction,
          aad,
          envelope,
          created_at: createdAt,
          received_at: receivedAt,
          retention_expires_at: new Date(Number(createdAt) + EVENT_WINDOW_MS),
        });
        return 1;
      } catch (error) {
        if (isDuplicate(error)) return 0;
        throw error;
      }
    }
    if (sql.startsWith("insert into relay_responses")) {
      const [
        requestId,
        userId,
        deviceId,
        browserId,
        sessionId,
        aad,
        envelope,
        blobKey,
        createdAt,
      ] = values;
      try {
        await this.collection(COLLECTIONS.responses).insertOne({
          _id: String(requestId),
          request_id: requestId,
          user_id: userId,
          device_id: deviceId,
          browser_id: browserId,
          session_id: sessionId,
          aad,
          envelope,
          blob_key: blobKey,
          created_at: createdAt,
          retention_expires_at: new Date(Number(createdAt) + RESPONSE_WINDOW_MS),
        });
        return 1;
      } catch (error) {
        if (isDuplicate(error)) return 0;
        throw error;
      }
    }
    if (
      sql.startsWith(
        "update relay_commands set status = ?, acknowledged_at = ?",
      )
    ) {
      const [status, acknowledgedAt, id, deviceId] = values;
      const operation = await this.collection(COLLECTIONS.commands).updateOne(
        { id, device_id: deviceId },
        {
          $set: {
            status,
            acknowledged_at: acknowledgedAt,
            lease_id: null,
            leased_until: null,
            envelope: null,
            blob_key: null,
          },
        },
      );
      return operation.matchedCount;
    }
    if (
      sql.startsWith(
        "update relay_devices set last_seen_at = ?, ack_seq = case",
      )
    ) {
      const [lastSeenAt, , ackSeq, id] = values;
      const operation = await this.collection(COLLECTIONS.devices).updateOne(
        { id, revoked_at: null },
        { $set: { last_seen_at: lastSeenAt }, $max: { ack_seq: ackSeq } },
      );
      return operation.matchedCount;
    }
    if (sql.startsWith("insert into relay_commands")) {
      const [
        id,
        userId,
        deviceId,
        browserId,
        sessionId,
        type,
        direction,
        aad,
        envelope,
        blobKey,
        idempotencyKey,
        expiresAt,
        createdAt,
      ] = values;
      try {
        await this.collection(COLLECTIONS.commands).insertOne({
          _id: String(id),
          id,
          user_id: userId,
          device_id: deviceId,
          browser_id: browserId,
          session_id: sessionId,
          type,
          direction,
          aad,
          envelope,
          blob_key: blobKey,
          idempotency_key: idempotencyKey,
          status: "queued",
          lease_id: null,
          leased_until: null,
          expires_at: expiresAt,
          retention_expires_at: new Date(Number(expiresAt) + COMMAND_RECEIPT_GRACE_MS),
          created_at: createdAt,
          acknowledged_at: null,
        });
        return 1;
      } catch (error) {
        if (isDuplicate(error)) return 0;
        throw error;
      }
    }
    if (sql.startsWith("insert into relay_users")) {
      const [id, email, createdAt, updatedAt] = values;
      const operation = await this.collection(COLLECTIONS.users).updateOne(
        { email },
        {
          $set: { updated_at: updatedAt },
          $setOnInsert: {
            _id: String(id),
            id,
            email,
            created_at: createdAt,
          },
        },
        { upsert: true },
      );
      return operation.upsertedCount || operation.modifiedCount;
    }
    throw unsupportedQuery("write", sql);
  }

  private async maxCursor(filter: Record<string, unknown>): Promise<number> {
    const row = await this.collection(COLLECTIONS.events).findOne(filter, {
      sort: { cursor: -1 },
      maxTimeMS: QUERY_TIMEOUT_MS,
      projection: { cursor: 1 },
    });
    return Number(row?.cursor ?? 0);
  }

  private async nextEventCursor(): Promise<number> {
    const counter = await this.db
      .collection<{ _id: string; sequence: number }>(COLLECTIONS.counters)
      .findOneAndUpdate(
        { _id: "relay_events_cursor" },
        { $inc: { sequence: 1 } },
        { upsert: true, returnDocument: "after" },
      );
    return Number(counter?.sequence ?? 1);
  }
}

export class MongoPreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: MongoStore,
    readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async all<T>() {
    return (await this.database.execute(this.query, this.values)) as QueryResult<T>;
  }

  async first<T>() {
    const response = await this.all<T>();
    return response.results[0] ?? null;
  }

  async run() {
    return this.database.mutate(this.query, this.values);
  }
}

function normalizeSql(query: string) {
  return query
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function eventProjection(includeRoutingType: boolean) {
  return {
    _id: 0,
    cursor: 1,
    session_id: 1,
    agent_id: 1,
    request_id: 1,
    event_id: 1,
    event_seq: 1,
    ...(includeRoutingType ? { type: 1, direction: 1 } : {}),
    aad: 1,
    envelope: 1,
    created_at: 1,
  };
}

function result<T>(rows: T[], changes = 0): QueryResult<T> {
  return {
    results: rows,
    success: true,
    meta: { changes, last_row_id: 0 },
  };
}

function isDuplicate(error: unknown) {
  return error instanceof MongoServerError && error.code === 11000;
}

function unsupportedQuery(kind: string, sql: string) {
  return new Error(`Unsupported Mongo relay ${kind} query: ${sql.slice(0, 180)}`);
}
