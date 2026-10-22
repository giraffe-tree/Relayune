import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

export const STREAM_MAX_FRAME_BYTES = 1024 * 1024;
const LEASE_MS = 30_000;
const AUTH_REFRESH_MS = 30_000;
const AUTH_MAX_AGE_MS = 45_000;
const MAX_HANDSHAKE_BYTES = 2_048;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,160}$/;
const ROUTING_TYPE = /^[a-z][a-z0-9_.-]{0,79}$/;
const KEY_ID = /^sha256:[A-Za-z0-9_-]{43}$/;
type Json = Record<string, unknown>;
export type CipherStreamAuthorization = { deviceId: string; browserId?: string; keyId?: string };
export type CipherStreamOptions = {
  publicOrigin: string;
  authenticateSession(request: IncomingMessage): Promise<string | null>;
  authorizeRelay(request: IncomingMessage, payload: { deviceId: string; relayToken: string }): Promise<CipherStreamAuthorization>;
  authorizeBrowser(request: IncomingMessage, email: string, payload: { deviceId: string; browserToken: string }): Promise<CipherStreamAuthorization>;
  activeBrowsers?(deviceId: string): string[];
  onBrowserStream?(deviceId: string, browserId: string): void;
  now?: () => number;
  tickIntervalMs?: number;
  maxBufferedBytes?: number;
  maxGlobalBufferedBytes?: number;
  maxConnections?: number;
  networkUsage?: { websocket(direction: string, kind: string, bytes: number): void };
};
type Peer = CipherStreamAuthorization & {
  socket: WebSocket; role: "browser" | "relay"; connectionId: string;
  expiresAt: number; verifiedAt: number; validating: boolean; lastSnapshotAt: number;
  leaseDeadline?: ReturnType<typeof setTimeout>; authDeadline?: ReturnType<typeof setTimeout>;
  revalidate(): Promise<boolean>;
};

/** In-memory ciphertext router. No payload queues, persistence or per-frame authorization queries. */
export class CipherStreamHub {
  private readonly peers = new Set<Peer>();
  private readonly relays = new Map<string, Peer>();
  private readonly browsers = new Map<string, Map<string, Peer>>();
  private readonly now: () => number;
  private closed = false;
  constructor(private readonly server: WebSocketServer, private readonly options: CipherStreamOptions) {
    this.now = options.now ?? Date.now;
  }

  subscribe(socket: WebSocket, role: Peer["role"], authorization: CipherStreamAuthorization, revalidate: () => Promise<boolean>) {
    if (this.closed || !IDENTIFIER.test(authorization.deviceId) ||
        (role === "browser" && (!IDENTIFIER.test(authorization.browserId ?? "") || !KEY_ID.test(authorization.keyId ?? "")))) {
      socket.close(4401, "authorization rejected"); return;
    }
    if (this.peers.size >= (this.options.maxConnections ?? 2048)) { socket.close(1013, "stream capacity reached"); return; }
    const peer: Peer = { ...authorization, role, socket, revalidate, connectionId: randomUUID(),
      expiresAt: this.now() + LEASE_MS, verifiedAt: this.now(), validating: false, lastSnapshotAt: 0 };
    // Remove the old instance synchronously before registering its replacement.
    const old = role === "relay" ? this.relays.get(peer.deviceId) : this.browsers.get(peer.deviceId)?.get(peer.browserId!);
    if (old) this.drop(old, 4001, "connection replaced");
    this.peers.add(peer);
    this.armLease(peer);
    this.armAuthorization(peer);
    if (role === "relay") this.relays.set(peer.deviceId, peer);
    else {
      const browsers = this.browsers.get(peer.deviceId) ?? new Map<string, Peer>();
      browsers.set(peer.browserId!, peer); this.browsers.set(peer.deviceId, browsers);
    }
    socket.once("close", () => this.remove(peer));
    socket.on("error", () => this.drop(peer, 1011, "stream disconnected"));
    socket.on("message", (data, binary) => {
      const bytes = Array.isArray(data) ? data.reduce((sum, chunk) => sum + chunk.byteLength, 0) : data.byteLength;
      this.options.networkUsage?.websocket("rx", "other", bytes);
      if (binary || bytes > STREAM_MAX_FRAME_BYTES || !this.valid(peer)) { this.drop(peer, 4400, "invalid stream frame"); return; }
      try { this.receive(peer, JSON.parse(data.toString())); }
      catch { this.drop(peer, 4400, "invalid stream frame"); }
    });
    if (role === "browser") {
      this.options.onBrowserStream?.(peer.deviceId, peer.browserId!);
      // Publish the authoritative subscription before ready can cause an early client command.
      this.publishSnapshot(peer.deviceId);
      const relay = this.relays.get(peer.deviceId);
      if (relay) this.send(relay, { type: "peer", browser_id: peer.browserId, connection_id: peer.connectionId, state: "online" });
    }
    this.send(peer, { type: "ready", connection_id: peer.connectionId,
      ...(role === "browser" ? { browser_id: peer.browserId } : {}), max_frame_bytes: STREAM_MAX_FRAME_BYTES });
    if (role === "relay") {
      this.publishSnapshot(peer.deviceId);
      this.broadcastRelayPresence(peer.deviceId);
    } else this.sendRelayPresence(peer);
  }

