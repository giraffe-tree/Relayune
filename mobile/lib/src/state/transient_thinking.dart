import '../models.dart';

/// Runtime-only phase evidence. Never serialize this into message/cache history.
class TransientThinking {
  final _states =
      <
        String,
        ({
          String turnId,
          bool thinking,
          int sequence,
          DateTime? at,
          DateTime? startedAt,
        })
      >{};
  DateTime? _invalidatedAt;

  bool isThinking(String sessionId, String? turnId) =>
      turnId != null &&
      _states[sessionId]?.turnId == turnId &&
      _states[sessionId]?.thinking == true;

  DateTime? startedAt(String sessionId, String? turnId) =>
      isThinking(sessionId, turnId) ? _states[sessionId]?.startedAt : null;

  void observe(RelayEvent record, {required String? activeTurnId}) {
    final event = record.event;
    final kind = event['kind'];
    if (!const {
      'turn.started',
      'turn.thinking',
      'message.delta',
      'message.completed',
      'command.started',
      'command.output',
      'command.completed',
      'file.changed',
      'plan.updated',
      'approval.requested',
    }.contains(kind)) {
      return;
    }
    final turnId = event['turn_id'];
    if (turnId is! String || turnId != activeTurnId) return;
    final previous = _states[record.sessionId];
    if (kind == 'turn.started' && previous?.turnId == turnId) return;
    final at = DateTime.tryParse(record.createdAt);
    if (previous?.turnId == turnId &&
        ((record.sourceSequence > 0 &&
                record.sourceSequence <= previous!.sequence) ||
            (at != null &&
                previous!.at != null &&
                at.isBefore(previous.at!)))) {
      return;
    }
    if (kind == 'turn.thinking' &&
        (event['active'] is! bool ||
            (_invalidatedAt != null &&
                (at == null || at.isBefore(_invalidatedAt!))))) {
      return;
    }
    final thinking = kind == 'turn.thinking' && event['active'] == true;
    _states[record.sessionId] = (
      turnId: turnId,
      thinking: thinking,
      startedAt: thinking
          ? (previous?.turnId == turnId && previous?.thinking == true
                ? previous!.startedAt
                : at ?? DateTime.now().toUtc())
          : null,
      sequence: record.sourceSequence,
      at: at,
    );
  }

  void forget(String sessionId) => _states.remove(sessionId);

  void retain(Set<String> activeSessions) =>
      _states.removeWhere((id, _) => !activeSessions.contains(id));

  void invalidate() {
    _invalidatedAt = DateTime.now().toUtc();
    for (final id in _states.keys.toList()) {
      final state = _states[id]!;
      _states[id] = (
        turnId: state.turnId,
        thinking: false,
        startedAt: null,
        sequence: state.sequence,
        at: state.at,
      );
    }
  }

  void clear() {
    _states.clear();
    _invalidatedAt = null;
  }
}
