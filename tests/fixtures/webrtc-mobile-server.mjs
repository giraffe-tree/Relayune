// Loopback-only synthetic fixture. Never reads real accounts, keys, or histories.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { hashAction } from '../../relay/protocol.mjs';
import { MacRelay } from '../../relay/mac-relay.mjs';
import { WebRtcReadHost } from '../../relay/webrtc-transport.mjs';
import { importE2eeKey, keyIdForKey, openJson } from '../../relay/e2ee.mjs';

const key = await importE2eeKey(Buffer.alloc(32, 7).toString('base64url'));
const browser = { browserId: 'web_fixture', key, keyId: await keyIdForKey(key) };
const relay = new MacRelay({ deviceId: 'device', statePath: null, adapter: {} });
relay.ready = true;
relay.activeBrowserKeys.set(browser.browserId, browser);
relay.browserKeys.set(browser.browserId, browser);
relay.directHost = new WebRtcReadHost({ iceServers: [], authorized: () => relay.ready,
  receive: (peer, frame) => {
    if (frame.command_type === 'transport.ping') {
      metrics.probes++;
      if (probeMode === 'blackhole') return;
    }
    return relay.receiveDirectRead(peer, frame);
  }, onDrop: peer => relay.fallbackDirectEvents(peer) });
let probeMode = "ok";
let slowCatchupDone = false;
const responses = new Map();
const events = [];
let cursor = 0;
const metrics = { httpReads: 0, httpResponses: 0, offers: 0, mutations: 0, decisions: 0, httpEvents: 0, probes: 0 };
relay.enqueueRemoteMessages = frames => {
  for (const frame of frames) if (frame.kind === 'event') {
    if (!events.some(item => item.event_id === frame.event_id)) { events.push({...frame, cursor: ++cursor}); metrics.httpEvents++; }
    void relay.outbox.acknowledgeVariants(relay.outbox.lastAcked, [frame]);
  } else if (frame.kind === 'response') {
    responses.set(frame.request_id, frame);
    if (frame.aad.type !== 'transport.answer') metrics.httpResponses++;
  }
};
relay.flushRemoteUploads = async () => {};
const originalControl = relay.sendDirectControl.bind(relay);
relay.sendDirectControl = (peer, browser, command, type, payload) => originalControl(peer, browser, command, type,
  type === 'transport.pong' && probeMode === 'invalid' ? {...payload, nonce: 'invalid'} : payload);
relay.syncSessionCatalog = async () => {};
relay.adapter.submitMessage = async ({content, sessionId}) => {
  metrics.mutations++;
  await relay.emitEvent(sessionId, {kind: 'message.delta', item_id: 'direct_reply', delta: 'native-direct-reply', role: 'assistant'});
  return {turnId: 'fixture_turn'};
};
relay.adapter.resolveApproval = async () => { metrics.decisions++; };
relay.adapter.configureSession = async () => {
  metrics.mutations++;
  for (const peer of relay.directHost.peers.values()) relay.directHost.drop(peer);
  await delay(200);
  return {configOptions: []};
};
relay.readAccessibleHistory = async sessionId => {
  if (sessionId === 'slow') await delay(1500);
  return { messages: [{ id: 'fixture_message', content: 'fixture-payload-'.repeat(20000) }], has_more: false, next_cursor: null };
};
relay.registerHistoryAttachments = (_, messages) => messages;
relay.attachments.set('fixture_image', { sessionId: 'root', type: 'image', name: 'fixture.png', mimeType: 'image/png',
  source: { type: 'stored_bytes', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=', 'base64') } });
const server = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.url.startsWith('/probe-mode?')) { probeMode = new URL(req.url, 'http://localhost').searchParams.get('value'); return res.end('{}'); }
    if (req.url.startsWith('/api/events?')) {
      if (!slowCatchupDone && [...relay.directHost.peers.values()].some(p => p.eventsState === 'preparing')) {
        slowCatchupDone = true;
        await relay.emitEvent('root', {kind:'message.delta',item_id:'slow_sync',delta:'slow-sync',role:'assistant'});
        await delay(11000);
      }
      const after = Number(new URL(req.url, 'http://localhost').searchParams.get('cursor'));
      return res.end(JSON.stringify({events: events.filter(frame => frame.cursor > after), next_cursor: cursor, has_more: false}));
    }
    if (req.url === '/approval') {
      const action = {command: 'fixture'}, expires = new Date(Date.now() + 60000).toISOString();
      await relay.requestApproval({approval_id: 'native_approval', session_id: 'root', expires_at: expires,
        action: {...action, command_hash: hashAction(action)}});
      return res.end(JSON.stringify({approval_id: 'native_approval', session_id: 'root', device_id: 'device',
        expires_at: expires, command_hash: hashAction(action), nonce: `fixture_${randomUUID()}`, decision: 'approved'}));
    }
    if (req.url === '/metrics') return res.end(JSON.stringify({...metrics, peers: [...relay.directHost.peers.values()].map(p => ({state: p.pc.connectionState, ice: p.pc.iceConnectionState, channel: p.channel?.readyState}))}));
    if (req.url === '/reset') { for (const p of relay.directHost.peers.values()) relay.directHost.drop(p); responses.clear(); metrics.httpReads = 0; metrics.httpResponses = 0; metrics.offers = 0; metrics.mutations = 0; metrics.decisions = 0; metrics.httpEvents = 0; metrics.probes = 0; probeMode = "ok"; slowCatchupDone = false; events.length = 0; cursor = 0; relay.outbox.transportRequests = Object.create(null); return res.end('{}'); }
    if (req.url === '/drop') { for (const p of relay.directHost.peers.values()) relay.directHost.drop(p); return res.end('{}'); }
    if (req.url === '/api/commands') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 100000) throw new Error('too large'); }
      const frame = JSON.parse(body);
      const command = await openJson(key, frame.envelope, frame.aad);
      command.browser_id = browser.browserId;
      if (command.type !== 'transport.offer') metrics.httpReads++; else metrics.offers++;
      relay.dispatchRemoteCommand(command, browser, Date.now());
      return res.end(JSON.stringify({ request_id: frame.request_id, delivery: 'queued' }));
    }
    if (req.url.startsWith('/api/responses/')) {
      const response = responses.get(decodeURIComponent(req.url.slice('/api/responses/'.length)));
      if (!response) { res.statusCode = 404; return res.end(JSON.stringify({ error: { code: 'response_pending' } })); }
      return res.end(JSON.stringify(response));
    }
    res.statusCode = 404; res.end('{}');
  } catch { res.statusCode = 400; res.end('{}'); }
});
server.listen(43197, '127.0.0.1', () => console.log('WebRTC synthetic fixture listening on loopback:43197'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  relay.closed = true; relay.directHost.close(); server.close();
});