  legacySubscriptionsChanged(deviceId: string) { this.publishSnapshot(deviceId); }
  activeBrowserIds(deviceId: string): string[] {
    return [...(this.browsers.get(deviceId)?.values() ?? [])].filter(peer => this.valid(peer)).map(peer => peer.browserId!);
  }
  revokeBrowser(deviceId: string, browserId: string) {
    const peer = this.browsers.get(deviceId)?.get(browserId);
    if (peer) this.drop(peer, 4401, "authorization revoked");
    this.publishSnapshot(deviceId);
  }
  revokeDevice(deviceId: string) {
    const relay = this.relays.get(deviceId);
    if (relay) this.drop(relay, 4401, "authorization revoked");
    for (const peer of [...(this.browsers.get(deviceId)?.values() ?? [])]) this.drop(peer, 4401, "authorization revoked");
  }

  tick() {
    const now = this.now();
    for (const peer of [...this.peers]) {
      if (!this.valid(peer)) { this.drop(peer, 4408, "stream lease expired"); continue; }
      if (now - peer.verifiedAt >= AUTH_REFRESH_MS && !peer.validating) {
        peer.validating = true;
        void peer.revalidate().then(ok => {
          // An overdue authorization result must never resurrect an expired connection.
          if (!this.valid(peer) || !ok) this.drop(peer, 4401, "authorization rejected");
          else { peer.verifiedAt = this.now(); this.armAuthorization(peer); }
        }, () => this.drop(peer, 4401, "authorization rejected")).finally(() => { peer.validating = false; });
      }
      if (peer.role === "relay" && now - peer.lastSnapshotAt >= 10_000) this.publishSnapshot(peer.deviceId);
    }
  }

  close() {
    this.closed = true;
    for (const peer of [...this.peers]) this.drop(peer, 1001, "server shutdown");
    // Also close unauthenticated handshakes, which are not in peers yet.
    for (const socket of this.server.clients) socket.terminate();
    this.server.close();
  }

