import { RTCPeerConnection } from "werift";
import { setTimeout as delay } from "node:timers/promises";

export const DIRECT_READ_TYPES = new Set(["session.read_history", "session.read_attachment"]);
export const DIRECT_COMMAND_TYPES = new Set([...DIRECT_READ_TYPES,
  "session.web_open", "session.web_request",
  "session.submit_message", "approval.resolve", "session.interrupt_turn",
  "session.configure", "session.create", "session.fork", "session.create_agents", "session.read_agents",
  "project.sessions", "project.locations", "project.check", "project.browse", "project.create", "transport.event_ack", "transport.resume", "transport.activate", "transport.ping"]);
export const RTC_LABEL = "relayune-session-v2";
const MAX_WIRE = 44 * 1024 * 1024;
const MAX_QUEUED_FRAMES = 64;
const MAX_QUEUED_BYTES = 64 * 1024 * 1024;
const RESERVED_CONTROL_FRAMES = 8;
const RESERVED_CONTROL_BYTES = 1024 * 1024;

// SDP is exchanged only inside the existing per-client authenticated envelope.
// No TURN: every successful data channel is direct; HTTPS remains the fallback.
export class WebRtcReadHost {
  constructor({ authorized, receive, iceServers = [{ urls: "stun:stun.cloudflare.com:3478" }], onDrop = () => {} }) {
    this.authorized = authorized;
    this.onDrop = onDrop;
    this.receive = receive;
    this.iceServers = iceServers;
    this.peers = new Map();
    this.offerAttempts = [];
    this.closed = false;
    this.sweep = setInterval(() => this.prune(), 1000);
    this.sweep.unref?.();
  }

  valid(peer) {
    return !this.closed && this.peers.get(peer.browserId) === peer &&
      this.authorized(peer.browserId, peer.keyId) && Date.now() - peer.usedAt < 120_000;
  }

