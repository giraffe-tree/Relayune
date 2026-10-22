import { watch } from 'node:fs';

/** Changes are hints; a periodic authoritative read covers missed/unsupported watches. */
export class CatalogRefresh {
  constructor({ refresh, paths = [], watchPath = watch, debounceMs = 500,
    minIntervalMs = 5000, fallbackMs = 30000, now = () => performance.now() }) {
    Object.assign(this, { refresh, paths, watchPath, debounceMs, minIntervalMs, now });
    this.watchers = new Map();
    this.closed = false;
    this.dirty = false;
    this.lastStarted = -Infinity;
    this.attach();
    this.fallback = setInterval(() => { this.attach(); this.request(); }, fallbackMs);
    this.fallback.unref?.();
  }

  attach() {
    if (this.closed) return;
    for (const path of new Set(this.paths)) {
      if (this.watchers.has(path)) continue;
      try {
        const watcher = this.watchPath(path, { recursive: true, persistent: false }, () => this.request());
        watcher.on('error', () => {
          watcher.close();
          if (this.watchers.get(path) === watcher) this.watchers.delete(path);
          this.request();
        });
        this.watchers.set(path, watcher);
      } catch { /* Missing directories/unsupported watches retry at the fallback tick. */ }
    }
  }

  request() {
    if (this.closed) return;
    this.dirty = true;
    if (this.timer || this.running) return;
    const wait = Math.max(this.debounceMs, this.minIntervalMs - (this.now() - this.lastStarted));
    this.timer = setTimeout(() => { this.timer = null; void this.run(); }, wait);
    this.timer.unref?.();
  }

  async run() {
    if (this.closed || this.running || !this.dirty) return;
    this.dirty = false;
    this.running = true;
    this.lastStarted = this.now();
    try { await this.refresh(); } catch { /* A later hint or fallback retries. */ }
    finally {
      this.running = false;
      // Never lose a change that arrived during the authoritative read.
      if (this.dirty) this.request();
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.fallback);
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
}