  private valid(peer: Peer) {
    return !this.closed && this.peers.has(peer) && peer.socket.readyState === WebSocket.OPEN &&
      this.now() < peer.expiresAt && this.now() - peer.verifiedAt < AUTH_MAX_AGE_MS;
  }
  private receive(peer: Peer, value: unknown) {
    const payload = object(value);
    if (payload.type === "renew" && Object.keys(payload).length === 1) {
      peer.expiresAt = this.now() + LEASE_MS; this.armLease(peer); return;
    }
    if (payload.type !== "frame" || Object.keys(payload).sort().join(",") !== "browser_id,connection_id,frame,type" ||
        typeof payload.browser_id !== "string" || typeof payload.connection_id !== "string") throw new Error("invalid_frame");
    const browser = peer.role === "browser" ? peer : this.browsers.get(peer.deviceId)?.get(payload.browser_id);
    if (peer.role === "browser" && (payload.browser_id !== peer.browserId || payload.connection_id !== peer.connectionId)) throw new Error("invalid_route");
    if (!browser || !this.valid(browser) || browser.connectionId !== payload.connection_id) {
      this.send(peer, { type: "unavailable", browser_id: payload.browser_id, connection_id: payload.connection_id }); return;
    }
    const frame = validateCipherStreamFrame(payload.frame, peer.role, browser, this.now());
    const target = peer.role === "browser" ? this.relays.get(peer.deviceId) : browser;
    if (!target || !this.valid(target)) {
      this.send(peer, { type: "unavailable", browser_id: browser.browserId, connection_id: browser.connectionId,
        ...(typeof frame.request_id === "string" ? { request_id: frame.request_id } : {}) }); return;
    }
    if (!this.send(target, { type: "frame", browser_id: browser.browserId, connection_id: browser.connectionId, frame })) {
      this.send(peer, { type: "unavailable", browser_id: browser.browserId, connection_id: browser.connectionId,
        ...(typeof frame.request_id === "string" ? { request_id: frame.request_id } : {}) });
    }
  }
  private send(peer: Peer, payload: Json) {
    if (!this.valid(peer)) return false;
    const wire = JSON.stringify(payload), bytes = Buffer.byteLength(wire);
    // Closing sockets still own their OS/ws buffers until terminated.
    const sockets = new Set([...this.server.clients, ...[...this.peers].map(item => item.socket)]);
    const globalBuffered = [...sockets].reduce((sum, socket) => sum + socket.bufferedAmount, 0);
    if (bytes > STREAM_MAX_FRAME_BYTES || peer.socket.bufferedAmount + bytes > (this.options.maxBufferedBytes ?? 2 * STREAM_MAX_FRAME_BYTES) ||
        globalBuffered + bytes > (this.options.maxGlobalBufferedBytes ?? 32 * STREAM_MAX_FRAME_BYTES)) {
      this.drop(peer, 1013, "stream consumer is too slow"); return false;
    }
    try {
      peer.socket.send(wire, error => { if (error) this.drop(peer, 1011, "stream disconnected"); });
      this.options.networkUsage?.websocket("tx", "other", bytes);
      return true;
    } catch { this.drop(peer, 1011, "stream disconnected"); return false; }
  }
  private publishSnapshot(deviceId: string) {
    const relay = this.relays.get(deviceId);
    if (!relay || !this.valid(relay)) return;
    const peers = [...(this.browsers.get(deviceId)?.values() ?? [])].filter(peer => this.valid(peer))
      .map(peer => ({ browser_id: peer.browserId!, connection_id: peer.connectionId, transport: "stream" }));
    const live = new Set(peers.map(peer => peer.browser_id));
    for (const browserId of this.options.activeBrowsers?.(deviceId) ?? []) {
      if (IDENTIFIER.test(browserId) && !live.has(browserId)) {
        live.add(browserId); peers.push({ browser_id: browserId, connection_id: `legacy:${browserId}`, transport: "legacy" });
      }
    }
    relay.lastSnapshotAt = this.now();
    this.send(relay, { type: "subscriptions", peers, expires_at: this.now() + LEASE_MS });
  }
  private sendRelayPresence(peer: Peer) {
    const relay = this.relays.get(peer.deviceId);
    this.send(peer, { type: "relay", state: relay && this.valid(relay) ? "online" : "offline" });
  }
  private broadcastRelayPresence(deviceId: string) {
    for (const browser of this.browsers.get(deviceId)?.values() ?? []) this.sendRelayPresence(browser);
  }
  private remove(peer: Peer) {
    if (!this.peers.delete(peer)) return;
    clearTimeout(peer.leaseDeadline); clearTimeout(peer.authDeadline);
    if (peer.role === "relay") {
      if (this.relays.get(peer.deviceId) === peer) this.relays.delete(peer.deviceId);
      this.broadcastRelayPresence(peer.deviceId);
    } else {
      const browsers = this.browsers.get(peer.deviceId);
      if (browsers?.get(peer.browserId!) === peer) browsers.delete(peer.browserId!);
      if (!browsers?.size) this.browsers.delete(peer.deviceId);
      const relay = this.relays.get(peer.deviceId);
      if (relay) this.send(relay, { type: "peer", browser_id: peer.browserId, connection_id: peer.connectionId, state: "offline" });
      this.publishSnapshot(peer.deviceId);
    }
  }
  private armLease(peer: Peer) {
    clearTimeout(peer.leaseDeadline);
    peer.leaseDeadline = setTimeout(() => this.drop(peer, 4408, "stream lease expired"), LEASE_MS);
    peer.leaseDeadline.unref();
  }
  private armAuthorization(peer: Peer) {
    clearTimeout(peer.authDeadline);
    peer.authDeadline = setTimeout(() => this.drop(peer, 4401, "authorization snapshot expired"), AUTH_MAX_AGE_MS);
    peer.authDeadline.unref();
  }
  private drop(peer: Peer, code: number, reason: string) {
    this.remove(peer);
    // terminate after the close frame so a nonresponsive peer cannot retain buffers indefinitely.
    peer.socket.close(code, reason);
    const timer = setTimeout(() => peer.socket.terminate(), 1_000); timer.unref();
    peer.socket.once("close", () => clearTimeout(timer));
  }
}

