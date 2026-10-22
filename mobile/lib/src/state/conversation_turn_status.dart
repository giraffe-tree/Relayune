import '../models.dart';

enum ConversationTurnStatus {
  running,
  completed,
  approval,
  question,
  stopped,
  interrupted,
  stale,
  unknown,
}

ConversationTurnStatus conversationTurnStatus(
  List<RelayMessage> messages, {
  required bool active,
  required bool online,
  String? pendingAction,
}) {
  if (active) {
    if (!online) return ConversationTurnStatus.stale;
    if (pendingAction != null) {
      return pendingAction == 'question.select'
          ? ConversationTurnStatus.question
          : ConversationTurnStatus.approval;
    }
    return ConversationTurnStatus.running;
  }
  // Only turn-level evidence determines the outcome. Tool failures can recover.
  for (final message in messages.reversed) {
    final status = message.turnStatus;
    if (status == 'failed' ||
        status == 'error' ||
        message.kind == 'turn.failed') {
      return ConversationTurnStatus.interrupted;
    }
    if (message.kind == 'turn.stopped' ||
        const {
          'aborted',
          'cancelled',
          'canceled',
          'declined',
          'interrupted',
        }.contains(status)) {
      return ConversationTurnStatus.stopped;
    }
    if (status == 'completed' ||
        status == 'end_turn' ||
        status == 'success' ||
        (message.kind == 'turn.completed' && status == null)) {
      return ConversationTurnStatus.completed;
    }
  }
  if (pendingAction != null) {
    if (!online) return ConversationTurnStatus.stale;
    return pendingAction == 'question.select'
        ? ConversationTurnStatus.question
        : ConversationTurnStatus.approval;
  }
  if (messages.any((m) => m.messagePhase == 'final_answer')) {
    return ConversationTurnStatus.completed;
  }
  if (!online && messages.any((m) => m.toolActivityStatus == 'running')) {
    return ConversationTurnStatus.stale;
  }
  return ConversationTurnStatus.unknown;
}
