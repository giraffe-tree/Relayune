// Delivery metadata contains no business state; both completion and attention
// result in the same generic alert. Unknown/child task completion stays silent.
export function shouldNotifyPhone(sessionId, event, sessions = [], extra = {}) {
  if (event?.kind === "approval.requested") return true;
  if (!["turn.completed", "turn.failed"].includes(event?.kind)) return false;
  if (["interrupted", "cancelled", "canceled", "stopped"].includes(event?.status)) return false;
  if (extra?.agent_id || event?.agent_id) return false;
  const session = sessions?.find((value) => value.id === sessionId);
  return Boolean(session && !session.parent_session_id && !session.parent_id && !session.is_subagent &&
    (!session.root_session_id || session.root_session_id === sessionId));
}
