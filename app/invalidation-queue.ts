const allowed = new Set(['events', 'catalog', 'queue', 'responses']);

/** Union notifications while a drain is scheduled/in flight, retaining trailing updates. */
export function createInvalidationQueue({ run, onError, delayMs = 25 }: {
  run(scopes: string[]): Promise<void>;
  onError(): void;
  delayMs?: number;
}) {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let disposed = false;
  let retryAttempt = 0;
  async function drain() {
    timer = null;
    if (disposed || running || !pending.size) return;
    running = true;
    const scopes = [...pending];
    pending.clear();
    let failed = false;
    try { await run(scopes); }
    catch {
      failed = true;
      if (!disposed) { for (const scope of scopes) pending.add(scope); onError(); }
    } finally {
      running = false;
      // Expired-window recovery must retry even if no later event is produced.
      // Keep a single timer and bounded backoff instead of a tight failure loop.
      const wait = failed ? Math.min(30_000, 1_000 * 2 ** Math.min(retryAttempt++, 5)) : delayMs;
      if (!failed) retryAttempt = 0;
      if (!disposed && pending.size) schedule(wait);
    }
  }
  function schedule(wait = delayMs) {
    if (!disposed && !running && timer === null && pending.size) timer = setTimeout(() => void drain(), wait);
  }
  return {
    enqueue(scopes: string[]) {
      if (disposed) return;
      for (const scope of scopes) if (allowed.has(scope)) pending.add(scope);
      schedule();
    },
    dispose() { disposed = true; pending.clear(); if (timer !== null) clearTimeout(timer); timer = null; },
  };
}
