/** A bounded, connection-scoped encrypted transport. It never persists payloads. */
export type StreamFrame = Record<string, unknown>;
export const ONLINE_READ_TYPES = new Set([
  "session.read_history", "session.read_attachment", "session.read_agents",
  "project.locations", "project.check", "project.sessions", "project.browse",
]);
const MAX_BYTES = 1024 * 1024;
class OnlineRequestNotSentError extends Error {}

/** Retrieve one read's original result over either delivery path, without resubmitting it. */
export async function readOnlineOrHttp<T>(options: {
  online: (signal: AbortSignal) => Promise<T>;
  http: (signal: AbortSignal, remainingMs: number) => Promise<T>;
  assertActive: () => void;
  isPending: (error: unknown) => boolean;
  isFatal: (error: unknown) => boolean;
  timeoutMs?: number;
  hedgeMs?: number;
}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  let httpStarted = false;
  let startHttp: () => void;
  let rejectHttp: (error: unknown) => void;
  const http = new Promise<T>((resolve, reject) => {
    rejectHttp = reject;
    startHttp = () => {
      if (httpStarted || controller.signal.aborted) return;
      httpStarted = true;
      if (hedgeTimer) clearTimeout(hedgeTimer);
      try {
        options.assertActive();
        const read = async () => {
          while (!controller.signal.aborted) {
            options.assertActive();
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) throw new Error("online_stream_timeout");
            try { return await options.http(controller.signal, remainingMs); }
            catch (error) {
              if (options.isFatal(error)) { rejectCancelled(error); throw error; }
              if (!options.isPending(error)) throw error;
            }
            // Older servers return pending immediately instead of holding the GET.
            await new Promise<void>((resume, fail) => {
              const onAbort = () => { clearTimeout(timer); fail(new Error("request_cancelled")); };
              const timer = setTimeout(() => { controller.signal.removeEventListener("abort", onAbort); resume(); }, Math.min(250, deadline - Date.now()));
              controller.signal.addEventListener("abort", onAbort, { once: true });
            });
          }
          throw new Error("request_cancelled");
        };
        read().then(resolve, reject);
      } catch (error) { reject(error); }
    };
  });
  let rejectCancelled: (error: unknown) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const deadlineTimer = setTimeout(() => rejectCancelled(new Error("online_stream_timeout")), timeoutMs);
  const scopeTimer = setInterval(() => {
    try { options.assertActive(); } catch (error) { rejectCancelled(error); }
  }, 100);
  const online = Promise.resolve().then(() => {
    options.assertActive();
    return options.online(controller.signal);
  }).catch(error => {
    if (error instanceof OnlineRequestNotSentError) rejectHttp(error);
    else startHttp();
    throw error;
  });
  const hedgeTimer = setTimeout(() => startHttp(), options.hedgeMs ?? 500);
  try {
    const value = await Promise.race([Promise.any([online, http]), cancelled]);
    options.assertActive();
    if (Date.now() >= deadline) throw new Error("online_stream_timeout");
    return value;
  } finally {
    controller.abort();
    if (hedgeTimer) clearTimeout(hedgeTimer);
    clearTimeout(deadlineTimer);
    clearInterval(scopeTimer);
  }
}

