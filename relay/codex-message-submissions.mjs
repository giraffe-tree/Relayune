// A client message ID is a correlation ID, not a Codex idempotency key.
// Keep a local admission record before dispatch. An ambiguous dispatch is only
// reconciled against native queue/history; it is never blindly repeated.
const RETENTION_MS = 24 * 60 * 60_000;
const MAX_RECEIPTS = 1000;

export class CodexMessageSubmissions {
  constructor({ save = async () => {}, remove = async () => {}, now = Date.now } = {}) {
    Object.assign(this, { save, remove, now });
    this.receipts = new Map();
    this.reserving = 0;
  }

  key(sessionId, clientMessageId) { return JSON.stringify([sessionId, clientMessageId]); }
  get(sessionId, clientMessageId) { return this.receipts.get(this.key(sessionId, clientMessageId)); }

  restore(receipts = []) {
    for (const value of receipts) {
      const receipt = submissionReceipt(value);
      if (receipt) this.receipts.set(this.key(receipt.sessionId, receipt.clientMessageId), receipt);
    }
  }

  async reserve(sessionId, clientMessageId) {
    const existing = this.get(sessionId, clientMessageId);
    if (existing) return existing;
    await Promise.all([...this.receipts.values()].filter(r => r.createdAt + RETENTION_MS < this.now())
      .map(receipt => this.forget(receipt)));
    // Do not evict an unresolved submission merely to make room for a new one.
    if (this.receipts.size + this.reserving >= MAX_RECEIPTS) throw new Error('Codex submission receipts are full; try again later.');
    const receipt = { sessionId, clientMessageId, createdAt: this.now(), state: 'pending' };
    this.reserving++;
    try {
      await this.save(receipt);
      this.receipts.set(this.key(sessionId, clientMessageId), receipt);
      return receipt;
    } finally { this.reserving--; }
  }

  async accept(receipt, result) {
    const next = submissionReceipt({ ...receipt, state: 'accepted', result });
    if (!next) throw new Error('Codex submission acceptance could not be confirmed.');
    await this.save(next);
    this.receipts.set(this.key(receipt.sessionId, receipt.clientMessageId), next);
  }

  async forget(receipt) {
    await this.remove(receipt);
    this.receipts.delete(this.key(receipt.sessionId, receipt.clientMessageId));
  }

  hasPending(sessionId) {
    return [...this.receipts.values()].some(r => r.sessionId === sessionId && r.state === 'pending');
  }
}

// Whitelist identifiers and acceptance metadata. Never persist message text,
// attachments, permission settings, provider errors, or arbitrary result fields.
export function submissionReceipt(value) {
  if (!value || typeof value.sessionId !== 'string' || !value.sessionId ||
      typeof value.clientMessageId !== 'string' || !value.clientMessageId ||
      !Number.isFinite(value.createdAt) || !['pending', 'accepted'].includes(value.state)) return null;
  const receipt = { sessionId: value.sessionId, clientMessageId: value.clientMessageId,
    createdAt: value.createdAt, state: value.state };
  if (value.state === 'accepted' && value.result && ['started', 'steered', 'queued'].includes(value.result.mode)) {
    const result = { mode: value.result.mode, turnId: typeof value.result.turnId === 'string' ? value.result.turnId : null,
      persisted: value.result.persisted === true };
    for (const key of ['queuedSubmissionId', 'syncVerifiedAt']) {
      if (typeof value.result[key] === 'string') result[key] = value.result[key];
    }
    receipt.result = result;
  }
  if (receipt.state === 'accepted' && !receipt.result) return null;
  return receipt;
}
