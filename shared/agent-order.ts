// Account UI preferences contain only public provider IDs, never session data.
export const AGENT_PROVIDER_IDS = ["mcode", "zcode", "opencode", "codex", "kimi", "claude", "claude-cowork", "pi"] as const;
export const DEFAULT_VISIBLE_AGENTS = ["codex", "claude", "kimi"] as const;
export function normalizeVisibleAgents(value: unknown): AgentProvider[] {
  return isAgentOrder(value) ? [...value] : [...DEFAULT_VISIBLE_AGENTS];
}
export function isBetaAgent(id: string): boolean {
  return !(DEFAULT_VISIBLE_AGENTS as readonly string[]).includes(id);
}

export type AgentProvider = (typeof AGENT_PROVIDER_IDS)[number];

export function isAgentOrder(value: unknown): value is AgentProvider[] {
  return Array.isArray(value) && value.length <= AGENT_PROVIDER_IDS.length &&
    value.every((id) => AGENT_PROVIDER_IDS.includes(id)) && new Set(value).size === value.length;
}

export function normalizeAgentOrder(value: unknown): AgentProvider[] {
  const stored = isAgentOrder(value) ? value : [];
  return [...stored, ...AGENT_PROVIDER_IDS.filter((id) => !stored.includes(id))];
}

export function moveAgent(order: readonly AgentProvider[], id: AgentProvider, target: number): AgentProvider[] {
  const next = [...order];
  const from = next.indexOf(id);
  if (from < 0 || target < 0 || target >= next.length) return next;
  next.splice(from, 1);
  next.splice(target, 0, id);
  return next;
}
