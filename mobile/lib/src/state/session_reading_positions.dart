/// In-memory reading positions, scoped to the signed-in home surface.
/// No conversation identifiers or offsets are persisted or sent to the server.
class SessionReadingPosition {
  const SessionReadingPosition({required this.offset, required this.atTail});
  final double offset;
  final bool atTail;
}

class SessionReadingPositions {
  final Map<String, SessionReadingPosition> _positions = {};
  int handledNavigationRevision = 0;

  void clear() {
    _positions.clear();
    handledNavigationRevision = 0;
  }

  SessionReadingPosition? forSession(String id) => _positions[id];

  void save(String id, {required double offset, required bool atTail}) {
    _positions.remove(id);
    _positions[id] = SessionReadingPosition(offset: offset, atTail: atTail);
    if (_positions.length > 64) _positions.remove(_positions.keys.first);
  }
}