export class OnlineStream {
  connectionId = "";
  browserId = "";
  relayOnline = false;
  closeCode: number | null = null;
  private socket: WebSocket | null = null;
  private handshake: ReturnType<typeof setTimeout> | null = null;
  private renewal: ReturnType<typeof setInterval> | null = null;
  private lastRenewed = 0;
  private queuedBytes = 0;
  private receiving = Promise.resolve();
  private pending = new Map<string, { resolve: (frame: StreamFrame) => void; reject: (error: Error) => void; cleanup: () => void }>();
  constructor(private options: {
    origin: string; deviceId: string; browserToken: string; browserId?: string;
    onFrame: (frame: StreamFrame) => Promise<void>;
    onOnline: () => void; onClosed: () => void; onPresence?: (online: boolean) => void;
    socketFactory?: (url: string) => WebSocket;
    now?: () => number;
  }) {}
  get available() { return Boolean(this.connectionId && this.relayOnline && this.socket?.readyState === 1); }
  connect() {
    const url = new URL("/api/stream", this.options.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = this.options.socketFactory?.(url.href) ?? new WebSocket(url);
    this.socket = socket;
    this.handshake = setTimeout(() => { if (this.socket === socket && !this.connectionId) this.close(); }, 10_000);
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      socket.send(JSON.stringify({ type: "hello", role: "browser", device_id: this.options.deviceId, browser_token: this.options.browserToken }));
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket || typeof event.data !== "string") return;
      const bytes = new TextEncoder().encode(event.data).length;
      if (bytes > MAX_BYTES || this.queuedBytes + bytes > MAX_BYTES * 2) { this.close(); return; }
      let value: StreamFrame;
      try { value = JSON.parse(event.data); } catch { this.close(); return; }
      if (value.type === "ready") {
        if (this.connectionId || typeof value.connection_id !== "string" || typeof value.browser_id !== "string" || (this.options.browserId && value.browser_id !== this.options.browserId)) { this.close(); return; }
        if (this.handshake) clearTimeout(this.handshake); this.handshake = null;
        this.connectionId = value.connection_id; this.browserId = value.browser_id as string;
        this.lastRenewed = this.options.now?.() ?? Date.now();
        this.renewal = setInterval(() => this.renew(), 10_000);
      } else if (value.type === "relay") {
        this.relayOnline = value.state === "online";
        this.options.onPresence?.(this.relayOnline);
        if (this.available) this.options.onOnline();
        else this.rejectPending();
      } else if (value.type === "unavailable" && value.connection_id === this.connectionId) {
        const pending = this.pending.get(String(value.request_id));
        if (pending) { pending.cleanup(); this.pending.delete(String(value.request_id)); pending.reject(new Error("online_stream_unavailable")); }
      } else if (value.type === "frame" && value.connection_id === this.connectionId && value.browser_id === this.browserId && this.connectionId && value.frame && typeof value.frame === "object") {
        const frame = value.frame as StreamFrame;
        const pending = this.pending.get(String(frame.request_id));
        if (pending && frame.kind === "response") {
          pending.cleanup(); this.pending.delete(String(frame.request_id)); pending.resolve(frame); return;
        }
        this.queuedBytes += bytes;
        this.receiving = this.receiving.then(async () => {
          if (this.socket === socket) await this.options.onFrame(frame);
        }).catch(() => { this.close(); }).finally(() => { this.queuedBytes -= bytes; });
      }
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.closeCode = event.code;
      this.close();
    });
    socket.addEventListener("error", () => { if (this.socket === socket) this.close(); });
  }
  /** Business renewal must run on the consumer's event loop, never native ping. */
  renew() {
    const now = this.options.now?.() ?? Date.now();
    if (now - this.lastRenewed >= 30_000 || this.socket?.readyState !== 1) { this.close(); return; }
    this.lastRenewed = now;
    this.socket.send(JSON.stringify({ type: "renew" }));
  }
  send(frame: StreamFrame) {
    if (!this.available) throw new Error("online_stream_unavailable");
    const data = JSON.stringify({ type: "frame", browser_id: this.browserId, connection_id: this.connectionId, frame: { kind: "command", ...frame } });
    if (new TextEncoder().encode(data).length > MAX_BYTES || (this.socket?.bufferedAmount ?? 0) > 256 * 1024) throw new Error("online_stream_backpressure");
    this.socket!.send(data);
  }
  request(frame: StreamFrame, timeoutMs = 8_000, signal?: AbortSignal): Promise<StreamFrame> {
    if (signal?.aborted) return Promise.reject(new Error("request_cancelled"));
    if (this.pending.size >= 8 || this.pending.has(String(frame.request_id))) return Promise.reject(new OnlineRequestNotSentError("online_stream_busy"));
    return new Promise((resolve, reject) => {
      const id = String(frame.request_id);
      const fail = (error: Error) => { cleanup(); this.pending.delete(id); reject(error); };
      const onAbort = () => fail(new Error("request_cancelled"));
      const timer = setTimeout(() => fail(new Error("online_stream_timeout")), timeoutMs);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", onAbort, { once: true });
      try { this.send(frame); } catch (error) {
        cleanup(); this.pending.delete(id);
        reject(new OnlineRequestNotSentError(error instanceof Error ? error.message : "online_stream_unavailable"));
      }
    });
  }
  private rejectPending() {
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(new Error("online_stream_closed")); }
    this.pending.clear();
  }
  close() {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null; this.connectionId = ""; this.relayOnline = false;
    if (this.handshake) clearTimeout(this.handshake); this.handshake = null;
    if (this.renewal) clearInterval(this.renewal);
    this.renewal = null; this.rejectPending(); socket.close(1000, "subscription ended"); this.options.onClosed();
  }
}
