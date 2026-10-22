import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

const DEFAULT_SUBSCRIBE_TIMEOUT_MS = 5_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_SUBSCRIBE_BYTES = 2_048;

export type RealtimeAuthorization = {
  deviceId: string;
  browserId: string;
  lastSeenAt: number | null;
};

type RealtimeSubscriber = RealtimeAuthorization & {
  socket: WebSocket;
  alive: boolean;
  lastPingAt: number | null;
  verifiedAt: number;
  validating: boolean;
  authDeadline?: ReturnType<typeof setTimeout>;
  deliverySuppressed?: boolean;
  revalidate(): Promise<boolean>;
};

type PresenceState = {
  online: boolean;
  lastSeenAt: number | null;
  revision: number;
};

export type RealtimeHubOptions = {
  networkUsage?: { websocket(direction: string, kind: string, bytes: number): void };
  publicOrigin: string;
  onlineWindowMs: number;
  authenticateSession(request: IncomingMessage): Promise<string | null>;
  authorize(
    request: IncomingMessage,
    email: string,
    payload: { deviceId: string; browserToken: string },
  ): Promise<RealtimeAuthorization>;
  heartbeatIntervalMs?: number;
  subscribeTimeoutMs?: number;
  maxBufferedBytes?: number;
  now?: () => number;
};

export class RealtimeHub {
  private readonly subscriptionListeners = new Set<(deviceId: string) => void>();
  private readonly subscribers = new Map<string, Set<RealtimeSubscriber>>();
  private readonly presence = new Map<string, PresenceState>();
  private readonly offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly invalidations = new Map<string, { scopes: Set<string>; timer: ReturnType<typeof setTimeout> }>();
  private readonly now: () => number;
  private readonly maxBufferedBytes: number;

  constructor(
    private readonly server: WebSocketServer,
    private readonly options: RealtimeHubOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.maxBufferedBytes =
      options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  }

  subscribe(
    socket: WebSocket,
    authorization: RealtimeAuthorization,
    revalidate: () => Promise<boolean>,
  ) {
    const subscriber: RealtimeSubscriber = {
      ...authorization,
      socket,
      alive: true,
      lastPingAt: null,
      verifiedAt: this.now(),
      validating: false,
      revalidate,
    };
    const deviceSubscribers = this.subscribers.get(authorization.deviceId) ?? new Set();
    deviceSubscribers.add(subscriber);
    this.subscribers.set(authorization.deviceId, deviceSubscribers);
    this.notifySubscriptions(authorization.deviceId);
    this.armAuthorizationDeadline(subscriber);
    socket.on("pong", () => {
      subscriber.alive = true;
      if (subscriber.lastPingAt === null) return;
      const receivedAt = this.now();
      const roundTripMs = Math.max(0, receivedAt - subscriber.lastPingAt);
      subscriber.lastPingAt = null;
      this.send(subscriber, {
        type: "heartbeat",
        device_id: authorization.deviceId,
        round_trip_ms: roundTripMs,
        server_time: new Date(receivedAt).toISOString(),
      });
    });
    socket.once("close", () => {
      clearTimeout(subscriber.authDeadline);
      deviceSubscribers.delete(subscriber);
      if (!deviceSubscribers.size) this.subscribers.delete(authorization.deviceId);
      this.notifySubscriptions(authorization.deviceId);
    });

    const lastSeenAt = authorization.lastSeenAt;
    const online =
      lastSeenAt !== null && lastSeenAt > this.now() - this.options.onlineWindowMs;
    const revision = online
      ? lastSeenAt!
      : Math.max(lastSeenAt === null ? 0 : lastSeenAt + this.options.onlineWindowMs, this.now());
    this.presence.set(authorization.deviceId, { online, lastSeenAt, revision });
    this.send(subscriber, {
      type: "ready",
      device_id: authorization.deviceId,
      server_time: new Date(this.now()).toISOString(),
    });
    this.sendPresence(subscriber, authorization.deviceId, {
      online,
      lastSeenAt,
      revision,
    });
    if (online) this.scheduleOffline(authorization.deviceId, lastSeenAt!);
  }

