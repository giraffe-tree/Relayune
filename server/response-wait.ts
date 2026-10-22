// Transient, bounded wake-up hints; the encrypted payload stays in Mongo/blob storage.
export class ResponseWaitHub {
  private readonly waiters = new Map<string, Set<(reason: Reason) => void>>();
  private readonly counts = new Map<string, number>();
  private total = 0;
  private closed = false;

  subscribe(browserId: string, requestId: string, timeoutMs: number, signal?: AbortSignal) {
    if (this.closed || this.total >= 2048 || (this.counts.get(browserId) ?? 0) >= 8) return null;
    const key = JSON.stringify([browserId, requestId]);
    const group = this.waiters.get(key) ?? new Set<(reason: Reason) => void>();
    let resolve!: (reason: Reason) => void;
    const promise = new Promise<Reason>(done => { resolve = done; });
    let finished = false;
    const abort = () => finish("cancelled");
    const finish = (reason: Reason) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      group.delete(finish);
      if (!group.size) this.waiters.delete(key);
      const count = (this.counts.get(browserId) ?? 1) - 1;
      if (count) this.counts.set(browserId, count); else this.counts.delete(browserId);
      this.total--;
      resolve(reason);
    };
    group.add(finish);
    this.waiters.set(key, group);
    this.counts.set(browserId, (this.counts.get(browserId) ?? 0) + 1);
    this.total++;
    signal?.addEventListener("abort", abort, {once: true});
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    if (signal?.aborted) abort();
    return {promise, dispose: abort};
  }

  notify(browserId: string, requestId: string) {
    const group = this.waiters.get(JSON.stringify([browserId, requestId]));
    if (group) for (const finish of group) finish("response");
  }

  close() {
    this.closed = true;
    for (const group of this.waiters.values()) for (const finish of group) finish("cancelled");
  }
}

type Reason = "response" | "timeout" | "cancelled";
