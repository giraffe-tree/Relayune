import { CODEX_PERMISSION_MODES, permissionSettings, pickPermissions } from './codex-permissions.mjs';
export { pickPermissions } from './codex-permissions.mjs';
import { asyncAnswerText, asyncQuestionId, parseAsyncAnswers } from './codex-async-questions.mjs';
import { hashAction } from './protocol.mjs';
import { connect } from 'node:net';
import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeDesktopStatePool } from './codex-desktop-state.mjs';
import { canContinueCodexTurn } from './codex-continuation.mjs';

// Large native snapshots include full tool history. Bound allocation while
// copying each incoming byte once instead of repeatedly concatenating history.
export function createDesktopFrameDecoder({ onFrame } = {}) {
  const header = Buffer.alloc(4);
  let headerBytes = 0, body = null, bodyBytes = 0;
  return function* decode(data) {
    let offset = 0;
    while (offset < data.length) {
      if (body === null) {
        const count = Math.min(4 - headerBytes, data.length - offset);
        data.copy(header, headerBytes, offset, offset + count);
        headerBytes += count;
        offset += count;
        if (headerBytes < 4) continue;
        const length = header.readUInt32LE();
        if (!length || length > 64 * 1024 * 1024) {
          throw new Error('Codex Desktop snapshot exceeds the 64 MiB limit.');
        }
        body = Buffer.allocUnsafe(length);
        bodyBytes = 0;
        headerBytes = 0;
      }
      const count = Math.min(body.length - bodyBytes, data.length - offset);
      data.copy(body, bodyBytes, offset, offset + count);
      offset += count;
      bodyBytes += count;
      if (bodyBytes === body.length) {
        const complete = body;
        body = null;
        const message = JSON.parse(complete.toString('utf8'));
        onFrame?.(complete.length);
        yield message;
      }
    }
  };
}

export function createDesktopStatePool(options = {}) {
  return makeDesktopStatePool({ ...options, decodeFrames: createDesktopFrameDecoder });
}
const defaultStatePool = createDesktopStatePool();
const defaultSocketPath = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'ipc', 'ipc.sock');

// Desktop keeps ownership of dormant threads after unloading their runtime.
// An authoritative notLoaded snapshot needs no interrupt and can start a turn
// with inherited settings. Conflicting in-progress history must fail closed.
function desktopControlRuntimeType(state) {
  const type = state?.threadRuntimeStatus?.type;
  if (type !== 'notLoaded') return type;
  const turns = [...nativeSnapshotTurns(state), ...(state.turns ?? [])];
  return turns.some(turn => turn.status === 'inProgress') ? type : 'idle';
}

function validateDesktopContinuation(state, message) {
  if (message?.turnTrigger !== 'resume_interrupted_task') return;
  const turns = nativeSnapshotTurns(state);
  const latest = turns.findLast(turn => turn.turnId ?? turn.id);
  if (desktopControlRuntimeType(state) !== 'idle' ||
      !message.expectedTurnId || (latest?.turnId ?? latest?.id) !== message.expectedTurnId ||
      !canContinueCodexTurn(latest) || (state.requests ?? []).length > 0) {
    throw new Error('Codex continuation is no longer available; refresh the session.');
  }
}

