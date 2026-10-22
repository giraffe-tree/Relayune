import { DISABLED_PERFORMANCE_DIAGNOSTICS } from './performance-diagnostics.mjs';

// This deadline covers registration and the first catalog sync as well as
// Agent initialization. waitUntilReady's timer starts too late to cover them.
export async function startRelay(relay, {
  configureHooks = async () => {},
  timeoutMs = 90_000,
  cleanupTimeoutMs = 2_000,
} = {}) {
  let phase = "local_state";
  const diagnostics = relay.performanceDiagnostics ?? DISABLED_PERFORMANCE_DIAGNOSTICS;
  let finishPhase = diagnostics.startPhase(phase);
  let tracking = true;
  relay.onStartupPhase = value => {
    if (tracking && value !== phase &&
        ["local_state", "agents", "registration", "initial_sync", "polling", "hooks"].includes(value)) {
      finishPhase();
      phase = value;
      finishPhase = diagnostics.startPhase(phase);
      console.log(`relayune:startup_phase:${phase}`);
    }
  };
  try {
    await deadline(async () => {
      await relay.start();
      await relay.waitUntilReady();
      relay.onStartupPhase("hooks");
      await configureHooks();
    }, timeoutMs);
    finishPhase();
    tracking = false;
  } catch (cause) {
    const category = startupFailureCategory(cause);
    if (category) console.error(`Relayune Relay startup cause: ${category}`);
    finishPhase('failed');
    tracking = false;
    // Stop closes the Agent pipes and timers. A broken cleanup must not keep
    // the sidecar alive either; the CLI exits explicitly after this rejects.
    try { await deadline(() => relay.stop(), cleanupTimeoutMs); }
    catch {
      try { await deadline(() => relay.adapter?.close(), cleanupTimeoutMs); } catch {}
    }
    // Only fixed stage names leave the process, never arbitrary API errors.
    throw new Error(`Relayune Relay startup ${cause?.code === "startup_timeout" ? "timed out" : "failed"}: ${phase}`);
  } finally {
    relay.onStartupPhase = undefined;
  }
}

async function deadline(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("Startup deadline exceeded"), { code: "startup_timeout" })), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Only fixed categories may cross the child/desktop diagnostic boundary.
export function startupFailureCategory(error) {
  if (error?.status === 401 || error?.status === 403) return "unauthorized";
  if (error?.status === 429 || error?.status >= 500 && error?.status <= 599) return "server";
  if (error?.code === "startup_timeout" || error?.name === "TimeoutError") return "timeout";
  if (["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(error?.code ?? error?.cause?.code) ||
      error instanceof TypeError && error.message === "fetch failed") return "network";
  return null;
}
