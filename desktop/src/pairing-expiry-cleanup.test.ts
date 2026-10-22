import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PairingCancellationQueue } from "./pairing-cancellation";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  vi.useFakeTimers();
  const main = await readFile(new URL("./main.ts", import.meta.url), "utf8");
  const functionSource = (name: string) => {
    const source = main.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?^\\}`, "m"))?.[0];
    if (!source) throw new Error(`Missing ${name}`);
    return source;
  };
  const begin = functionSource("beginPairing");
  const handler = begin.slice(begin.indexOf("  } catch (error) {") + "  } catch (error) {".length, begin.lastIndexOf("\n  }"));
  const final = deferred();
  const cancel = vi.fn(() => final.promise);
  const queue = new PairingCancellationQueue();
  const resetAdmissions: boolean[] = [];
  const context = createContext({
    Date, setInterval, window: { clearInterval },
    pairingCode: "SYNTHETIC", pairingStage: "waiting", pairingSurface: "browser",
    pairingRunId: 1, runId: 1, surface: "browser", browserPairingIdToCancel: "pair_old",
    activePairingId: "pair_old", pairingExpiresAtMs: Date.now(), pairingExpiryTimer: 0,
    pairingAbortController: new AbortController(), PairingCancelledError: class extends Error {},
    pairingOrigins: new Map([["pair_old", "https://synthetic.example.invalid"]]),
    browserPairingCancellations: queue, relayApi: { cancelBrowserPairing: cancel },
    bootstrap: { config: { server_url: "https://synthetic.example.invalid" } },
    minimalInstalled: false, minimalPairingExpired: false,
    invalidatePairingQrCodes: () => {}, updatePairingExpiry: () => {},
    requestNativeLanguageReconciliation: () => { resetAdmissions.push(queue.active); },
    refresh: async () => {}, render: () => {}, showPairingErrorToast: () => {},
    showDesktopErrorToast: () => {}, showTranslatedToast: () => {}, moveFocus: () => {},
    browserPairingEntryAction: () => ({}), loginButton: {},
    pairingErrorPresentation: () => ({}), initialPairingErrorPresentation: null,
  });
  const compiled = ts.transpileModule([
    functionSource("resetPairingState"), functionSource("cancelRemoteBrowserPairing"),
    functionSource("expireCurrentPairing"),
    `async function handleFailure(error) { ${handler} }`,
  ].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  runInContext(compiled, context);
  runInContext("pairingExpiryTimer = setInterval(expireCurrentPairing, 1000)", context);
  return { context, queue, final, cancel, resetAdmissions };
}

afterEach(() => vi.useRealTimers());

describe("pairing expiry and authoritative cancellation ordering", () => {
  it("stops expiry before awaiting final sidecar cleanup and releases the gate afterward", async () => {
    const f = await fixture();
    const pending = f.context.handleFailure(new Error("synthetic expired response"));
    await Promise.resolve();
    expect(f.queue.active).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.context.pairingStage).toBe("idle");
    expect(f.context.pairingExpiryTimer).toBe(0);
    expect(f.resetAdmissions).toEqual([true]);
    f.context.expireCurrentPairing(); // An expiry callback already queued before reset also becomes harmless.
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.queue.active).toBe(true);
    f.final.resolve();
    await pending;
    expect(f.queue.active).toBe(false);
    expect(f.cancel).toHaveBeenCalledTimes(1);
  });

  it("a cancelled old run never resets the newer run's state or expiry timer", async () => {
    const f = await fixture();
    f.context.pairingRunId = 2;
    f.context.activePairingId = "pair_new";
    f.context.pairingCode = "NEW_RUN";
    const timer = f.context.pairingExpiryTimer;
    const pending = f.context.handleFailure(new Error("old native start settled"));
    await Promise.resolve();
    expect(f.queue.active).toBe(true);
    expect(f.context.pairingStage).toBe("waiting");
    expect(f.context.activePairingId).toBe("pair_new");
    expect(f.context.pairingExpiryTimer).toBe(timer);
    expect(f.resetAdmissions).toEqual([]);
    f.final.resolve();
    await pending;
    expect(f.queue.active).toBe(false);
    expect(f.context.pairingCode).toBe("NEW_RUN");
    expect(f.context.pairingExpiryTimer).toBe(timer);
  });

  it("retains the gate after immediate cancellation until late native start and final cleanup settle", async () => {
    const f = await fixture();
    const nativeStart = deferred();
    f.cancel.mockImplementationOnce(async () => {});
    await f.context.cancelRemoteBrowserPairing("pair_old");
    expect(f.queue.active).toBe(true);
    f.context.pairingRunId = 2;
    f.context.resetPairingState();
    const pending = nativeStart.promise.then(() => f.context.handleFailure(new Error("late native start")));
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.queue.active).toBe(true);
    nativeStart.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.cancel).toHaveBeenCalledTimes(2);
    expect(f.queue.active).toBe(true);
    f.final.resolve();
    await pending;
    expect(f.queue.active).toBe(false);
  });
});
