import { performance } from "node:perf_hooks";
import type { Db } from "mongodb";

export class MongoBusyError extends Error {
  readonly status = 503;
  readonly code = "database_busy";
  readonly publicMessage = "服务繁忙，请稍后重试。";
  constructor() { super("database_busy"); }
}

type Pending = { cost: number; deadline: number; start(): void; reject(error: Error): void };

/** One budget for EVERY database consumer in the single Node service.
 * Reservations remain charged until one second AFTER completion, so pool or
 * server-selection delays cannot move already-admitted work into a later burst.
 * No accumulating tokens, per-route limits, or independent per-user allowances.
 */
export class MongoBudget {
  readonly limit: number;
  private readonly concurrency: number;
  private readonly queueLimit: number;
  private readonly waitMs: number;
  private pending: Pending[] = [];
  private held = 0;
  private active = 0;
  private completed: { cost: number; until: number }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private rejected = 0;
  private issued: number[] = [];
  private peak = 0;

  constructor(options: { limit?: number; concurrency?: number; queueLimit?: number; waitMs?: number } = {}) {
    this.limit = options.limit ?? 800;
    this.concurrency = options.concurrency ?? 20;
    this.queueLimit = options.queueLimit ?? 256;
    this.waitMs = options.waitMs ?? 1_500;
    if (!Number.isInteger(this.limit) || this.limit < 3 || this.limit > 800 ||
        !Number.isInteger(this.concurrency) || this.concurrency < 1 ||
        !Number.isInteger(this.queueLimit) || this.queueLimit < 1 || this.waitMs <= 0) {
      throw new Error("invalid_mongo_budget");
    }
  }

  run<T>(operation: () => Promise<T>, cost = 1): Promise<T> {
    if (this.stopped || cost < 1 || !Number.isInteger(cost) || cost > this.limit || this.pending.length >= this.queueLimit) {
      this.rejected++;
      return Promise.reject(new MongoBusyError());
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ cost, deadline: performance.now() + this.waitMs, reject,
        start: () => {
          this.active++;
          this.held += cost;
          void Promise.resolve().then(operation).then(resolve, reject).finally(() => {
            this.active--;
            this.completed.push({ cost, until: performance.now() + 1_000 });
            this.drain();
          });
        },
      });
      this.drain();
    });
  }

  /** Counts only names/times, never commands, namespaces, credentials or IDs. */
  observeCommand(name: string) {
    if (["hello", "ismaster", "isMaster", "endSessions"].includes(name)) return;
    const now = performance.now();
    this.issued = this.issued.filter(time => time > now - 1_000);
    this.issued.push(now);
    this.peak = Math.max(this.peak, this.issued.length);
  }

  snapshot() {
    const now = performance.now();
    return { limit: this.limit, active: this.active, queued: this.pending.length,
      rejected: this.rejected, commands_last_second: this.issued.filter(time => time > now - 1_000).length,
      peak_commands_per_second: this.peak };
  }

  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const request of this.pending.splice(0)) request.reject(new MongoBusyError());
  }

  private drain() {
    clearTimeout(this.timer);
    const now = performance.now();
    while (this.completed[0]?.until <= now) this.held -= this.completed.shift()!.cost;
    this.pending = this.pending.filter(request => {
      if (request.deadline > now) return true;
      this.rejected++;
      request.reject(new MongoBusyError());
      return false;
    });
    if (this.stopped) return;
    while (this.pending.length && this.active < this.concurrency && this.held + this.pending[0].cost <= this.limit) {
      this.pending.shift()!.start();
    }
    if (this.pending.length) {
      const wake = Math.min(this.pending[0].deadline, this.completed[0]?.until ?? Infinity);
      this.timer = setTimeout(() => this.drain(), Math.max(1, wake - performance.now()));
    }
  }
}

// The proxy is deliberately restricted to the driver surface used by this
// service. New I/O methods must be added here, never silently bypass the budget.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DriverObject = Record<PropertyKey, any>;
const reads = new Set(["findOne", "countDocuments", "estimatedDocumentCount", "distinct"]);
const writes = new Set(["insertOne", "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany", "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace", "createIndex", "createIndexes", "dropIndex", "dropIndexes"]);
const cursorFactories = new Set(["find", "aggregate", "listIndexes", "listCollections"]);
const cursorSetters = new Set(["sort", "skip", "limit", "project", "hint", "batchSize", "maxTimeMS", "maxAwaitTimeMS", "collation", "allowDiskUse", "comment"]);

export function budgetMongoDatabase(database: Db, budget: MongoBudget): Db {
  const collections = new Map<string, unknown>();
  const wrapCursor = (cursor: DriverObject): DriverObject => {
    const next = async (): Promise<unknown> => {
      while (true) {
        if (cursor.bufferedCount() > 0) return cursor.tryNext();
        if (cursor.closed) return null;
        // tryNext issues at most initial find/aggregate + getMore + cleanup.
        // Never call raw next/toArray: they can issue unlimited getMore calls.
        const value = await budget.run(() => cursor.tryNext(), 3);
        if (value !== null || cursor.closed) return value;
      }
    };
    const proxy: DriverObject = new Proxy(cursor, {
      get(target, property) {
        if (property === "next") return next;
        if (property === "tryNext") return () => target.bufferedCount() > 0 ? target.tryNext()
          : target.closed ? Promise.resolve(null) : budget.run(() => target.tryNext(), 3);
        if (property === "close") return () => target.closed ? Promise.resolve() : budget.run(() => target.close(), 1);
        if (property === Symbol.asyncIterator) return async function* () {
          try { for (let value = await next(); value !== null; value = await next()) yield value; }
          finally { await proxy.close(); }
        };
        if (property === "toArray") return async () => {
          const values = [];
          for await (const value of proxy as unknown as AsyncIterable<unknown>) values.push(value);
          return values;
        };
        if (property === "forEach") return async (callback: (value: unknown) => unknown) => {
          for await (const value of proxy as unknown as AsyncIterable<unknown>) if (callback(value) === false) break;
        };
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        if (cursorSetters.has(String(property))) return (...args: unknown[]) => {
          const result = value.apply(target, args);
          return result === target ? proxy : wrapCursor(result);
        };
        if (property === "bufferedCount") return value.bind(target);
        throw new Error("unsupported_budgeted_cursor_operation");
      },
    });
    return proxy;
  };

  const wrap = (target: DriverObject, isDatabase: boolean): DriverObject => new Proxy(target, {
    get(object, property) {
      if (isDatabase && property === "collection") return (name: string) => {
        if (!collections.has(name)) collections.set(name, wrap(object.collection(name), false));
        return collections.get(name);
      };
      const value = Reflect.get(object, property, object);
      if (typeof value !== "function") return value;
      const name = String(property);
      if (cursorFactories.has(name)) return (...args: unknown[]) => wrapCursor(value.apply(object, args));
      if (reads.has(name) || writes.has(name) || (isDatabase && name === "command")) {
        // countDocuments is aggregate + possible cursor cleanup. Conservative
        // read cost also covers findOne variations without exposing raw cursors.
        return (...args: unknown[]) => budget.run(() => value.apply(object, args), reads.has(name) ? 3 : 1);
      }
      // Bulk operations can be split into multiple wire batches by the driver.
      // Charge by statements/documents instead of pretending one batch is free.
      if (name === "insertMany" || name === "bulkWrite") return (items: unknown[], ...args: unknown[]) =>
        budget.run(() => value.apply(object, [items, ...args]), Math.max(1, items.length));
      throw new Error("unsupported_budgeted_database_operation");
    },
  });
  return wrap(database as unknown as DriverObject, true) as unknown as Db;
}
