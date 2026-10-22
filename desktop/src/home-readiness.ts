import type { AgentRuntimeAvailability, AgentRuntimeStatus, Bootstrap, RelayProvider } from "./types";

export interface HomeReadiness {
  kind: "sign-in" | "first-device" | "relay" | "checking" | "check-failed" | "agent" | "ready";
  tone: "success" | "pending" | "danger";
  provider?: RelayProvider;
  agentStatus?: AgentRuntimeStatus;
}

/** A multi-agent desktop is usable when any available provider can run tasks. */
export function resolveHomeReadiness(input: {
  bootstrap: Bootstrap;
  agents: readonly AgentRuntimeAvailability[];
  checking: boolean;
  failed: boolean;
}): HomeReadiness {
  const { bootstrap: value, agents, checking, failed } = input;
  if (!value.secrets.device_token) return { kind: "sign-in", tone: "pending" };
  if (!value.secrets.e2ee_key && value.config.browser_ids.length === 0) {
    return { kind: "first-device", tone: "pending" };
  }
  if (value.relay.phase !== "connected") {
    return { kind: "relay", tone: value.relay.phase === "error" ? "danger" : "pending" };
  }
  if (failed) return { kind: "check-failed", tone: "pending" };
  if (checking || agents.length === 0) return { kind: "checking", tone: "pending" };
  if (value.config.adapter === "multi" && agents.some(agent => agent.status === "ready")) {
    return { kind: "ready", tone: "success" };
  }
  const provider = value.config.adapter === "multi"
    ? agents.find(agent => agent.status === "not_logged_in")?.provider ?? agents[0]?.provider
    : value.config.adapter;
  const selected = agents.find(agent => agent.provider === provider);
  if (!selected) return { kind: "check-failed", tone: "pending", provider };
  if (selected.status !== "ready") {
    return { kind: "agent", tone: "pending", provider, agentStatus: selected.status };
  }
  return { kind: "ready", tone: "success" };
}
