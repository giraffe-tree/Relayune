import type { AgentRuntimeStatus, RelayProvider } from "./types";

export type AgentRuntimeAction = "install" | "login" | null;

export function agentRuntimeAction(
  status: AgentRuntimeStatus,
): AgentRuntimeAction {
  if (status === "ready") return null;
  if (status === "not_logged_in") return "login";
  return "install";
}

export function agentRuntimeTone(
  status: AgentRuntimeStatus,
): "ready" | "warning" | "danger" {
  if (status === "ready") return "ready";
  if (status === "not_logged_in") return "warning";
  return "danger";
}

/** Shared compact marks for the home overview and agent management. */
export function agentBrandMark(provider: RelayProvider): string {
  return { codex: "⌘", claude: "✳", kimi: "K", opencode: "▣", zcode: "Z", mcode: "M" }[provider];
}
