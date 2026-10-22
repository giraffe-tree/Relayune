import { describe, expect, it } from "vitest";
import { resolveHomeReadiness } from "./home-readiness";
import type { Bootstrap, AgentRuntimeAvailability } from "./types";

const bootstrap = {
  config: { adapter: "multi", default_provider: "kimi", browser_ids: ["client"] },
  secrets: { device_token: true, e2ee_key: false },
  relay: { phase: "connected" },
} as Bootstrap;
const agents = [
  { provider: "kimi", status: "ready" },
  { provider: "codex", status: "not_installed" },
] as AgentRuntimeAvailability[];
const base = { bootstrap, agents, checking: false, failed: false };

describe("home task readiness", () => {
  it("does not require optional providers or legacy global keys", () => {
    expect(resolveHomeReadiness(base).kind).toBe("ready");
  });
  it("does not require an implicit default when another provider works", () => {
    const result = resolveHomeReadiness({ ...base, bootstrap: { ...bootstrap, config: { ...bootstrap.config, default_provider: "codex" } } });
    expect(result).toMatchObject({ kind: "ready" });
  });
  it("uses the active single adapter rather than an inactive default", () => {
    expect(resolveHomeReadiness({ ...base, bootstrap: { ...bootstrap, config: { ...bootstrap.config, adapter: "codex" } } }).kind).toBe("agent");
  });
  it("never shows ready for unknown or failed checks", () => {
    expect(resolveHomeReadiness({ ...base, checking: true }).kind).toBe("checking");
    expect(resolveHomeReadiness({ ...base, failed: true }).kind).toBe("check-failed");
    expect(resolveHomeReadiness({ ...base, agents: [] }).kind).toBe("checking");
  });
  it("distinguishes login and the first independent client authorization", () => {
    expect(resolveHomeReadiness({ ...base, bootstrap: { ...bootstrap, secrets: { ...bootstrap.secrets, device_token: false } } }).kind).toBe("sign-in");
    expect(resolveHomeReadiness({ ...base, bootstrap: { ...bootstrap, config: { ...bootstrap.config, browser_ids: [] } } }).kind).toBe("first-device");
  });
  it("does not call a disconnected relay ready even with a working agent", () => {
    expect(resolveHomeReadiness({ ...base, bootstrap: { ...bootstrap, relay: { ...bootstrap.relay, phase: "error" } } })).toEqual({ kind: "relay", tone: "danger" });
  });
});