  activeBrowsers(deviceId: string): string[] {
    return [...new Set([...(this.subscribers.get(deviceId) ?? [])]
      .filter(subscriber => subscriber.socket.readyState === WebSocket.OPEN)
      .filter(subscriber => !subscriber.deliverySuppressed)
      .filter(subscriber => this.now() - subscriber.verifiedAt < 45_000)
      .map(subscriber => subscriber.browserId))];
  }

  suppressDelivery(deviceId: string, browserId: string) {
    // Only this connection is suppressed. A deliberate fresh legacy connection
    // can opt back in; stream failure alone never reactivates its old socket.
    for (const subscriber of this.subscribers.get(deviceId) ?? []) {
      if (subscriber.browserId === browserId) subscriber.deliverySuppressed = true;
    }
  }

  onSubscriptionsChanged(listener: (deviceId: string) => void): () => void {
    this.subscriptionListeners.add(listener);
    return () => { this.subscriptionListeners.delete(listener); };
  }

  private notifySubscriptions(deviceId: string) {
    for (const listener of this.subscriptionListeners) listener(deviceId);
  }

  private armAuthorizationDeadline(subscriber: RealtimeSubscriber) {
    clearTimeout(subscriber.authDeadline);
    subscriber.authDeadline = setTimeout(() => {
      subscriber.socket.close(4401, "authorization snapshot expired");
      this.notifySubscriptions(subscriber.deviceId);
    }, 45_000);
    subscriber.authDeadline.unref?.();
  }

  observePresence(deviceId: string, lastSeenAt: number) {
    const next: PresenceState = {
      online: true,
      lastSeenAt,
      revision: lastSeenAt,
    };
    this.presence.set(deviceId, next);
    this.scheduleOffline(deviceId, lastSeenAt);
    this.broadcastPresence(deviceId, next);
  }

  invalidate(deviceId: string, scopes: string[]) {
    if (!scopes.length || !this.subscribers.get(deviceId)?.size) return;
    const pending = this.invalidations.get(deviceId);
    if (pending) { for (const scope of scopes) pending.scopes.add(scope); return; }
    const entry = { scopes: new Set(scopes), timer: setTimeout(() => {
      this.invalidations.delete(deviceId);
      this.broadcast(deviceId, {
        type: "invalidate", device_id: deviceId,
        scopes: [...entry.scopes].sort(), server_time: new Date(this.now()).toISOString(),
      });
    }, 40) };
    entry.timer.unref?.();
    this.invalidations.set(deviceId, entry);
  }

  revokeDevice(deviceId: string) {
    const invalidation = this.invalidations.get(deviceId);
    if (invalidation) clearTimeout(invalidation.timer);
    this.invalidations.delete(deviceId);
    this.clearOfflineTimer(deviceId);
    const revision = Math.max(
      this.now(),
      (this.presence.get(deviceId)?.revision ?? 0) + 1,
    );
    const state = { online: false, lastSeenAt: null, revision };
    this.presence.set(deviceId, state);
    this.broadcastPresence(deviceId, state);
    for (const subscriber of this.subscribers.get(deviceId) ?? []) {
      subscriber.socket.close(4401, "device authorization revoked");
    }
    this.notifySubscriptions(deviceId);
  }

  revokeBrowser(deviceId: string, browserId: string) {
    for (const subscriber of this.subscribers.get(deviceId) ?? []) {
      if (subscriber.browserId === browserId) {
        subscriber.socket.close(4401, "browser authorization revoked");
      }
    }
    this.notifySubscriptions(deviceId);
  }

