const transitions = new Set([
  "message.delta", "message.completed", "command.started", "command.output",
  "command.completed", "file.changed", "plan.updated", "approval.requested",
]);

// Only phase changes cross the relay boundary. Native reasoning content never
// enters history, notifications or this event's encrypted payload.
export function withThinkingState(handlers) {
  const turns = new Map();
  return {
    ...handlers,
    async emitEvent(sessionId, event, extra) {
      let turn = turns.get(sessionId);
      if (event.kind === "turn.started") {
        if (turn?.id !== event.turn_id) {
          turn = { id: event.turn_id, thinking: false };
          turns.set(sessionId, turn);
        }
      }
      if (event.kind === "turn.thinking") {
        if (!turn?.id || turn.id !== event.turn_id || typeof event.active !== "boolean" || turn.thinking === event.active) return;
        turn.thinking = event.active;
        return handlers.emitEvent(sessionId, {
          kind: "turn.thinking", turn_id: turn.id, active: event.active,
          ...(event.provider ? { provider: event.provider } : {}),
        }, extra);
      }
      if (turn?.id === event.turn_id) {
        if (transitions.has(event.kind)) turn.thinking = false;
        if (["turn.completed", "turn.failed"].includes(event.kind)) turns.delete(sessionId);
      }
      return handlers.emitEvent(sessionId, event, extra);
    },
    async requestApproval(approval) {
      const turn = turns.get(approval.session_id);
      if (turn?.id === approval.turn_id) turn.thinking = false;
      return handlers.requestApproval(approval);
    },
  };
}
