const terminal = new Set(['completed', 'failed', 'interrupted']);

/** Queue admission does not have a turn ID; correlate its receipt first. */
export function findLiveTurnCompletion(result, requestId, events) {
  for (const event of events) {
    if (result.mode === 'queued') {
      if (event.kind !== 'codex.queue.updated') continue;
      if (event.request_id !== requestId && event.client_message_id !== requestId) continue;
      if (event.request_id && event.request_id !== requestId) continue;
      if (event.client_message_id && event.client_message_id !== requestId) continue;
      if (!event.turn_id || !terminal.has(event.status)) continue;
      return { turnId: event.turn_id, status: event.status };
    }
    if (!result.turnId || event.turn_id !== result.turnId) continue;
    if (event.kind === 'turn.failed') return { turnId: result.turnId, status: 'failed', ...(event.error ? { error: event.error } : {}) };
    if (event.kind === 'turn.completed') return {
      turnId: result.turnId,
      // Claude/Kimi expose their native normal stop reason on this event.
      status: event.status === 'end_turn' ? 'completed' : event.status ?? 'completed',
    };
  }
  return null;
}

export function hasLiveTurnReply(messages, turnId, expected) {
  return messages.some(message => message.role === 'codex' && message.turn_id === turnId && message.content?.includes(expected));
}

/** A denied Codex tool may natively stop its turn; never relabel that status. */
export function acceptsLiveTurnCompletion(completion, { provider, rejectedTool = false } = {}) {
  return completion?.status === 'completed' ||
    (provider === 'codex' && rejectedTool && completion?.status === 'interrupted');
}

/** The live approval fixture must explicitly leave inherited auto/bypass modes. */
export function selectLiveClaudeManualMode(advertisedModes) {
  for (const mode of ['manual', 'default']) {
    if (Array.isArray(advertisedModes) && advertisedModes.includes(mode)) return mode;
  }
  throw new Error('Claude did not advertise a manual/default permission mode for this fixture.');
}