  async offer(browser, requestId, sdp, trickle = false) {
    if (this.closed || !this.authorized(browser.browserId, browser.keyId) ||
        typeof sdp !== "string" || sdp.length > 48_000 ||
        !sdp.includes("m=application ") || /\r?\nm=(audio|video) /.test(sdp)) {
      throw new Error("webrtc_offer_invalid");
    }
    const previous = this.peers.get(browser.browserId);
    if (previous?.requestId === requestId) return previous.answer;
    this.offerAttempts = this.offerAttempts.filter(entry => Date.now() - entry.at < 60_000);
    if (this.offerAttempts.length >= 40 || this.offerAttempts.filter(entry => entry.id === browser.browserId).length >= 6) {
      throw new Error("webrtc_rate_limited");
    }
    this.offerAttempts.push({ id: browser.browserId, at: Date.now() });
    if (!previous && this.peers.size >= 8) throw new Error("webrtc_busy");
    if (previous) this.drop(previous);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { pc, browserId: browser.browserId, keyId: browser.keyId, requestId,
      createdAt: Date.now(), usedAt: Date.now(), channel: null, seen: new Set(), incoming: null,
      eventsState: "server", pending: 0, controlPending: 0, sendChain: Promise.resolve() };
    this.peers.set(peer.browserId, peer);
    peer.candidates = [];
    peer.remoteCandidates = new Set();
    peer.trickle = trickle;
    // werift waits for gathering in setLocalDescription. Start its public
    // transport connector on the first candidate, sharing the same promise
    // with the later setLocalDescription call to avoid duplicate handshakes.
    const connect = pc.connect.bind(pc);
    if (trickle) pc.connect = () => peer.connecting ??= connect();
    pc.onIceCandidate.subscribe(candidate => {
      if (!this.valid(peer)) return;
      if (candidate && peer.candidates.length < 64) peer.candidates.push(candidate.toJSON());
      if (!candidate) peer.gathered = true;
      if (trickle && candidate && pc.localDescription) {
        void pc.connect().catch(() => this.drop(peer));
      }
    });
    pc.connectionStateChange.subscribe(state => {
      if (["closed", "failed", "disconnected"].includes(state) && this.peers.get(peer.browserId) === peer) this.drop(peer);
    });
    pc.onDataChannel.subscribe(channel => {
      if (!this.valid(peer) || peer.channel || channel.label !== RTC_LABEL ||
          !channel.ordered || channel.maxRetransmits != null || channel.maxPacketLifeTime != null) {
        channel.close(); return;
      }
      peer.channel = channel;
      channel.onMessage.subscribe(raw => {
        if (!this.valid(peer) || typeof raw !== "string" || raw.length > 64_000) return;
        let frame;
        try {
          frame = JSON.parse(raw);
          if (frame.type === "chunk") {
            if (!Number.isInteger(frame.total) || frame.total < 1 || frame.total > 3845 ||
                !Number.isInteger(frame.length) || frame.length < 1 || frame.length > MAX_WIRE ||
                frame.total !== Math.ceil(frame.length / 12000) || typeof frame.data !== "string" ||
                frame.data.length > 12000 || !frame.data.length) throw new Error("invalid_chunk");
            const incoming = peer.incoming ??= { id: frame.request_id, total: frame.total, length: frame.length, parts: [], size: 0 };
            if (incoming.id !== frame.request_id || incoming.total !== frame.total || incoming.length !== frame.length ||
                frame.index !== incoming.parts.length) throw new Error("invalid_chunk");
            incoming.parts.push(frame.data); incoming.size += frame.data.length;
            if (incoming.size > incoming.length) throw new Error("invalid_chunk");
            peer.usedAt = Date.now();
            if (incoming.parts.length < incoming.total) return;
            if (incoming.size !== incoming.length) throw new Error("invalid_chunk");
            frame = JSON.parse(incoming.parts.join("")); peer.incoming = null;
            if (frame.request_id !== incoming.id) throw new Error("invalid_chunk");
          }
        } catch { this.drop(peer); return; }
        if (!DIRECT_COMMAND_TYPES.has(frame?.command_type) || typeof frame.request_id !== "string" ||
            !/^[A-Za-z0-9_-]{1,160}$/.test(frame.request_id) || peer.seen.has(frame.request_id)) return;
        const control = frame.command_type.startsWith("transport.");
        if ((control ? peer.controlPending : peer.pending) >= 4) return;
        if (peer.seen.size >= 2048) peer.seen.delete(peer.seen.values().next().value);
        peer.seen.add(frame.request_id);
        peer.usedAt = Date.now();
        if (control) peer.controlPending++; else peer.pending++;
        Promise.resolve(this.receive(peer, frame)).catch(() => this.drop(peer))
          .finally(() => { if (control) peer.controlPending--; else peer.pending--; });
      });
    });
    peer.answer = (async () => {
      let timer;
      try {
        await Promise.race([(async () => {
          await pc.setRemoteDescription({ type: "offer", sdp });
          const answer = await pc.createAnswer();
          if (!trickle) {
            await pc.setLocalDescription(answer);
          } else {
            const setting = pc.setLocalDescription(answer);
            void setting.catch(() => this.drop(peer));
            // Local SDP is assigned before werift awaits candidate gathering.
            while (!pc.localDescription) {
              if (!this.valid(peer)) throw new Error("webrtc_closed");
              await delay(1);
            }
          }
        })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("webrtc_timeout")), 12_000); })]);
        if (!this.valid(peer)) throw new Error("webrtc_closed");
        return pc.localDescription.sdp;
      } catch (error) { this.drop(peer); throw error; }
      finally { clearTimeout(timer); }
    })();
    return peer.answer;
  }

  async exchangeCandidates(browser, connectionId, candidates, cursor) {
    const peer = this.peers.get(browser.browserId);
    if (!peer || !this.valid(peer) || peer.keyId !== browser.keyId ||
        peer.requestId !== connectionId || !peer.trickle ||
        !Array.isArray(candidates) || candidates.length > 64 ||
        !Number.isInteger(cursor) || cursor < 0 || cursor > peer.candidates.length) {
      throw new Error("webrtc_candidates_invalid");
    }
    for (const candidate of candidates) {
      if (!candidate || typeof candidate.candidate !== "string" ||
          candidate.candidate.length > 2048 || !candidate.candidate.startsWith("candidate:") ||
          (candidate.sdpMid != null && (typeof candidate.sdpMid !== "string" || candidate.sdpMid.length > 32)) ||
          (candidate.sdpMLineIndex != null && candidate.sdpMLineIndex !== 0)) {
        throw new Error("webrtc_candidates_invalid");
      }
    }
    for (const candidate of candidates) {
      if (!this.valid(peer)) throw new Error("webrtc_closed");
      if (peer.remoteCandidates.has(candidate.candidate)) continue;
      if (peer.remoteCandidates.size >= 64) throw new Error("webrtc_candidates_invalid");
      peer.remoteCandidates.add(candidate.candidate);
      await peer.pc.addIceCandidate(candidate);
    }
    peer.usedAt = Date.now();
    return { candidates: peer.candidates.slice(cursor), cursor: peer.candidates.length,
      complete: peer.gathered === true };
  }

  send(peer, frame) {
    if (!this.valid(peer)) return Promise.reject(new Error('webrtc_closed'));
    const wire = JSON.stringify(frame);
    peer.sendQueue ??= [];
    const bulk = frame.kind === 'response' && (
      ['session.history', 'session.attachment', 'session.web_result'].includes(frame.aad?.type) || wire.length > 64 * 1024);
    const active = peer.sendActiveEntry;
    const count = peer.sendQueue.length + (active ? 1 : 0);
    const bytes = (peer.sendQueuedBytes ?? 0) + (active?.wire.length ?? 0) + wire.length;
    const bulkCount = peer.sendQueue.filter(entry => entry.bulk).length + (active?.bulk ? 1 : 0);
    // Admission needs the same priority guarantee as dequeueing: otherwise a
    // full image/history queue rejects a stop before the scheduler can help.
    if (wire.length > MAX_WIRE || count >= MAX_QUEUED_FRAMES || bytes > MAX_QUEUED_BYTES ||
        bulk && (bulkCount >= MAX_QUEUED_FRAMES - RESERVED_CONTROL_FRAMES ||
          bytes > MAX_QUEUED_BYTES - RESERVED_CONTROL_BYTES)) {
      return Promise.reject(new Error('webrtc_too_large'));
    }
    const operation = new Promise((resolve, reject) => peer.sendQueue.push({frame, wire, bulk, resolve, reject}));
    peer.sendQueuedBytes = (peer.sendQueuedBytes ?? 0) + wire.length;
    // Choose at frame boundaries: old clients assemble only one contiguous
    // frame at a time. Range reads keep each new attachment frame bounded.
    this.startSendDrain(peer);
    return operation;
  }

  startSendDrain(peer) {
    if (peer.sendRunning || !peer.sendQueue.length) return;
    peer.sendRunning = true;
    peer.sendChain = Promise.resolve().then(() => this.drainSends(peer)).finally(() => {
      peer.sendRunning = false;
      // A completion callback may enqueue between the final frame and finally.
      if (peer.sendQueue.length) this.startSendDrain(peer);
    });
  }

  async drainSends(peer) {
    while (peer.sendQueue.length) {
      const critical = peer.sendQueue.findIndex(entry => !entry.bulk);
      const bulk = peer.sendQueue.findIndex(entry => entry.bulk);
      const index = critical >= 0 && ((peer.sendCriticalCount ?? 0) < 8 || bulk < 0) ? critical : Math.max(0, bulk);
      const entry = peer.sendQueue.splice(index, 1)[0];
      peer.sendQueuedBytes -= entry.wire.length;
      peer.sendActiveEntry = entry;
      peer.sendCriticalCount = entry.bulk ? 0 : (peer.sendCriticalCount ?? 0) + 1;
      try {
        const {frame, wire} = entry;
        const total = Math.ceil(wire.length / 12_000);
        for (let index = 0; index < total; index++) {
          const deadline = Date.now() + 10_000;
          while (peer.channel?.bufferedAmount > 256_000) {
            if (!this.valid(peer) || Date.now() > deadline) throw new Error('webrtc_backpressure');
            await delay(10);
          }
          if (!this.valid(peer) || peer.channel?.readyState !== 'open') throw new Error('webrtc_closed');
          peer.channel.send(JSON.stringify({type: 'chunk', request_id: frame.request_id,
            stream_id: frame.kind === 'event' ? frame.event_id : null,
            index, total, length: wire.length, data: wire.slice(index * 12_000, (index + 1) * 12_000)}));
        }
        peer.usedAt = Date.now(); entry.resolve();
      } catch (error) {
        entry.reject(error);
        for (const pending of peer.sendQueue.splice(0)) pending.reject(error);
        peer.sendQueuedBytes = 0;
        this.drop(peer);
        return;
      } finally {
        if (peer.sendActiveEntry === entry) peer.sendActiveEntry = null;
      }
    }
  }

  prune() { for (const peer of this.peers.values()) if (!this.valid(peer)) this.drop(peer); }
  drop(peer) {
    const error = new Error('webrtc_closed');
    for (const pending of peer.sendQueue?.splice(0) ?? []) pending.reject(error);
    peer.sendQueuedBytes = 0;
    peer.sendActiveEntry?.reject(error);
    if (this.peers.get(peer.browserId) === peer) { this.peers.delete(peer.browserId); this.onDrop(peer); }
    void peer.pc.close().catch(() => {});
  }
  close() { this.closed = true; clearInterval(this.sweep); for (const peer of this.peers.values()) this.drop(peer); }
}

// Packaged-runtime check: exercises bundled DTLS/SCTP without accounts or STUN.
export async function verifyWebRtcRuntime() {
  const a = new RTCPeerConnection({ iceServers: [] });
  const b = new RTCPeerConnection({ iceServers: [] });
  let timer;
  try {
    const channel = a.createDataChannel(RTC_LABEL);
    const received = new Promise(resolve => b.onDataChannel.subscribe(remote => {
      remote.onMessage.subscribe(value => { if (value === 'relayune-self-test') resolve(); });
    }));
    channel.stateChanged.subscribe(state => { if (state === 'open') channel.send('relayune-self-test'); });
    await Promise.race([(async () => {
      await a.setLocalDescription(await a.createOffer());
      await b.setRemoteDescription(a.localDescription);
      await b.setLocalDescription(await b.createAnswer());
      await a.setRemoteDescription(b.localDescription);
      await received;
    })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('webrtc_self_test_failed')), 10000); })]);
  } finally { clearTimeout(timer); await Promise.allSettled([a.close(), b.close()]); }
}
