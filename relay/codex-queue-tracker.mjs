// Only identifiers are persisted locally. Message content stays in Codex and
// the existing encrypted Relay outbox. Tracking never acquires a thread writer.
export class CodexQueueTracker {
  constructor({ request, readTurnStatuses = async () => new Map(), emit, save, remove, intervalMs = 2_000, maxMs = 35 * 60_000 }) {
    Object.assign(this, { request, readTurnStatuses, emit, save, remove, intervalMs, maxMs });
    this.receipts = new Map();
    this.sends = new Map();
    this.polls = new Map();
    this.timer = null;
    this.closed = false;
    this.generation = 0;
  }

  key(sessionId, clientMessageId) { return JSON.stringify([sessionId, clientMessageId]); }

  async restore(receipts = []) {
    this.closed = false;
    for (const receipt of receipts) {
      if (receipt.sessionId && receipt.clientMessageId && Number.isFinite(receipt.createdAt)) {
        this.receipts.set(this.key(receipt.sessionId, receipt.clientMessageId), { ...receipt });
      }
    }
    this.arm();
  }

  enqueue({ sessionId, clientMessageId, requestId, input }) {
    const key = this.key(sessionId, clientMessageId);
    if (this.sends.has(key)) return this.sends.get(key);
    const sending = this.send({ sessionId, clientMessageId, requestId, input }, key);
    this.sends.set(key, sending);
    void sending.finally(() => this.sends.delete(key)).catch(() => {});
    return sending;
  }

  async send({ sessionId, clientMessageId, requestId, input }, key) {
    if (this.closed) throw new Error("Codex queue tracker closed.");
    const previous = this.receipts.get(key);
    if (previous) return this.result(previous);
    const queue = await this.request("thread/queue/list", { threadId: sessionId });
    const existing = queue.data?.find(item => item.clientUserMessageId === clientMessageId);
    if (!existing) {
      const history = await this.request("thread/read", { threadId: sessionId, includeTurns: true });
      const turn = findMessageTurn(history.thread ?? history, clientMessageId);
      if (turn) return { mode: "started", turnId: turn.id, persisted: true, syncVerifiedAt: new Date().toISOString() };
    }
    const receipt = { sessionId, clientMessageId, requestId, createdAt: Date.now(), queuedSubmissionId: existing?.id ?? null };
    // Save before mutation: a crash/timeout after add must never blindly resend.
    await this.save(receipt);
    this.receipts.set(key, receipt);
    if (!existing) {
      try {
        const response = await this.request("thread/queue/add", { threadId: sessionId, input, clientUserMessageId: clientMessageId });
        receipt.queuedSubmissionId = response.queuedSubmission?.id ?? null;
        await this.save(receipt);
      } catch (error) {
        if ([-32600, -32601, -32602].includes(error.code)) {
          await this.remove(receipt);
          this.receipts.delete(key);
          throw error;
        }
        // The request may already have committed. Reconcile by ID, never add twice.
      }
    }
    this.arm();
    return this.result(receipt);
  }

  result(receipt) {
    return { mode: "queued", turnId: null, queuedSubmissionId: receipt.queuedSubmissionId,
      persisted: Boolean(receipt.queuedSubmissionId), syncVerifiedAt: new Date().toISOString() };
  }

  arm() {
    if (this.closed || this.timer || !this.receipts.size) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      await Promise.allSettled([...new Set([...this.receipts.values()].map(r => r.sessionId))].map(id => this.poll(id)));
      this.arm();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  poll(sessionId) {
    if (this.polls.has(sessionId)) return this.polls.get(sessionId);
    const polling = this.reconcile(sessionId);
    this.polls.set(sessionId, polling);
    void polling.finally(() => {
      if (this.polls.get(sessionId) === polling) this.polls.delete(sessionId);
    }).catch(() => {});
    return polling;
  }

  async reconcile(sessionId) {
    const generation = this.generation;
    const receipts = [...this.receipts.values()].filter(r => r.sessionId === sessionId);
    const [queue, history] = await Promise.allSettled([
      this.request("thread/queue/list", { threadId: sessionId }),
      this.request("thread/read", { threadId: sessionId, includeTurns: true }),
    ]);
    if (this.closed || generation !== this.generation) return;
    const thread = history.status === "fulfilled" ? history.value.thread ?? history.value : null;
    const statuses = thread ? await this.readTurnStatuses(thread).catch(() => new Map()) : new Map();
    if (this.closed || generation !== this.generation) return;
    for (const receipt of receipts) {
      const key = this.key(sessionId, receipt.clientMessageId);
      if (this.receipts.get(key) !== receipt) continue;
      const turn = history.status === "fulfilled" ? findMessageTurn(history.value.thread ?? history.value, receipt.clientMessageId) : null;
      const pending = queue.status === "fulfilled" && queue.value.data?.find(item =>
        item.clientUserMessageId === receipt.clientMessageId || (receipt.queuedSubmissionId && item.id === receipt.queuedSubmissionId));
      if (pending?.id && receipt.queuedSubmissionId !== pending.id) {
        receipt.queuedSubmissionId = pending.id;
        await this.save(receipt);
      }
      const expired = Date.now() - receipt.createdAt >= this.maxMs;
      const verifiedStatus = turn && statuses.get(turn.id);
      const terminal = ["completed", "failed", "interrupted"].includes(verifiedStatus);
      const status = terminal ? verifiedStatus : expired ? "unconfirmed" : turn ?
        (verifiedStatus === "running" || turn.status === "inProgress" ? "running" : "unconfirmed") :
        receipt.status === "running" ? "running" : pending ? "queued" : "unconfirmed";
      // Queue disappearance is not evidence of execution. Only a matching client
      // ID identifies the turn; only rollout lifecycle events verify its end.
      // Cross-process thread/read can label a live turn as interrupted.
      if (receipt.status !== status) {
        await this.emit(sessionId, { kind: "codex.queue.updated", client_message_id: receipt.clientMessageId,
          request_id: receipt.requestId, queued_submission_id: receipt.queuedSubmissionId,
          turn_id: turn?.id ?? null, status });
        receipt.status = status;
      }
      if (terminal || expired) {
        await this.remove(receipt);
        this.receipts.delete(key);
      }
    }
  }

  close() {
    this.generation += 1;
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.receipts.clear();
    this.polls.clear();
  }
}

function findMessageTurn(thread, clientMessageId) {
  return (thread.turns ?? []).find(turn => (turn.items ?? []).some(item =>
    item.type === "userMessage" && (item.clientId ?? item.client_id) === clientMessageId));
}