function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_object");
  return value as Json;
}
function base64(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value); }
function optionalId(value: unknown) { return value == null || (typeof value === "string" && IDENTIFIER.test(value)); }

/** Validate authenticated routing without decrypting. Drop transport-irrelevant push metadata. */
export function validateCipherStreamFrame(value: unknown, role: Peer["role"], authorization: CipherStreamAuthorization, now = Date.now()): Json {
  const frame = object(value), envelope = object(frame.envelope), aad = object(frame.aad);
  if (Object.keys(envelope).sort().join(",") !== "aad,alg,ciphertext,iv,kid,v" || envelope.v !== 2 || envelope.alg !== "A256GCM" ||
      envelope.kid !== authorization.keyId || !KEY_ID.test(String(envelope.kid)) ||
      !base64(envelope.iv) || Buffer.from(envelope.iv, "base64url").length !== 12 ||
      !base64(envelope.ciphertext) || Buffer.from(envelope.ciphertext, "base64url").length < 16 || !base64(envelope.aad)) throw new Error("invalid_envelope");
  const signed = object(JSON.parse(Buffer.from(envelope.aad, "base64url").toString("utf8")));
  if (Object.keys(aad).sort().join(",") !== "created_at,device_id,direction,event_seq,expires_at,request_id,session_id,type" ||
      Object.keys(signed).length !== Object.keys(aad).length || Object.entries(aad).some(([key, value]) => signed[key] !== value)) throw new Error("invalid_aad");
  const created = typeof aad.created_at === "string" ? Date.parse(aad.created_at) : NaN;
  const expires = typeof aad.expires_at === "string" ? Date.parse(aad.expires_at) : NaN;
  const kind = role === "browser" ? "command" : frame.kind;
  const allowed = new Set(["kind", "device_id", "browser_id", "session_id", "request_id", "aad", "envelope",
    ...(kind === "command" ? ["command_type", "created_at", "expires_at"] : []),
    ...(kind === "event" ? ["event_id", "event_seq", "created_at", "agent_id", "ios_push", "notification_hint"] : []),
    ...(kind === "catalog" ? ["session_refs"] : [])]);
  if (Object.keys(frame).some(key => !allowed.has(key))) throw new Error("invalid_frame_fields");
  if (frame.device_id !== authorization.deviceId || aad.device_id !== authorization.deviceId ||
      (frame.browser_id != null && frame.browser_id !== authorization.browserId) ||
      aad.direction !== (role === "browser" ? "web_to_relay" : "relay_to_web") ||
      typeof aad.type !== "string" || !ROUTING_TYPE.test(aad.type) ||
      !optionalId(aad.session_id) || !optionalId(aad.request_id) ||
      aad.session_id !== (frame.session_id ?? null) || aad.request_id !== (frame.request_id ?? null) ||
      !Number.isFinite(created) || created > now + 120_000 ||
      (aad.expires_at !== null && (!Number.isFinite(expires) || expires <= now)) ||
      (frame.created_at != null && frame.created_at !== aad.created_at) ||
      (frame.expires_at != null && frame.expires_at !== aad.expires_at)) throw new Error("invalid_route");
  if (kind === "command") {
    if (role !== "browser" || (frame.kind != null && frame.kind !== "command") || frame.command_type !== aad.type ||
        !IDENTIFIER.test(String(frame.request_id ?? "")) || aad.event_seq !== null ||
        !Number.isFinite(expires) || expires <= created || expires > created + 86_400_000 || expires > now + 86_400_000) throw new Error("invalid_command");
  } else if (kind === "event") {
    if (aad.type !== "session.event" || !Number.isSafeInteger(frame.event_seq) || Number(frame.event_seq) < 1 ||
        aad.event_seq !== frame.event_seq || !IDENTIFIER.test(String(frame.event_id ?? "")) || created <= now - 600_000) throw new Error("invalid_event");
  } else if (kind === "response" || kind === "receipt") {
    if (aad.event_seq !== null || created <= now - 300_000 ||
        (aad.request_id === null && !(kind === "response" && aad.type === "transport.resync_required")) ||
        (kind === "receipt" && aad.type !== "command.ack")) throw new Error("invalid_response");
  } else if (kind === "catalog") {
    if (aad.type !== "relay.sync_sessions" || aad.session_id !== null || aad.request_id !== null || aad.event_seq !== null) throw new Error("invalid_catalog");
  } else throw new Error("invalid_kind");
  const normalized: Json = { device_id: frame.device_id, browser_id: authorization.browserId,
    session_id: aad.session_id, request_id: aad.request_id, aad, envelope };
  if (role === "relay") normalized.kind = kind;
  if (kind === "command") normalized.command_type = frame.command_type;
  if (kind === "event") Object.assign(normalized, { event_id: frame.event_id, event_seq: frame.event_seq, created_at: aad.created_at });
  if (kind === "command") Object.assign(normalized, { created_at: aad.created_at, expires_at: aad.expires_at });
  return normalized;
}

