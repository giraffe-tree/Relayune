import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";

// Pi RPC uses LF framing, not readline's additional Unicode separators.
export class PiRpcDecoder {
  constructor({ maxFrameBytes = 16 * 1024 * 1024 } = {}) {
    this.maxFrameBytes = maxFrameBytes;
    this.decoder = new StringDecoder("utf8");
    this.buffer = "";
  }

  push(chunk) {
    this.buffer += this.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const messages = [];
    let end;
    while ((end = this.buffer.indexOf("\n")) !== -1) {
      const frame = this.buffer.slice(0, end).replace(/\r$/, "");
      this.buffer = this.buffer.slice(end + 1);
      this.checkSize(frame);
      if (!frame.trim()) continue;
      let message;
      try { message = JSON.parse(frame); }
      catch { throw new Error("Pi RPC returned an invalid JSON frame."); }
      if (!message || Array.isArray(message) || typeof message !== "object" || typeof message.type !== "string") {
        throw new Error("Pi RPC returned an invalid message envelope.");
      }
      messages.push(message);
    }
    this.checkSize(this.buffer);
    return messages;
  }

  checkSize(frame) {
    if (Buffer.byteLength(frame, "utf8") > this.maxFrameBytes) {
      throw new Error("Pi RPC frame exceeds the configured limit.");
    }
  }

  end() {
    this.buffer += this.decoder.end();
    if (this.buffer.length) throw new Error("Pi RPC closed with an incomplete frame.");
  }
}

// The owner controls the child process, session identity and user-facing state.
// Command acceptance is deliberately separate from streamed lifecycle events.
export class PiRpcClient {
  constructor({ write, onEvent = () => {}, onFailure = () => {}, timeoutMs = 30_000, maxFrameBytes } = {}) {
    if (typeof write !== "function") throw new TypeError("Pi RPC requires a write function.");
    this.write = write;
    this.onEvent = onEvent;
    this.onFailure = onFailure;
    this.timeoutMs = timeoutMs;
    this.decoder = new PiRpcDecoder({ maxFrameBytes });
    this.pending = new Map();
    this.closed = false;
  }

  request(type, params = {}, { timeoutMs = this.timeoutMs } = {}) {
    if (this.closed) return Promise.reject(new Error("Pi RPC is closed."));
    if (typeof type !== "string" || !type || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new TypeError("Invalid Pi RPC request options."));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // Do not retry: a timeout does not prove that Pi rejected the command.
        reject(new Error(`Pi RPC ${type} response timed out; acceptance is unknown.`));
      }, timeoutMs);
      this.pending.set(id, { type, resolve, reject, timer });
      try {
        const result = this.write(`${JSON.stringify({ ...params, id, type })}\n`);
        Promise.resolve(result).catch(() => this.fail(new Error("Pi RPC write failed.")));
      } catch {
        this.fail(new Error("Pi RPC write failed."));
      }
    });
  }

  receive(chunk) {
    if (this.closed) return;
    try {
      for (const message of this.decoder.push(chunk)) {
        if (this.closed) break;
        if (message.type !== "response") {
          this.onEvent(message);
          continue;
        }
        const pending = this.pending.get(message.id);
        // Late responses after timeout never complete another command.
        if (!pending) continue;
        if (message.command !== pending.type || typeof message.success !== "boolean") {
          throw new Error("Pi RPC response does not match its request.");
        }
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.success) pending.resolve(message);
        // Upstream error strings may contain tool input or local secrets.
        else pending.reject(new Error(`Pi RPC ${pending.type} was rejected.`));
      }
    } catch (error) {
      this.fail(error);
    }
  }

  end() {
    if (this.closed) return;
    try { this.decoder.end(); }
    catch (error) { this.fail(error); return; }
    this.close(new Error("Pi RPC process exited before responding."));
  }

  fail(error) {
    if (this.closed) return;
    this.close(error);
    this.onFailure(error);
  }

  close(error = new Error("Pi RPC is closed.")) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
