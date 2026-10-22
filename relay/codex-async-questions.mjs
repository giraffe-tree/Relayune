import { createHash } from 'node:crypto';
import { hashAction } from './protocol.mjs';

const OPEN = '<send_user_message_question_reply>';
const CLOSE = '</send_user_message_question_reply>';
export function parseAsyncAnswers(text) {
  if (typeof text !== 'string' || text.length > 32_000) return null;
  const value = text.trim();
  if (!value.startsWith(OPEN) || !value.endsWith(CLOSE)) return null;
  try {
    const parsed = JSON.parse(value.slice(OPEN.length, -CLOSE.length));
    const answers = Array.isArray(parsed) ? parsed : [parsed];
    if (!answers.length || answers.length > 3 || !answers.every(a =>
      typeof a?.questionItemId === 'string' && typeof a.question === 'string' && typeof a.answer === 'string')) return null;
    return answers;
  } catch { return null; }
}
export function asyncAnswerText(answers) { return `${OPEN}\n${JSON.stringify(answers)}\n${CLOSE}`; }
export function asyncQuestionId(itemId, index) { return JSON.stringify(['request_user_input_async', itemId, index]); }
function approvalIdFor(sessionId, turnId, questionId) {
  return `apr_async_${createHash('sha256').update(JSON.stringify([sessionId, turnId, questionId])).digest('hex')}`;
}
export function normalizeAsyncQuestions(value) {
  if (!Array.isArray(value) || !value.length || value.length > 3) return [];
  if (!value.every(q => typeof q?.title === 'string' && q.title.trim() && q.title.length <= 2_000 &&
    (q.options == null || (Array.isArray(q.options) && q.options.length <= 20 && q.options.every(o => typeof o === 'string' && o.length <= 2_000))))) return [];
  return value.map(q => ({ title: q.title, options: q.options ?? [] }));
}

// Read only native typed items or successful, exact tool calls; never interpret
// assistant prose as an actionable question. State remains local to the adapter.
export function trackRolloutQuestions(record, state) {
  state.asyncQuestions ??= new Map();
  const p = record?.payload ?? {};
  if (record.type === 'event_msg' && p.type === 'turn_aborted') {
    for (const [id,q] of state.asyncQuestions) if (!p.turn_id || q.turnId === p.turn_id) state.asyncQuestions.delete(id);
  }
  if (record.type === 'response_item' && p.type === 'function_call' && p.name === 'request_user_input_async') {
    try {
      const questions = normalizeAsyncQuestions(JSON.parse(p.arguments).questions);
      if (questions.length && state.activeTurnId && typeof p.call_id === 'string') {
        state.asyncQuestions.set(p.call_id, { itemId: p.call_id, turnId: state.activeTurnId, questions,
          requestedAt: record.timestamp, accepted: false, answers: new Map() });
        while (state.asyncQuestions.size > 32) state.asyncQuestions.delete(state.asyncQuestions.keys().next().value);
      }
    } catch { /* malformed native tool input is not an approval */ }
  }
  if (record.type === 'response_item' && p.type === 'function_call_output') {
    const question = state.asyncQuestions.get(p.call_id);
    if (question) {
      try { question.accepted = JSON.parse(p.output)?.accepted === true; } catch { question.accepted = false; }
    }
  }
  const texts = record.type === 'event_msg' && p.type === 'user_message' ? [p.message] :
    record.type === 'response_item' && p.type === 'message' && p.role === 'user' ?
      (p.content ?? []).filter(c => c.type === 'input_text').map(c => c.text) : [];
  for (const text of texts) for (const answer of parseAsyncAnswers(text) ?? []) {
    for (const q of state.asyncQuestions.values()) q.questions.forEach((question, index) => {
      if (answer.questionItemId === asyncQuestionId(q.itemId, index) && answer.question === question.title)
        q.answers.set(index, answer.answer);
    });
  }
}