  heartbeat() {
    for (const deviceSubscribers of this.subscribers.values()) {
      for (const subscriber of deviceSubscribers) {
        if (!subscriber.alive) {
          subscriber.socket.terminate();
          continue;
        }
        if (this.now() - subscriber.verifiedAt >= 30_000 && !subscriber.validating) {
          subscriber.validating = true;
          void subscriber.revalidate().then((authorized) => {
            if (!authorized || this.now() - subscriber.verifiedAt >= 45_000) {
              subscriber.socket.close(4401, "browser authorization rejected");
              this.notifySubscriptions(subscriber.deviceId);
            } else if (subscriber.socket.readyState === WebSocket.OPEN) {
              subscriber.verifiedAt = this.now();
              this.armAuthorizationDeadline(subscriber);
            }
          }, () => {
            subscriber.socket.close(4401, "browser authorization rejected");
            this.notifySubscriptions(subscriber.deviceId);
          }).finally(() => { subscriber.validating = false; });
        }
        subscriber.alive = false;
        subscriber.lastPingAt = this.now();
        subscriber.socket.ping();
        this.options.networkUsage?.websocket('tx', 'ping', 0);
      }
    }
  }

  close() {
    for (const entry of this.invalidations.values()) clearTimeout(entry.timer);
    this.invalidations.clear();
    for (const timer of this.offlineTimers.values()) clearTimeout(timer);
    this.offlineTimers.clear();
    for (const deviceSubscribers of this.subscribers.values()) {
      for (const subscriber of deviceSubscribers) {
        clearTimeout(subscriber.authDeadline);
        subscriber.socket.close(1001, "server shutdown");
      }
    }
    this.subscribers.clear();
    this.server.close();
  }

  private scheduleOffline(deviceId: string, observedLastSeenAt: number) {
    this.clearOfflineTimer(deviceId);
    const delay = Math.max(
      1,
      observedLastSeenAt + this.options.onlineWindowMs - this.now() + 1,
    );
    const timer = setTimeout(() => {
      const current = this.presence.get(deviceId);
      if (!current?.online || current.lastSeenAt !== observedLastSeenAt) return;
      const revision = observedLastSeenAt + this.options.onlineWindowMs;
      const offline = {
        online: false,
        lastSeenAt: observedLastSeenAt,
        revision,
      };
      this.presence.set(deviceId, offline);
      this.offlineTimers.delete(deviceId);
      this.broadcastPresence(deviceId, offline);
    }, delay);
    timer.unref?.();
    this.offlineTimers.set(deviceId, timer);
  }

  private clearOfflineTimer(deviceId: string) {
    const timer = this.offlineTimers.get(deviceId);
    if (timer) clearTimeout(timer);
    this.offlineTimers.delete(deviceId);
  }

  private broadcastPresence(deviceId: string, state: PresenceState) {
    for (const subscriber of this.subscribers.get(deviceId) ?? []) {
      this.sendPresence(subscriber, deviceId, state);
    }
  }

  private sendPresence(
    subscriber: RealtimeSubscriber,
    deviceId: string,
    state: PresenceState,
  ) {
    this.send(subscriber, {
      type: "presence",
      device_id: deviceId,
      online: state.online,
      last_seen_at:
        state.lastSeenAt === null ? null : new Date(state.lastSeenAt).toISOString(),
      revision: state.revision,
      server_time: new Date(this.now()).toISOString(),
    });
  }

  private broadcast(deviceId: string, payload: Record<string, unknown>) {
    for (const subscriber of this.subscribers.get(deviceId) ?? []) {
      this.send(subscriber, payload);
    }
  }

  private send(subscriber: RealtimeSubscriber, payload: Record<string, unknown>) {
    if (subscriber.socket.readyState !== WebSocket.OPEN) return;
    if (subscriber.socket.bufferedAmount > this.maxBufferedBytes) {
      subscriber.socket.close(1013, "realtime consumer is too slow");
      return;
    }
    const serialized = JSON.stringify(payload);
    subscriber.socket.send(serialized);
    this.options.networkUsage?.websocket('tx', String(payload.type), Buffer.byteLength(serialized));
  }
}