// Codex Desktop native IPC (host-scoped request versions). No general RPC proxy.
// Snapshots stay transient; question replies are checked against native items.
export async function desktopInterruptTurn(sessionId, options = {}) {
  const result = await desktopPermissions(sessionId, undefined, { ...options, interrupt: true });
  if (!result.turnId) return result;
  const deadline = Date.now() + (options.settleTimeoutMs ?? 10_000);
  while (Date.now() < deadline) {
    const state = await desktopRuntime(sessionId, { ...options, timeoutMs: Math.min(1000, deadline - Date.now()) });
    if (state.type === 'idle') return result;
    if (state.type !== 'active') throw new Error('Codex stop could not be confirmed.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Codex stop could not be confirmed; new message was not sent.');
}
export function desktopStartMessage(sessionId, message, options = {}) {
  if (message?.turnTrigger !== undefined &&
      (message.turnTrigger !== 'resume_interrupted_task' ||
       typeof message.expectedTurnId !== 'string' || !message.expectedTurnId ||
       !Array.isArray(message.input) || message.input.length !== 0 ||
       message.runtimeSettings !== undefined)) {
    throw new Error('Invalid Codex continuation.');
  }
  const runtime = message?.runtimeSettings;
  if (runtime !== undefined && (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) ||
      Object.keys(runtime).some(key => !['model', 'effort', 'permissions'].includes(key)) ||
      (runtime.model === undefined && runtime.permissions === undefined) ||
      (runtime.model !== undefined && (typeof runtime.model !== 'string' || !runtime.model)) ||
      (runtime.effort !== undefined && (typeof runtime.effort !== 'string' || !runtime.model)) ||
      (runtime.permissions !== undefined && !CODEX_PERMISSION_MODES.includes(runtime.permissions)))) {
    throw new Error('Invalid Codex message settings.');
  }
  return desktopPermissions(sessionId, undefined, { ...options, startSubmission: message });
}
export function desktopSubmitMessage(sessionId, message, options = {}) {
  return desktopPermissions(sessionId, undefined, { ...options, submission: message });
}
export function desktopRuntime(sessionId, options = {}) {
  return desktopPermissions(sessionId, undefined, { ...options, runtimeOnly: true });
}
export function desktopAnswerQuestion(sessionId, reply, options = {}) {
  if (!reply || typeof reply.turnId !== 'string' || typeof reply.itemId !== 'string' ||
      !Number.isInteger(reply.index) || reply.index < 0 || reply.index > 2 ||
      typeof reply.question !== 'string' || typeof reply.answer !== 'string' || !reply.answer.trim() || reply.answer.length > 8000)
    throw new Error('Invalid Codex question answer.');
  return desktopPermissions(sessionId, undefined, { ...options, questionReply: reply });
}
const DESKTOP_APPROVAL_METHODS = {
  'item/commandExecution/requestApproval': 'thread-follower-command-approval-decision',
  'item/fileChange/requestApproval': 'thread-follower-file-approval-decision',
};
export function desktopPendingApprovals(sessionId, options = {}) {
  return desktopPermissions(sessionId, undefined, {...options, readApprovals:true});
}
export function desktopResolveApproval(sessionId, reply, options = {}) {
  if (!DESKTOP_APPROVAL_METHODS[reply?.method] || !['accept','decline','cancel'].includes(reply?.decision) ||
      !['number','string'].includes(typeof reply.requestId) || typeof reply.paramsHash !== 'string')
    throw new Error('Invalid Codex Desktop approval decision.');
  return desktopPermissions(sessionId, undefined, {...options, approvalReply:reply});
}
export async function desktopPermissions(sessionId, settings, {
  statePool = defaultStatePool,
  socketPath = defaultSocketPath(),
  timeoutMs = 8000,
  ...operation
} = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('Invalid Codex thread id.');
  const fresh = settings || operation.ownershipOnly || operation.questionReply || operation.approvalReply ||
    operation.startSubmission?.turnTrigger === 'resume_interrupted_task';
  if (fresh) {
    // Authority-sensitive actions always validate a new native snapshot. Also
    // discard old live state: a successful mutation must not reuse old settings.
    if (!operation.ownershipOnly) statePool.invalidate(sessionId, socketPath);
    return desktopPermissionsFresh(sessionId, settings, { ...operation, socketPath, timeoutMs });
  }
  let mutationSent = false;
  return statePool.run(sessionId, { socketPath, timeoutMs }, async connection => {
    if (connection.ownerAbsent) {
      if (operation.runtimeOnly) return { type: 'notOwned' };
      throw new Error('无法确认 Codex 电脑端权限，请刷新会话后重试。');
    }
    const state = connection.state;
    const type = desktopControlRuntimeType(state);
    if (operation.runtimeOnly) {
      if (!['active', 'idle', 'systemError'].includes(type)) throw new Error('无法确认 Codex 电脑端权限，请刷新会话后重试。');
      return { type };
    }
    if (operation.readApprovals) return structuredClone((state.requests ?? []).filter(request =>
      DESKTOP_APPROVAL_METHODS[request.method] && request.params?.threadId === sessionId).slice(0, 64));
    if (operation.interrupt) {
      const active = nativeSnapshotTurns(state).findLast(turn => turn.status === 'inProgress');
      const turnId = active?.turnId ?? active?.id;
      if (type === 'idle') return { turnId: null };
      if (type !== 'active' || !turnId) throw new Error('Codex stop could not be confirmed.');
      const response = await connection.request('thread-follower-interrupt-turn', {
        conversationId: sessionId, mode: 'user-stop', expectedTurnId: turnId,
      }, 5, connection.ownerId);
      if (response.result?.ok !== true || response.result?.interruptedTurnId !== turnId) throw new Error('Codex stop could not be confirmed.');
      if (connection.cacheable) {
        // A live source subscription can confirm the transition directly. Do
        // not poll and replay the full history while an interrupt is settling.
        const settled = await connection.waitFor(value => desktopControlRuntimeType(value) !== 'active',
          operation.settleTimeoutMs ?? 10_000).catch(() => { throw new Error('Codex stop could not be confirmed; new message was not sent.'); });
        if (desktopControlRuntimeType(settled) !== 'idle') throw new Error('Codex stop could not be confirmed.');
      }
      return { turnId };
    }
    if (operation.startSubmission) {
      if (type === 'active') throw new Error('Codex is still running; new message was not sent.');
      if (type !== 'idle') throw new Error('无法确认 Codex 电脑端权限，请刷新会话后重试。');
      const message = operation.startSubmission;
      validateDesktopContinuation(state, message);
      const { permissions: permissionMode, ...runtime } = message.runtimeSettings ?? {};
      const permissions = pickPermissions(state.latestThreadSettings);
      if (permissionMode && (!permissions || !state.cwd)) throw new Error('无法确认 Codex 电脑端权限，请刷新会话后重试。');
      const permissionOverrides = permissionMode ? permissionSettings(permissionMode, permissions, state.cwd) : {};
      const nativeMode = state.latestThreadSettings?.collaborationMode ?? state.latestCollaborationMode;
      const collaborationMode = runtime.model && nativeMode ? { ...nativeMode, settings: { ...nativeMode.settings,
        model: runtime.model, ...(runtime.effort ? { reasoning_effort: runtime.effort } : {}) } } : null;
      const response = await connection.request('thread-follower-start-turn', {
        conversationId: sessionId, turnStart: { request: { threadId: sessionId, input: message.input,
          clientUserMessageId: message.clientMessageId,
          ...(message.turnTrigger ? { turnTrigger: message.turnTrigger } : {}),
          ...runtime, ...permissionOverrides, ...(collaborationMode ? { collaborationMode } : {}) },
          context: { inheritThreadSettings: true } },
      }, 3, connection.ownerId);
      const turnId = response.result?.result?.turn?.id;
      if (!turnId) throw new Error('Codex message acceptance could not be confirmed.');
      // Owner acceptance is not a runtime snapshot. Require a source update
      // before trusting idle again, even if the acknowledgement raced its patch.
      if (connection.state.threadRuntimeStatus?.type !== 'active') {
        statePool.invalidate(sessionId, socketPath);
      }
      return { mode: 'started', turnId, persisted: false };
    }
    if (operation.submission) {
      if (type === 'idle') return { awaitingNewTurn: true };
      if (type !== 'active') throw new Error('无法确认 Codex 电脑端权限，请刷新会话后重试。');
      const message = operation.submission;
      mutationSent = true;
      await connection.request('thread-follower-steer-turn', { conversationId: sessionId, input: message.input,
        clientUserMessageId: message.clientMessageId, restoreMessage: { text: message.content, cwd: state.cwd,
          context: { workspaceRoots: state.cwd ? [state.cwd] : [], commentAttachments: [] } } }, 2, connection.ownerId);
      return { accepted: true };
    }
    const permissions = pickPermissions(state.latestThreadSettings);
    if (!permissions) throw new Error('无法确认 Codex 电脑端权限，请刷新会话后重试。');
    return structuredClone({ ...permissions, running: type === 'active', current: pickPermissions(state.currentPermissions) });
  }).catch(error => {
    // A dormant owner has not received a mutation; preserve the durable queue.
    if (operation.submission && !mutationSent && /无法确认/.test(error.message)) return { awaitingNewTurn: true };
    throw error;
  });
}

