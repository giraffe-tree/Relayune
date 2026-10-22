const defaultAgentOrder = [
  'codex',
  'claude',
  'kimi',
  'mcode',
  'zcode',
  'opencode',
  'claude-cowork',
  'pi',
];

/// Retain saved positions and append newly supported agents in default order.
List<String> normalizeAgentOrder(Object? saved) => List.unmodifiable({
  if (saved is List)
    for (final id in saved)
      if (id is String && defaultAgentOrder.contains(id)) id,
  ...defaultAgentOrder,
});

const defaultVisibleAgents = ['codex', 'claude', 'kimi'];
List<String> normalizeVisibleAgents(Object? saved) =>
    saved is List &&
        saved.every((id) => id is String && defaultAgentOrder.contains(id))
    ? List.unmodifiable(saved.cast<String>().toSet())
    : defaultVisibleAgents;
bool isBetaAgent(String id) => !defaultVisibleAgents.contains(id);
const agentLabels = {
  'codex': 'Codex',
  'claude': 'Claude Code',
  'kimi': 'Kimi Code',
  'mcode': 'MiniMax Code',
  'zcode': 'ZCode',
  'opencode': 'OpenCode',
  'claude-cowork': 'Claude Cowork',
  'pi': 'Pi',
};
