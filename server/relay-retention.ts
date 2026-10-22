import type { Db } from "mongodb";
import { EVENT_WINDOW_MS, RESPONSE_WINDOW_MS, COMMAND_RECEIPT_GRACE_MS } from "../shared/relay-retention.mjs";

export const RETENTION_BATCH_SIZE = 500;
export const RETENTION_INTERVAL_MS = 30_000;
export const RETENTION_QUERY_MS = 1_000;

type Blobs = { delete(key: string): Promise<unknown>; prune?(now: number): Promise<unknown> };

// Reads exclude expired payloads synchronously. TTL handles new rows even when
// the API is down; this bounded sweep also retires rows predating TTL and blobs.
export async function sweepRelayRetention(db: Db, blobs: Blobs, now = Date.now()) {
  const removed: Record<string, number> = {};
  for (const [name, field, cutoff] of [
    ["relay_events", "created_at", now - EVENT_WINDOW_MS],
    ["relay_responses", "created_at", now - RESPONSE_WINDOW_MS],
    ["relay_commands", "expires_at", now - COMMAND_RECEIPT_GRACE_MS],
  ] as const) {
    const collection = db.collection<{ _id: string; blob_key?: string }>(name);
    // Fetch identifiers only. Never load the accumulated encrypted payloads.
    const rows = await collection.find({ [field]: { $lte: cutoff } }, {
      projection: { _id: 1, blob_key: 1 }, maxTimeMS: RETENTION_QUERY_MS,
    }).sort({ [field]: 1 }).limit(RETENTION_BATCH_SIZE).toArray();
    const ids = [];
    for (const row of rows) {
      if (row.blob_key) await blobs.delete(row.blob_key);
      ids.push(row._id);
    }
    const result = ids.length ? await collection.deleteMany({ _id: { $in: ids }, [field]: { $lte: cutoff } },
      // The time index discovers a bounded batch above. Deletion must seek only
      // those IDs instead of rescanning the entire expired time range.
      { hint: "_id_", maxTimeMS: RETENTION_QUERY_MS }) : null;
    removed[name] = result?.deletedCount ?? 0;
  }
  // Also collects files orphaned by a crash or a Mongo TTL deletion.
  removed.blobs = Number(await blobs.prune?.(now) ?? 0);
  return removed;
}

export function startRelayRetention(db: Db, blobs: Blobs) {
  let running: Promise<unknown> | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    let delay = RETENTION_INTERVAL_MS;
    running = sweepRelayRetention(db, blobs).then(removed => {
      // Drain an existing backlog in small batches while yielding between them.
      if (Object.values(removed).some(count => count >= RETENTION_BATCH_SIZE)) delay = 250;
    }).catch(() => {
      console.error(JSON.stringify({ event: "relay_retention_failed", level: "error" }));
    }).finally(() => {
      running = null;
      if (!stopped) { timer = setTimeout(tick, delay); timer.unref(); }
    });
  };
  tick();
  return async () => { stopped = true; clearTimeout(timer); await running; };
}
