import { spawn } from "node:child_process";
import { agentSpawnOptions } from "./platform-process.mjs";

export const AGENT_PROVIDERS = ["codex", "kimi", "claude", "claude-cowork", "opencode", "zcode", "mcode"];

export function parseAgentVersion(provider, output) {
  const source = provider === "zcode"
    ? output.split(/\r?\n/).find(line => line.startsWith("zcode-runtime ")) ?? output
    : output;
  return source.match(/\b\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\b/)?.[0] ?? null;
}

export function probeAgentVersion(provider, command) {
  return new Promise(resolve => {
    let child, output = "", settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child?.kill();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ version: null, missing: false }), 3000);
    try {
      child = spawn(command, ["--version"], agentSpawnOptions(command, { stdio: ["ignore", "pipe", "pipe"] }));
      const collect = chunk => { output += chunk.toString(); if (output.length > 16_384) finish({ version: null, missing: false }); };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.once("error", error => finish({ version: null, missing: error.code === "ENOENT" }));
      child.once("close", code => finish({ version: code === 0 ? parseAgentVersion(provider, output) : null, missing: code === 127 || code === 9009 }));
    } catch (error) { finish({ version: null, missing: error.code === "ENOENT" }); }
  });
}

/** Only sanitized versions and state codes enter the encrypted catalog. */
export function createAgentRuntimeInfoReader(adapter, { probe = probeAgentVersion, now = Date.now, ttlMs = 60_000 } = {}) {
  const cache = new Map();
  let inFlight;
  return async () => {
    if (inFlight) return inFlight;
    const entries = adapter?.adapters instanceof Map ? adapter.adapters : new Map([[adapter?.provider ?? (adapter?.codexBin ? "codex" : adapter?.kimiBin ? "kimi" : adapter?.claudeBin ? "claude" : "unknown"), adapter]]);
    const statuses = adapter?.status?.() ?? {};
    const providers = [...new Set([...AGENT_PROVIDERS, ...[...entries.keys()].filter(provider => provider !== "unknown")])];
    inFlight = Promise.all(providers.map(async provider => {
      const runtime = entries.get(provider);
      if (!runtime) return { provider, version: null, status: "not_enabled" };
      const command = runtime.codexBin ?? runtime.kimiBin ?? runtime.claudeBin ?? runtime.command;
      const saved = cache.get(provider);
      let inspected = saved?.value;
      if (!saved || now() - saved.at >= ttlMs || saved.command !== command) {
        inspected = command ? await probe(provider, command).catch(() => ({ version: null, missing: false })) : { version: null, missing: false };
        cache.set(provider, { value: inspected, at: now(), command });
      }
      const state = statuses[provider];
      const ready = state ? state.ready && !state.error : true;
      const running = (runtime.activeTurns?.size ?? runtime.active?.size ?? 0) > 0;
      return { provider, version: inspected.version,
        status: inspected.missing ? "not_installed" : !ready ? "unavailable" : running ? "running" : "ready" };
    })).finally(() => { inFlight = null; });
    return inFlight;
  };
}