async function desktopPermissionsFresh(sessionId, settings, {
  socketPath = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'ipc', 'ipc.sock'),
  timeoutMs = 8000,
  runtimeOnly = false,
  ownershipOnly = false,
  questionReply = null,
  submission = null,
  interrupt = false,
  startSubmission = null,
  readApprovals = false,
  approvalReply = null,
} = {}) {
  if (ownershipOnly && settings) throw new Error('Ownership probes cannot update permissions.');
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('Invalid Codex thread id.');
  if (settings && Object.keys(settings).some(key =>
    !['approvalPolicy', 'approvalsReviewer', 'sandboxPolicy'].includes(key))) {
    throw new Error('Unsupported Codex permission setting.');
  }
  for (const path of [dirname(socketPath), socketPath]) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077)) {
      throw new Error('Codex Desktop IPC permissions are unsafe.');
    }
    if (path === socketPath && !info.isSocket()) throw new Error('Invalid Codex Desktop socket.');
  }
  const socket = connect(socketPath);
  const pending = new Map();
  let clientId = 'initializing-client', ownerId;
  const decodeFrames = createDesktopFrameDecoder();
  let snapshotWaiter;
  const failure = () => new Error('无法确认 Codex 电脑端权限，请刷新会话后重试。');
  function rejectAll(error) {
    for (const item of pending.values()) item.reject(error);
    pending.clear();
    snapshotWaiter?.reject(error);
    snapshotWaiter = null;
  }
  function send(message) {
    const body = Buffer.from(JSON.stringify(message)), header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    socket.write(Buffer.concat([header, body]));
  }
  function request(method, params, version = 1, targetClientId) {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject, method, targetClientId });
      send({ type: 'request', requestId, sourceClientId: clientId, method, params,
        version, targetClientId, ...(method.startsWith('thread-follower-') ? {hostId: 'local'} : {}) });
    });
  }
  function following(value) {
    send({ type: 'broadcast', sourceClientId: clientId, method: 'thread-stream-following-changed',
      version: 1, targetClientIds: [ownerId],
      params: {hostId: 'local', conversationId: sessionId, following: value} });
  }
  function snapshot() {
    return new Promise((resolve, reject) => {
      snapshotWaiter = {resolve, reject};
      following(true);
    });
  }
  const timer = setTimeout(() => { rejectAll(failure()); socket.destroy(); }, timeoutMs);
  socket.on('error', () => rejectAll(failure()));
  socket.on('close', () => rejectAll(failure()));
  socket.on('data', data => {
    try {
      for (const message of decodeFrames(data)) {
        if (message.type === 'client-discovery-request') {
          send({type: 'client-discovery-response', requestId: message.requestId, response: {canHandle: false}});
        } else if (message.type === 'response') {
          const item = pending.get(message.requestId);
          if (!item) continue;
          pending.delete(message.requestId);
          if (message.resultType === 'success' && message.method === item.method && (!item.targetClientId || message.handledByClientId === item.targetClientId)) item.resolve(message);
          else if (runtimeOnly && item.method === 'thread-owner-discovery' &&
              message.resultType === 'error' && message.error === 'no-client-found' &&
              (message.method == null || message.method === item.method)) {
            item.resolve({ ownerAbsent: true });
          } else item.reject(failure());
        } else if (message.type === 'broadcast' && message.method === 'thread-stream-state-changed' &&
          message.version === 11 && message.sourceClientId === ownerId &&
          message.params?.hostId === 'local' && message.params?.conversationId === sessionId &&
          (!message.targetClientIds || message.targetClientIds.includes(clientId)) &&
          message.params?.change?.type === 'snapshot') {
          const state = message.params.change.conversationState;
          if (readApprovals || approvalReply) {
            const requests = (state?.requests ?? []).filter(r => DESKTOP_APPROVAL_METHODS[r.method] &&
              r.params?.threadId === sessionId).slice(0, 64);
            if (approvalReply) {
              const match = requests.find(r => r.id === approvalReply.requestId && r.method === approvalReply.method);
              const choices = match?.params?.availableDecisions ?? ['accept','decline','cancel'];
              if (!match || hashAction(match.params) !== approvalReply.paramsHash || !choices.includes(approvalReply.decision))
                snapshotWaiter?.reject(new Error('Codex Desktop approval is no longer pending or has changed.'));
              else snapshotWaiter?.resolve({});
            } else snapshotWaiter?.resolve(requests);
            snapshotWaiter = null;
            continue;
          }
          if (questionReply) {
            const turns = nativeSnapshotTurns(state);
            const turn = turns.find(t => (t.turnId ?? t.id) === questionReply.turnId);
            const item = turn?.items?.find(i => i.id === questionReply.itemId && i.type === 'agentMessage');
            const question = item?.questions?.[questionReply.index];
            const questionId = asyncQuestionId(questionReply.itemId, questionReply.index);
            const answered = turns.some(t => (t.items ?? []).some(i => {
              if (i.type !== 'userMessage' && !(i.type === 'steeringUserMessage' && i.status === 'accepted')) return false;
              return (i.content ?? i.input ?? []).some(c => (parseAsyncAnswers(c.text) ?? []).some(a => a.questionItemId === questionId));
            }));
            if ((state.threadRuntimeStatus?.type === 'idle' && turn?.status !== 'completed') || !['active','idle'].includes(state.threadRuntimeStatus?.type) || !['inProgress','completed'].includes(turn?.status) ||
                !question || question.title !== questionReply.question || answered) snapshotWaiter?.reject(new Error('Codex question is no longer pending.'));
            else snapshotWaiter?.resolve({ cwd: state.cwd ?? turn.params?.cwd, idle:state.threadRuntimeStatus?.type === 'idle' });
            snapshotWaiter = null;
            continue;
          }
          if (interrupt) {
            const type = desktopControlRuntimeType(state);
            const active = nativeSnapshotTurns(state).findLast(t => t.status === 'inProgress');
            const turnId = active?.turnId ?? active?.id;
            if (type === 'idle') snapshotWaiter?.resolve({ turnId: null });
            else if (type === 'active' && turnId) snapshotWaiter?.resolve({ turnId });
            else snapshotWaiter?.reject(failure());
            snapshotWaiter = null;
            continue;
          }
          if (submission || startSubmission) {
            const type = desktopControlRuntimeType(state);
            try { validateDesktopContinuation(state, startSubmission); }
            catch (error) {
              snapshotWaiter?.reject(error);
              snapshotWaiter = null;
              continue;
            }
            if (['active', 'idle'].includes(type)) snapshotWaiter?.resolve({
              running: type === 'active', cwd: state.cwd,
              ...(startSubmission?.runtimeSettings?.permissions ? { permissions: pickPermissions(state.latestThreadSettings) } : {}),
              ...(startSubmission?.runtimeSettings ? {
                collaborationMode: state.latestThreadSettings?.collaborationMode ?? state.latestCollaborationMode,
              } : {}),
            });
            else snapshotWaiter?.reject(failure());
            snapshotWaiter = null;
            continue;
          }
          if (runtimeOnly) {
            const type = desktopControlRuntimeType(state);
            if (['active', 'idle', 'systemError'].includes(type)) snapshotWaiter?.resolve({ type });
            else snapshotWaiter?.reject(failure());
            snapshotWaiter = null;
            continue;
          }
          const permissions = pickPermissions(state?.latestThreadSettings);
          if (!permissions) { snapshotWaiter?.reject(failure()); }
          else snapshotWaiter?.resolve({ ...permissions,
            running: state.threadRuntimeStatus?.type === 'active',
            current: pickPermissions(state.currentPermissions),
          });
          snapshotWaiter = null;
        }
      }
    } catch { rejectAll(failure()); socket.destroy(); }
  });
  try {
    const initialized = await request('initialize', {clientType: 'relayune-settings'}, 0);
    clientId = initialized.result.clientId;
    const owner = await request('thread-owner-discovery', {hostId: 'local', conversationId: sessionId});
    if (runtimeOnly && owner.ownerAbsent) return { type: 'notOwned' };
    ownerId = owner.handledByClientId;
    if (!ownerId) throw failure();
    // Sending only needs the discovered writer, not its permission snapshot.
    // Dormant Desktop windows may never publish that snapshot.
    if (ownershipOnly) return { owned: true };
    let actual;
    try { actual = await snapshot(); }
    catch (error) {
      // No mutation has been sent: retain durable queue support for dormant owners.
      if (submission) return { awaitingNewTurn: true };
      throw error;
    }
    if (interrupt) {
      if (!actual.turnId) return actual;
      const stopped = await request('thread-follower-interrupt-turn', {
        conversationId: sessionId, mode: 'user-stop', expectedTurnId: actual.turnId,
      }, 5, ownerId);
      if (stopped.result?.ok !== true || stopped.result?.interruptedTurnId !== actual.turnId)
        throw new Error('Codex stop could not be confirmed.');
      return actual;
    }
    if (startSubmission) {
      if (actual.running) throw new Error('Codex is still running; new message was not sent.');
      const { permissions: permissionMode, ...runtime } = startSubmission.runtimeSettings ?? {};
      if (permissionMode && (!actual.permissions || !actual.cwd)) throw failure();
      const permissionOverrides = permissionMode ? permissionSettings(permissionMode, actual.permissions, actual.cwd) : {};
      // Preserve the native mode and its instructions while changing only its
      // model/effort; an inherited collaboration mode can override top-level fields.
      const collaborationMode = runtime.model && actual.collaborationMode ? {
        ...actual.collaborationMode,
        settings: { ...actual.collaborationMode.settings, model: runtime.model,
          ...(runtime.effort ? { reasoning_effort: runtime.effort } : {}) },
      } : null;
      const response = await request('thread-follower-start-turn', {
        conversationId: sessionId,
        turnStart: {
          request: { threadId: sessionId, input: startSubmission.input,
            clientUserMessageId: startSubmission.clientMessageId,
            ...(startSubmission.turnTrigger ? { turnTrigger: startSubmission.turnTrigger } : {}),
            ...runtime, ...permissionOverrides, ...(collaborationMode ? { collaborationMode } : {}) },
          context: { inheritThreadSettings: true },
        },
      }, 3, ownerId);
      const turnId = response.result?.result?.turn?.id;
      if (!turnId) throw new Error('Codex message acceptance could not be confirmed.');
      return { mode: 'started', turnId, persisted: false };
    }
    if (submission) {
      if (!actual.running) return { awaitingNewTurn: true };
      // Never fall back to queue after this call: a lost acknowledgement may
      // still mean that the active owner accepted the message.
      await request('thread-follower-steer-turn', {
        conversationId: sessionId, input: submission.input,
        clientUserMessageId: submission.clientMessageId,
        restoreMessage: { text: submission.content, cwd: actual.cwd,
          context: { workspaceRoots: actual.cwd ? [actual.cwd] : [], commentAttachments: [] } },
      }, 2, ownerId);
      return { accepted: true };
    }
    if (readApprovals) return actual;
    if (approvalReply) {
      await request(DESKTOP_APPROVAL_METHODS[approvalReply.method], {conversationId:sessionId,
        requestId:approvalReply.requestId, decision:approvalReply.decision}, 2, ownerId);
      return {accepted:true};
    }
    if (questionReply) {
      // An idle owner cannot steer; use the existing durable queue path after
      // validating the original native question and absence of any answer.
      if (actual.idle) return {awaitingNewTurn:true};
      const content = asyncAnswerText([{ questionItemId: asyncQuestionId(questionReply.itemId, questionReply.index),
        question: questionReply.question, answer: questionReply.answer }]);
      await request('thread-follower-steer-turn', {
        conversationId: sessionId, input: [{ type: 'text', text: content, text_elements: [] }],
        clientUserMessageId: questionReply.clientMessageId,
        restoreMessage: { text: content, cwd: actual.cwd, context: { workspaceRoots: actual.cwd ? [actual.cwd] : [], commentAttachments: [] } },
      }, 2, ownerId);
      return { accepted: true };
    }
    if (settings) {
      if (actual.running) throw new Error('Codex 正在运行，请等待任务结束后切换权限。');
      await request('thread-follower-update-thread-settings', {conversationId: sessionId, threadSettings: settings}, 3, ownerId);
      // A same-client false/true pair can be coalesced by Desktop and produce
      // no second snapshot. A fresh subscription guarantees authoritative readback.
      return desktopPermissionsFresh(sessionId, undefined, {socketPath, timeoutMs});
    }
    return actual;
  } finally {
    clearTimeout(timer);
    if (ownerId && !ownershipOnly && !socket.destroyed) following(false);
    socket.end();
    socket.destroy();
  }
}

// Current Desktop snapshots keep turns in paginated canonical history; the
// legacy `turns` array can be empty even while the owner is running.
function nativeSnapshotTurns(state) {
  if (state?.turnHistory?.kind !== 'canonical') return Array.isArray(state?.turns) ? state.turns : [];
  const history = state.turnHistory.history;
  return (history?.islands ?? []).flatMap(island => island.entries ?? [])
    .map(entry => history.entitiesByKey?.[entry.value]).filter(Boolean);
}