export function attachRealtimeServer(
  httpServer: Server,
  options: RealtimeHubOptions,
): RealtimeHub {
  const webSocketServer = new WebSocketServer({ noServer: true });
  const hub = new RealtimeHub(webSocketServer, options);
  const heartbeat = setInterval(
    () => hub.heartbeat(),
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
  );
  heartbeat.unref();

  httpServer.on("upgrade", (request, socket, head) => {
    void upgrade(request, socket, head);
  });

  async function upgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) {
    try {
      const url = new URL(request.url ?? "/", options.publicOrigin);
      // A separate authenticated ciphertext stream owns this upgrade path.
      if (url.pathname === "/api/stream") return;
      if (url.pathname !== "/api/realtime" || url.search) {
        rejectUpgrade(socket, 404, "Not Found");
        return;
      }
      if (request.headers.origin !== options.publicOrigin) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      const email = await options.authenticateSession(request);
      if (!email) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        webSocket.on('message', (data) => {
          const bytes = Array.isArray(data) ? data.reduce((sum, chunk) => sum + chunk.byteLength, 0) : data.byteLength;
          // Inbound content is untrusted; no parse or client-supplied type in metrics.
          options.networkUsage?.websocket('rx', 'other', bytes);
        });
        webSocket.on('ping', (data) => {
          options.networkUsage?.websocket('rx', 'ping', data.byteLength);
          options.networkUsage?.websocket('tx', 'pong', data.byteLength); // ws automatic pong
        });
        webSocket.on('pong', (data) => options.networkUsage?.websocket('rx', 'pong', data.byteLength));
        waitForSubscription(webSocket, request, email, hub, options);
      });
    } catch {
      rejectUpgrade(socket, 500, "Internal Server Error");
    }
  }

  const originalClose = hub.close.bind(hub);
  hub.close = () => {
    clearInterval(heartbeat);
    originalClose();
  };
  return hub;
}

function waitForSubscription(
  socket: WebSocket,
  request: IncomingMessage,
  email: string,
  hub: RealtimeHub,
  options: RealtimeHubOptions,
) {
  const timeout = setTimeout(() => {
    socket.close(4408, "subscription timeout");
  }, options.subscribeTimeoutMs ?? DEFAULT_SUBSCRIBE_TIMEOUT_MS);
  timeout.unref?.();

  socket.once("message", (data, isBinary) => {
    clearTimeout(timeout);
    void (async () => {
      try {
        const size = Array.isArray(data)
          ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
          : data.byteLength;
        if (isBinary || size > MAX_SUBSCRIBE_BYTES) {
          socket.close(4400, "invalid subscription");
          return;
        }
        const text = Array.isArray(data)
          ? Buffer.concat(data).toString("utf8")
          : data.toString();
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const fields = Object.keys(parsed).sort();
        if (
          fields.join(",") !== "browser_token,device_id,type" ||
          parsed.type !== "subscribe" ||
          typeof parsed.device_id !== "string" ||
          typeof parsed.browser_token !== "string"
        ) {
          socket.close(4400, "invalid subscription");
          return;
        }
        const authorization = await options.authorize(request, email, {
          deviceId: parsed.device_id,
          browserToken: parsed.browser_token,
        });
        if (socket.readyState !== WebSocket.OPEN) return;
        const revalidate = async () => {
          try {
            const current = await options.authorize(request, email, {
              deviceId: parsed.device_id as string,
              browserToken: parsed.browser_token as string,
            });
            return (
              current.deviceId === authorization.deviceId &&
              current.browserId === authorization.browserId
            );
          } catch {
            return false;
          }
        };
        hub.subscribe(socket, authorization, revalidate);
        socket.on("message", () => socket.close(4400, "client messages are unsupported"));
      } catch {
        socket.close(4401, "browser authorization rejected");
      }
    })();
  });
}

function rejectUpgrade(socket: Duplex, status: number, message: string) {
  if (socket.destroyed) return;
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body,
  );
}
