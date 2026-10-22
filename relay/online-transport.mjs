import WebSocket from 'ws';

export const ONLINE_MAX_FRAME_BYTES = 1024 * 1024;
export const ONLINE_EVENT_LIMIT = 64;
export const ONLINE_EVENT_BYTES = 256 * 1024;
export const ONLINE_TOTAL_EVENT_BYTES = 16 * 1024 * 1024;
const LEASE_MS = 30_000;
const PROGRESS_MS = 10_000;

// This state is deliberately reconstructible. Authorization remains in the
// existing control channel; subscription liveness never requires a DB write.
export class OnlineRelayTransport {
  constructor({serverUrl, deviceId, token, authorized, receive, changed = () => {}, paused = () => {},
    now = Date.now, reservedBytes = () => 0, WebSocketClass = WebSocket}) {
    Object.assign(this, {serverUrl, deviceId, token, authorized, receive, changed, paused, now, reservedBytes, WebSocketClass});
    this.peers = new Map();
    this.expiresAt = 0;
    this.closed = false;
    this.pending = new Map();
    this.pendingBytes = 0;
  }

  start() {
    if (this.closed || this.socket) return;
    const url = new URL('/api/stream', this.serverUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new this.WebSocketClass(url, {maxPayload: ONLINE_MAX_FRAME_BYTES});
    this.socket = socket;
    socket.on('open', () => this.sendWire({type: 'hello', role: 'relay', device_id: this.deviceId, relay_token: this.token}));
    socket.on('message', raw => {
      if (this.socket !== socket || Buffer.byteLength(raw) > ONLINE_MAX_FRAME_BYTES) return;
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      void this.handle(message).catch(() => {});
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.expire();
      if (!this.closed) {
        this.retry = setTimeout(() => this.start(), 2_000 + Math.random() * 1_000);
        this.retry.unref?.();
      }
    });
    this.tick ??= setInterval(() => this.sweep(), 1_000);
    this.tick.unref?.();
  }

  async handle(message) {
    if (message.type === 'ready') {
      this.lastRenew = this.now();
      return;
    }
    if (message.type === 'subscriptions') {
      if (!Array.isArray(message.peers) || !Number.isFinite(message.expires_at)) return;
      const next = new Map();
      for (const value of message.peers.slice(0, 256)) {
        if (typeof value.browser_id !== 'string' || typeof value.connection_id !== 'string' ||
            !['stream', 'legacy'].includes(value.transport)) continue;
        const old = this.peers.get(value.browser_id);
        const peer = old?.connectionId === value.connection_id && old.transport === value.transport ? old : {
          browserId: value.browser_id, connectionId: value.connection_id, transport: value.transport,
          paused: value.transport === 'stream', count: 0, bytes: 0, lastProgress: this.now(),
        };
        next.set(value.browser_id, peer);
      }
      const changed = next.size !== this.peers.size || [...next].some(([id, peer]) => this.peers.get(id) !== peer);
      this.peers = next;
      this.expiresAt = Math.min(message.expires_at, this.now() + LEASE_MS);
      if (changed) this.changed();
      return;
    }
    if (message.type === 'peer' && message.state === 'offline' || message.type === 'unavailable') {
      const peer = this.peers.get(message.browser_id);
      if (peer?.connectionId === message.connection_id) {
        this.peers.delete(peer.browserId);
        this.changed();
      }
      return;
    }
    if (message.type === 'frame') {
      const peer = this.peers.get(message.browser_id);
      if (peer?.connectionId === message.connection_id && peer.transport === 'stream' && this.valid(peer)) {
        await this.receive(peer, message.frame);
      }
    }
  }

  valid(peer) {
    return !this.closed && this.now() < this.expiresAt && this.peers.get(peer.browserId) === peer &&
      this.authorized(peer.browserId);
  }

  peer(browserId) {
    const peer = this.peers.get(browserId);
    return peer && this.valid(peer) ? peer : null;
  }

  canGenerate(peer) {
    if (!this.valid(peer) || peer.paused) return false;
    if (peer.count >= ONLINE_EVENT_LIMIT || peer.bytes >= ONLINE_EVENT_BYTES || this.pendingBytes + this.reservedBytes() >= ONLINE_TOTAL_EVENT_BYTES) {
      this.pause(peer);
      return false;
    }
    return true;
  }

  hold(peer, frame) {
    if (!this.canGenerate(peer)) return false;
    const bytes = Buffer.byteLength(JSON.stringify(frame));
    if (peer.bytes + bytes > ONLINE_EVENT_BYTES || this.pendingBytes + bytes + this.reservedBytes() > ONLINE_TOTAL_EVENT_BYTES) {
      this.pause(peer);
      return false;
    }
    peer.count++;
    peer.bytes += bytes;
    if (peer.count === 1) peer.lastProgress = this.now();
    this.pendingBytes += bytes;
    this.pending.set(frame.event_id, {peer, frame, bytes});
    return true;
  }

  release(eventId) {
    const entry = this.pending.get(eventId);
    if (!entry) return null;
    this.pending.delete(eventId);
    entry.peer.count--;
    entry.peer.bytes -= entry.bytes;
    this.pendingBytes -= entry.bytes;
    entry.peer.lastProgress = this.now();
    return entry;
  }

  pause(peer) {
    if (peer.paused) return;
    peer.paused = true;
    peer.resyncNeeded = true;
    this.notifyPause(peer);
  }

  notifyPause(peer) {
    if (peer.pauseTask || peer.resyncNotified || !this.valid(peer)) return;
    peer.pauseTask = Promise.resolve(this.paused(peer))
      .then(sent => { peer.resyncNotified = sent !== false; })
      .catch(() => {})
      .finally(() => { peer.pauseTask = null; });
  }

  sendWire(message) {
    if (this.socket?.readyState !== 1 || this.socket.bufferedAmount > ONLINE_EVENT_BYTES) return false;
    const wire = JSON.stringify(message);
    if (Buffer.byteLength(wire) > ONLINE_MAX_FRAME_BYTES) return false;
    this.socket.send(wire);
    return true;
  }

  send(peer, frame) {
    if (!this.valid(peer) || peer.transport !== 'stream') return false;
    // The durable marker belongs to the local outbox, never the network frame.
    const wireFrame = {...frame};
    delete wireFrame.online_only;
    delete wireFrame.notification_only;
    return this.sendWire({type: 'frame', browser_id: peer.browserId, connection_id: peer.connectionId, frame: wireFrame});
  }

  sweep() {
    const now = this.now();
    if (now - (this.lastRenew ?? 0) >= 10_000) {
      this.sendWire({type: 'renew'});
      this.lastRenew = now;
    }
    if (now >= this.expiresAt && this.peers.size) this.expire();
    for (const peer of this.peers.values()) {
      if (peer.count && now - peer.lastProgress >= PROGRESS_MS) this.pause(peer);
      if (peer.resyncNeeded) this.notifyPause(peer);
      if (!this.authorized(peer.browserId)) this.peers.delete(peer.browserId);
    }
  }

  expire() {
    this.expiresAt = 0;
    this.peers.clear();
    this.changed();
  }

  close() {
    this.closed = true;
    clearInterval(this.tick);
    clearTimeout(this.retry);
    this.socket?.terminate();
    this.socket = null;
    this.expire();
    this.pending.clear();
    this.pendingBytes = 0;
  }
}
