import { createHmac, hkdfSync, webcrypto } from 'node:crypto';
import { sealJson } from './e2ee.mjs';

const purpose = 'relayune.ios.push.v1';
export async function iosPushKey(key) {
  const raw = typeof key === 'string' ? Buffer.from(key, 'base64url') : Buffer.from(await webcrypto.subtle.exportKey('raw', key));
  return Buffer.from(hkdfSync('sha256', raw, Buffer.alloc(0), Buffer.from(purpose), 32)).toString('base64url');
}
export function iosActivityRoute(key, session, turn) {
  return createHmac('sha256', Buffer.from(key,'base64url')).update(`${session}\0${turn}`).digest('hex');
}

// Business state remains in Desktop memory and encrypted per authorized phone.
// No commands, paths, message excerpts, approval text or project title are used.
export class IosPushState {
  tasks = new Map();
  transition(session, event, now) {
    const kind = event?.kind;
    if (!['turn.started','turn.steered','approval.requested','approval.resolved','turn.completed','turn.failed'].includes(kind)) return null;
    const root = event.root_session_id || session;
    const child = root !== session;
    let task = this.tasks.get(root);
    if (['turn.started','turn.steered'].includes(kind)) {
      if (child) return null;
      if (!task || task.turnId !== event.turn_id) task = {turnId:event.turn_id || '', startedAt:now, startKnown:true, approvals:new Map()};
      this.tasks.set(root, task);
    } else if (kind === 'approval.requested') {
      const expires = Date.parse(event.expires_at);
      if (!event.approval_id || !Number.isFinite(expires) || expires <= now + 15000) return null;
      task ??= {turnId:child ? '' : event.turn_id || '', startedAt:now, startKnown:false, approvals:new Map()};
      task.approvals.set(event.approval_id, {expires,question:event.action?.type === 'question.select'});
      this.tasks.set(root, task);
    } else if (kind === 'approval.resolved') {
      if (!task?.approvals.delete(event.approval_id)) return null;
    } else {
      if (child || (task?.turnId && event.turn_id && event.turn_id !== task.turnId)) return null;
      task ??= {turnId:event.turn_id || '',startedAt:now,startKnown:false,approvals:new Map()};
      task.finishedAt = now;
      task.state = kind === 'turn.failed' || ['failed','error'].includes(event.status) ? 'failed'
        : ['aborted','cancelled','canceled','declined','interrupted'].includes(event.status) ? 'stopped' : 'completed';
      task.approvals.clear();
      this.tasks.delete(root);
    }
    if (this.tasks.size > 256) this.tasks.delete(this.tasks.keys().next().value);
    const pending = [...task.approvals.values()].filter(a => a.expires > now);
    const state = task.state || (pending.length ? pending.some(a => a.question) ? 'question' : 'approval' : 'running');
    return {
      sessionId:root, turnId:task.turnId, state, startedAt:task.startedAt, updatedAt:now,
      staleAt:Math.min(now + 75000, ...pending.map(a => a.expires)),
      finishedAt:task.finishedAt || null, startKnown:task.startKnown,
      // Generic delivery metadata never contains the reason for attention.
      alert:kind === 'approval.requested' || !!task.finishedAt,
      expiresAt:Math.min(now + 300000, ...pending.map(a => a.expires)),
    };
  }

  async seal(key, snapshot, eventAad) {
    if (!snapshot) return undefined;
    const derived = await iosPushKey(key);
    const {alert, expiresAt, ...state} = snapshot;
    const aad = {...eventAad, type:'ios.push', expires_at:new Date(expiresAt).toISOString()};
    return {
      envelope:await sealJson(derived, state, aad),
      activity_route:state.turnId ? iosActivityRoute(derived,state.sessionId,state.turnId) : null,
      operation:state.finishedAt ? 'end' : 'update', alert,
      expires_at:expiresAt,
    };
  }
}
