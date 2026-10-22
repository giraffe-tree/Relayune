// Coalesce only adjacent, fully identified text deltas before encryption and
// sequence allocation. Every other event is an ordering boundary.
export class DeltaCoalescer {
  constructor(write, { windowMs = 16, maxBytes = 64 * 1024 } = {}) {
    Object.assign(this, { write, windowMs, maxBytes });
    this.pending = null;
  }

  enqueue(sessionId, event, extra = {}) {
    if (this.closed) return this.write(sessionId, event, extra);
    const { text, ...metadata } = event;
    const eligible = event.kind === 'message.delta' &&
      typeof event.turn_id === 'string' && event.turn_id &&
      typeof event.item_id === 'string' && event.item_id && typeof text === 'string';
    const key = eligible ? JSON.stringify([sessionId, metadata, extra]) : null;
    const bytes = eligible ? Buffer.byteLength(text) : 0;
    if (this.pending && (this.pending.key !== key || this.pending.bytes + bytes > this.maxBytes)) this.flush();
    if (!key || bytes > this.maxBytes) return this.write(sessionId, event, extra);
    if (!this.pending) {
      const pending = { key, sessionId, event: { ...event }, extra: { ...extra }, bytes: 0, waiters: [] };
      this.pending = pending;
      pending.timer = setTimeout(() => this.flush(), this.windowMs);
    } else {
      this.pending.event.text += text;
    }
    this.pending.bytes += bytes;
    return new Promise((resolve, reject) => this.pending.waiters.push({ resolve, reject }));
  }

  close() {
    this.closed = true;
    this.flush();
  }

  flush() {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    // write reserves its place in the existing outbox append chain before
    // returning. A following terminal cannot overtake this delta.
    Promise.resolve(this.write(pending.sessionId, pending.event, pending.extra)).then(
      result => { for (const waiter of pending.waiters) waiter.resolve(result); },
      error => { for (const waiter of pending.waiters) waiter.reject(error); },
    );
  }
}