export function attachCipherStreamServer(httpServer: Server, options: CipherStreamOptions) {
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: STREAM_MAX_FRAME_BYTES, perMessageDeflate: false });
  const hub = new CipherStreamHub(webSocketServer, options);
  const timer = setInterval(() => hub.tick(), options.tickIntervalMs ?? 1000); timer.unref();
  const upgrade = (request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    let url: URL;
    try { url = new URL(request.url ?? "/", options.publicOrigin); } catch { socket.destroy(); return; }
    if (url.pathname !== "/api/stream") return;
    if (url.search || (request.headers.origin !== undefined && request.headers.origin !== options.publicOrigin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); return;
    }
    if (webSocketServer.clients.size >= (options.maxConnections ?? 2048)) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); return;
    }
    webSocketServer.handleUpgrade(request, socket, head, ws => {
      let authenticating = false;
      const timeout = setTimeout(() => { ws.close(4408, "hello timeout"); ws.terminate(); }, 5000); timeout.unref();
      ws.once("close", () => clearTimeout(timeout));
      ws.on("error", () => { clearTimeout(timeout); ws.terminate(); });
      const onMessage = (data: import("ws").RawData, binary: boolean) => {
        if (authenticating) { ws.close(4400, "hello pending"); return; }
        authenticating = true;
        void (async () => {
          try {
            const bytes = Array.isArray(data) ? data.reduce((sum, chunk) => sum + chunk.byteLength, 0) : data.byteLength;
            if (binary || bytes > MAX_HANDSHAKE_BYTES) throw new Error("invalid_hello");
            const hello = object(JSON.parse(data.toString()));
            const role = hello.role;
            if (hello.type !== "hello" || (role !== "browser" && role !== "relay") ||
                typeof hello.device_id !== "string" || !IDENTIFIER.test(hello.device_id) ||
                Object.keys(hello).sort().join(",") !== (role === "browser" ? "browser_token,device_id,role,type" : "device_id,relay_token,role,type")) throw new Error("invalid_hello");
            const token = role === "browser" ? hello.browser_token : hello.relay_token;
            if (typeof token !== "string" || !token.length || token.length > 1024) throw new Error("invalid_hello");
            const deviceId = hello.device_id;
            const authenticate = async () => {
              if (role === "relay") return options.authorizeRelay(request, { deviceId, relayToken: token });
              if (request.headers.origin !== options.publicOrigin) throw new Error("invalid_origin");
              const email = await options.authenticateSession(request);
              if (!email) throw new Error("invalid_session");
              return options.authorizeBrowser(request, email, { deviceId, browserToken: token });
            };
            const authorization = await authenticate();
            if (authorization.deviceId !== deviceId || ws.readyState !== WebSocket.OPEN) return;
            const revalidate = async () => {
              const current = await authenticate();
              return current.deviceId === authorization.deviceId && current.browserId === authorization.browserId && current.keyId === authorization.keyId;
            };
            clearTimeout(timeout); ws.off("message", onMessage);
            hub.subscribe(ws, role, authorization, revalidate);
          } catch { ws.close(4401, "authorization rejected"); }
        })();
      };
      ws.on("message", onMessage);
    });
  };
  httpServer.on("upgrade", upgrade);
  const close = hub.close.bind(hub);
  hub.close = () => { clearInterval(timer); httpServer.off("upgrade", upgrade); close(); };
  return hub;
}
