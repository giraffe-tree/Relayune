import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/conversation_turn_status.dart';
import 'package:relayune_mobile/src/storage/history_store.dart';

void main() {
  const failedTool = RelayMessage(
    id: 'tool',
    role: 'system',
    content: '',
    createdAt: '2026-09-11T01:00:00Z',
    kind: 'tool_activity',
    toolActivityStatus: 'failed',
  );
  RelayMessage terminal(String status) => RelayMessage(
    id: 'end',
    role: 'system',
    content: '',
    createdAt: '2026-09-11T01:01:00Z',
    kind: 'turn.completed',
    turnStatus: status,
  );
  ConversationTurnStatus resolve(
    List<RelayMessage> messages, {
    bool active = false,
    bool online = true,
    String? action,
  }) => conversationTurnStatus(
    messages,
    active: active,
    online: online,
    pendingAction: action,
  );

  test('tool failure does not determine the turn outcome', () {
    expect(resolve([failedTool], active: true), ConversationTurnStatus.running);
    expect(resolve([failedTool]), ConversationTurnStatus.unknown);
    expect(
      resolve([failedTool, terminal('completed')]),
      ConversationTurnStatus.completed,
    );
  });
  test('terminal states survive history serialization', () {
    for (final entry in {
      'completed': ConversationTurnStatus.completed,
      'end_turn': ConversationTurnStatus.completed,
      'failed': ConversationTurnStatus.interrupted,
      'interrupted': ConversationTurnStatus.stopped,
    }.entries) {
      final restored = RelayMessage.fromHistory(
        HistoryStore.encodeMessage(terminal(entry.key)),
      );
      expect(resolve([failedTool, restored]), entry.value);
    }
  });
  test('waiting and disconnected activity are not completion', () {
    expect(
      resolve([failedTool], active: true, action: 'command'),
      ConversationTurnStatus.approval,
    );
    expect(
      resolve([failedTool], active: true, action: 'question.select'),
      ConversationTurnStatus.question,
    );
    expect(
      resolve([failedTool], active: true, online: false),
      ConversationTurnStatus.stale,
    );
    expect(
      resolve([terminal('completed')], online: false),
      ConversationTurnStatus.completed,
    );
  });
  test('legacy stopped markers survive cache restore without turn_status', () {
    const stopped = RelayMessage(
      id: 'turn_stopped_old',
      role: 'system',
      content: 'Stopped',
      createdAt: '2026-09-11T01:01:00Z',
      kind: 'turn.stopped',
      turnId: 'old',
    );
    final restored = RelayMessage.fromHistory(
      HistoryStore.encodeMessage(stopped),
    );
    expect(resolve([failedTool, restored]), ConversationTurnStatus.stopped);
    expect(resolve([restored], online: false), ConversationTurnStatus.stopped);
  });

  test('explicit final answer can identify completed legacy history', () {
    const finalReply = RelayMessage(
      id: 'reply',
      role: 'codex',
      content: 'Done',
      createdAt: '2026-09-11T01:01:00Z',
      kind: 'message',
      messagePhase: 'final_answer',
    );
    expect(resolve([failedTool, finalReply]), ConversationTurnStatus.completed);
    expect(
      resolve([finalReply, terminal('failed')]),
      ConversationTurnStatus.interrupted,
    );
  });
}
