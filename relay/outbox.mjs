import { transportPayloadExpired } from "../shared/relay-retention.mjs";
import { hashAction } from "./protocol.mjs";
import { submissionReceipt } from './codex-message-submissions.mjs';
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class RelayOutbox {
  constructor(path = null) {
    this.path = path;
    this.nextSeq = 1;
    this.lastAcked = 0;
    this.pending = new Map();
    this.processedRequests = new Set();
    this.transportRequests = Object.create(null);
    this.projectOperations = {};
    this.codexQueueReceipts = {};
    this.codexMessageReceipts = {};
    this.writeChain = null;
    this.writeRevision = 0;
    this.appendChain = Promise.resolve();
  }

  async load() {
    if (!this.path) return;
    const raw = await readFile(this.path, "utf8").catch(() => null);
    if (!raw) return;
    const stored = JSON.parse(raw);
    this.transportRequests = Object.assign(Object.create(null), stored.transportRequests ?? {});
    this.projectOperations = stored.projectOperations ?? {};
    this.codexQueueReceipts = stored.codexQueueReceipts ?? {};
    this.codexMessageReceipts = Object.fromEntries(Object.values(stored.codexMessageReceipts ?? {})
      .map(submissionReceipt).filter(Boolean).map(r => [JSON.stringify([r.sessionId, r.clientMessageId]), r]));
    this.nextSeq = Math.max(1, Number(stored.nextSeq) || 1);
    this.lastAcked = Math.max(0, Number(stored.lastAcked) || 0);
    this.pending = new Map(
      Array.isArray(stored.pending)
        ? stored.pending.map((event) => [event.event_seq, event])
        : [],
    );
    this.processedRequests = new Set(
      Array.isArray(stored.processedRequests) ? stored.processedRequests : [],
    );
  }

  async append(event) {
    return this.appendWithSequence((eventSeq) => ({
      ...event,
      event_seq: eventSeq,
    }));
  }

  async appendWithSequence(createRecord) {
    // Commit the sequence only after encryption succeeds. Neither concurrent
    // persistence nor a crash may save a reservation without its event.
    const operation = this.appendChain.catch(() => {}).then(async () => {
      const eventSeq = this.nextSeq;
      const record = await createRecord(eventSeq);
      // Offline recipients do not create empty durable events or consume a
      // sequence. The serialized callback may discover an expired subscription.
      if (record === null) return null;
      if (record.event_seq !== eventSeq) {
        throw new Error("Outbox record must bind the reserved event_seq.");
      }
      this.nextSeq = eventSeq + 1;
      this.pending.set(eventSeq, record);
      await this.persist();
      return record;
    });
    this.appendChain = operation;
    return operation;
  }

  async acknowledge(ackSeq, deliveredSequences = []) {
    // Successful atomic pushes are durable receipts even when an older
    // version left a gap holding back the server's contiguous cursor.
    const previous = this.lastAcked;
    this.lastAcked = Math.max(previous, ackSeq);
    let changed = previous !== this.lastAcked;
    for (const sequence of deliveredSequences) {
      if (this.pending.get(sequence)?.type !== "opaque.event.bundle") changed = this.pending.delete(sequence) || changed;
    }
    for (const sequence of this.pending.keys()) {
      if (sequence <= this.lastAcked && this.pending.get(sequence)?.type !== "opaque.event.bundle") { this.pending.delete(sequence); changed = true; }
    }
    if (changed) await this.persist();
  }

  isQuarantinedEventVariant(message) {
    if (message.kind !== "event") return false;
    const record = this.pending.get(message.event_seq);
    return record?.rejected_uploads?.[message.browser_id] === hashAction(message);
  }

  async quarantineConflictingVariant(message) {
    const record = this.pending.get(message.event_seq);
    if (record?.type !== "opaque.event.bundle" || !record.variants.some(variant =>
      variant.browser_id === message.browser_id && hashAction(variant) === hashAction(message))) return;
    // Retain the original encrypted record. A permanent sequence collision is
    // neither a delivery receipt nor permission to overwrite the server event.
    record.rejected_uploads ??= {};
    record.rejected_uploads[message.browser_id] = hashAction(message);
    await this.persist();
  }

  async acknowledgeVariants(ackSeq, messages) {
    // Global ACK only proves that some recipient saw a sequence. Retire each
    // encrypted copy only after this exact successful push, preserving siblings.
    for (const message of messages) {
      const record = this.pending.get(message.event_seq);
      if (record?.type !== "opaque.event.bundle") {
        this.pending.delete(message.event_seq);
        continue;
      }
      record.variants = record.variants.filter(variant =>
        variant.browser_id !== message.browser_id || variant.event_id !== message.event_id);
      if (!record.variants.length) this.pending.delete(message.event_seq);
    }
    this.lastAcked = Math.max(this.lastAcked, ackSeq);
    await this.persist();
  }

  async retainAuthorizedRecipients(authorizations) {
    // Only a complete authoritative authorization list proves revocation.
    // Never infer it from local key availability or last-seen timestamps.
    if (!Array.isArray(authorizations) || authorizations.some(value => typeof value?.id !== "string")) return;
    const authorized = new Set(authorizations.map(value => value.id));
    let changed = false;
    for (const [sequence, record] of this.pending) {
      if (record.type !== "opaque.event.bundle") continue;
      const remaining = record.variants.filter(variant => authorized.has(variant.browser_id));
      if (remaining.length === record.variants.length) continue;
      changed = true;
      record.variants = remaining;
      if (!remaining.length) this.pending.delete(sequence);
    }
    if (changed) await this.persist();
  }

  async pruneExpired(now = Date.now()) {
    let changed = false;
    for (const [sequence, record] of this.pending) {
      if (record.type !== "opaque.event.bundle") continue;
      const retained = record.variants.filter(variant => !transportPayloadExpired(variant, now));
      if (retained.length === record.variants.length) continue;
      record.variants = retained;
      if (!retained.length) this.pending.delete(sequence);
      changed = true;
    }
    for (const [id, receipt] of Object.entries(this.transportRequests)) {
      if (receipt.expires <= now) {
        delete this.transportRequests[id];
        changed = true;
      } else if (receipt.frames?.some(frame => transportPayloadExpired(frame, now))) {
        receipt.frames = receipt.frames.filter(frame => !transportPayloadExpired(frame, now));
        receipt.bytes = receipt.frames.reduce((sum, frame) => sum + Buffer.byteLength(JSON.stringify(frame)), 0);
        changed = true;
      }
    }
    // Keep mutation receipts until command expiry, even after response removal.
    // Expiry is not an ACK and must never discard another recipient's fresh copy.
    if (changed) await this.persist();
  }

  after(ackSeq) {
    return [...this.pending.values()]
      .filter((event) => event.type === "opaque.event.bundle" || event.event_seq > ackSeq)
      .sort((left, right) => left.event_seq - right.event_seq);
  }

  hasProcessedRequest(requestId) {
    return this.processedRequests.has(requestId);
  }

  async markProcessedRequest(requestId) {
    this.processedRequests.add(requestId);
    while (this.processedRequests.size > 1_000) {
      this.processedRequests.delete(this.processedRequests.values().next().value);
    }
    await this.persist();
  }

  async persist() {
    if (!this.path) return;
    this.writeRevision++;
    if (!this.writeChain) {
      // Capture at write time, not once per caller. A slow disk retains one
      // snapshot instead of a queue of copies of the entire encrypted outbox.
      this.writeChain = Promise.resolve().then(async () => {
        let written;
        do {
          written = this.writeRevision;
          await this.writeSnapshot();
        } while (written !== this.writeRevision);
      }).finally(() => { this.writeChain = null; });
    }
    await this.writeChain;
  }

  async writeSnapshot() {
    const serialized = JSON.stringify({
      nextSeq: this.nextSeq,
      lastAcked: this.lastAcked,
      pending: [...this.pending.values()],
      processedRequests: [...this.processedRequests],
      transportRequests: this.transportRequests,
      projectOperations: this.projectOperations,
      codexQueueReceipts: this.codexQueueReceipts,
      codexMessageReceipts: this.codexMessageReceipts,
    });
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.path);
  }

  async flush() {
    await this.appendChain;
    await this.writeChain;
  }

  async saveCodexQueueReceipt(receipt) {
    const { sessionId, clientMessageId, requestId, createdAt, queuedSubmissionId } = receipt;
    this.codexQueueReceipts[JSON.stringify([sessionId, clientMessageId])] = {
      sessionId, clientMessageId, requestId, createdAt, queuedSubmissionId,
    };
    await this.persist();
  }

  async removeCodexQueueReceipt({ sessionId, clientMessageId }) {
    delete this.codexQueueReceipts[JSON.stringify([sessionId, clientMessageId])];
    await this.persist();
  }

  async saveCodexMessageReceipt(value) {
    const receipt = submissionReceipt(value);
    if (!receipt) throw new Error('Invalid Codex submission receipt.');
    this.codexMessageReceipts[JSON.stringify([receipt.sessionId, receipt.clientMessageId])] = receipt;
    await this.persist();
  }

  async removeCodexMessageReceipt({ sessionId, clientMessageId }) {
    delete this.codexMessageReceipts[JSON.stringify([sessionId, clientMessageId])];
    await this.persist();
  }
}