export class CodexAsyncQuestions {
  constructor({ publish, emit, send, now = () => Date.now() }) {
    Object.assign(this, { publish, emit, send, now });
    this.entries = new Map();
    this.sends = new Map();
  }
  async observe(sessionId, source, { cwd, rootSessionId = sessionId } = {}) {
    if (!source.turnId || !source.itemId) return;
    const questions = normalizeAsyncQuestions(source.questions);
    for (const [index, question] of questions.entries()) {
      const questionId = asyncQuestionId(source.itemId, index);
      const id = approvalIdFor(sessionId, source.turnId, questionId);
      let entry = this.entries.get(id);
      if (entry) {
        if (source.answers?.has(index) && ['pending', 'unconfirmed'].includes(entry.state)) await this.finish(entry, 'approved');
        continue;
      }
      const requestedAt = source.requestedAt ?? new Date(this.now()).toISOString();
      if (!Number.isFinite(Date.parse(requestedAt))) continue;
      const expiresAt = new Date(Date.parse(requestedAt) + 10 * 60_000).toISOString();
      if (Date.parse(expiresAt) <= this.now() || source.answers?.has(index)) continue;
      const action = { type: 'question.select', display: question.title, question_id: questionId,
        header: '', cwd, allows_freeform: true, is_secret: false,
        question_index: index, question_count: questions.length, question_group: source.itemId,
        options: question.options.map((name, n) => ({ option_id: `async_option_${n}`, name, kind: 'allow_once' })) };
      entry = { id, sessionId, rootSessionId, turnId: source.turnId, itemId: source.itemId, index,
        questionId, question, action, expiresAt, state: 'pending' };
      this.entries.set(id, entry);
      try {
        await this.publish({ approval_id: id, request_id: id, session_id: sessionId, root_session_id: rootSessionId,
          source_thread_id: sessionId, turn_id: source.turnId, risk_level: 'medium', requested_at: requestedAt,
          expires_at: expiresAt, action: { ...action, command_hash: hashAction(action) } });
      } catch (error) { this.entries.delete(id); throw error; }
    }
  }
  async finish(entry, decision) {
    entry.state = decision;
    await this.emit(entry.rootSessionId, { kind: 'approval.resolved', approval_id: entry.id,
      turn_id: entry.turnId, decision, command_hash: hashAction(entry.action) });
  }
  async resolve({ approvalId, decision, optionId, answer }) {
    const entry = this.entries.get(approvalId);
    if (!entry || entry.state !== 'pending' || Date.parse(entry.expiresAt) <= this.now())
      throw new Error('Codex question is no longer pending.');
    if (decision !== 'approved') throw new Error('Answer the question or stop its task.');
    const option = entry.action.options.find(o => o.option_id === optionId);
    if (optionId && !option) throw new Error('Invalid Codex question option.');
    const selected = option?.name ?? answer?.trim();
    if (typeof selected !== 'string' || !selected || selected.length > 8_000) throw new Error('Invalid Codex question answer.');
    entry.state = 'sending';
    // Reserve before awaiting, so two paired clients cannot both submit.
    try {
      // Different answers can arrive together. Serialize per conversation so
      // two answers after completion cannot race two turn/start calls.
      const previous = this.sends.get(entry.sessionId) ?? Promise.resolve();
      const sending = previous.catch(() => {}).then(() => {
        if (this.entries.get(entry.id) !== entry || entry.state !== 'sending' || Date.parse(entry.expiresAt) <= this.now())
          throw new Error('Codex question is no longer pending.');
        return this.send(entry, selected, asyncAnswerText([{ questionItemId: entry.questionId,
          question: entry.question.title, answer: selected }]));
      });
      this.sends.set(entry.sessionId, sending);
      try { await sending; } finally {
        if (this.sends.get(entry.sessionId) === sending) this.sends.delete(entry.sessionId);
      }
    } catch (error) {
      // An uncertain transport result must not be blindly retried. A native
      // answer event can still confirm it; interruption or expiry invalidates it.
      entry.state = 'unconfirmed';
      throw error;
    }
    entry.state = 'approved';
    return { confirmation: 'immediate' };
  }
  async observeAnswers(sessionId, text) {
    for (const answer of parseAsyncAnswers(text) ?? []) for (const entry of this.entries.values()) {
      if (entry.sessionId === sessionId && entry.questionId === answer.questionItemId &&
          entry.question.title === answer.question && ['pending', 'unconfirmed'].includes(entry.state))
        await this.finish(entry, 'approved');
    }
  }
  async settleHistory(sessionId, turns, rootSessionId = sessionId) {
    // An offline client may receive an old requested event after the live
    // resolution. Reconcile from native history whenever it opens the task.
    const replies = new Map();
    for (const turn of turns) for (const item of turn.items ?? []) {
      if (item.type !== 'userMessage') continue;
      for (const part of item.content ?? []) for (const answer of parseAsyncAnswers(part.text) ?? [])
        replies.set(answer.questionItemId, answer.question);
    }
    for (const turn of turns) for (const item of turn.items ?? []) {
      if (item.type !== 'agentMessage') continue;
      for (const [index, question] of normalizeAsyncQuestions(item.questions).entries()) {
        const questionId = asyncQuestionId(item.id, index);
        const answered = replies.get(questionId) === question.title;
        if (!answered && !['interrupted', 'failed'].includes(turn.status)) {
          // Restore native questions after an app/Relay restart, but never
          // manufacture a fresh expiry for old or undated history.
          const raw = item.createdAt ?? turn.startedAt;
          const at = typeof raw === 'number' ? new Date(raw < 1e12 ? raw * 1000 : raw).toISOString() : raw;
          if (at) await this.observe(sessionId, {turnId:turn.id,itemId:item.id,
            questions:item.questions,requestedAt:at,
            answers:new Map(normalizeAsyncQuestions(item.questions).flatMap((q,n) =>
              replies.get(asyncQuestionId(item.id,n)) === q.title ? [[n,true]] : []))}, {rootSessionId});
          continue;
        }
        const id = approvalIdFor(sessionId, turn.id, questionId);
        const decision = answered ? 'approved' : 'expired';
        const entry = this.entries.get(id);
        if (entry) entry.state = decision;
        await this.emit(rootSessionId, {kind:'approval.resolved', approval_id:id, turn_id:turn.id, decision});
      }
    }
  }
  async endTurn(sessionId, turnId, status = 'interrupted') {
    if (status === 'completed') {
      for (const entry of this.entries.values()) {
        if (entry.sessionId !== sessionId || entry.state === 'sending') continue;
        if (['approved','rejected','expired'].includes(entry.state)) this.entries.delete(entry.id);
        else if (Date.parse(entry.expiresAt) <= this.now()) {
          await this.finish(entry,'expired'); this.entries.delete(entry.id);
        }
      }
      return;
    }
    for (const entry of this.entries.values()) if (entry.sessionId === sessionId && entry.turnId === turnId) {
      if (['pending', 'unconfirmed'].includes(entry.state)) await this.finish(entry, 'expired');
      this.entries.delete(entry.id);
    }
  }
}
