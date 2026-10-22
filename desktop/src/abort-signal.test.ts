import { describe, expect, it, vi } from "vitest";
import { combineAbortSignals } from "../../shared/abort-signal";

describe("combineAbortSignals", () => {
  it("aborts when either source aborts", () => {
    const caller = new AbortController();
    const timeout = new AbortController();
    const combined = combineAbortSignals([caller.signal, timeout.signal]);

    expect(combined.signal.aborted).toBe(false);
    timeout.abort();
    expect(combined.signal.aborted).toBe(true);
  });

  it("starts aborted when a source was already cancelled", () => {
    const caller = new AbortController();
    caller.abort();

    expect(combineAbortSignals([caller.signal]).signal.aborted).toBe(true);
  });

  it("removes source listeners after a request settles", () => {
    const caller = new AbortController();
    const timeout = new AbortController();
    const callerRemove = vi.spyOn(caller.signal, "removeEventListener");
    const timeoutRemove = vi.spyOn(timeout.signal, "removeEventListener");
    const combined = combineAbortSignals([caller.signal, timeout.signal]);

    combined.dispose();

    expect(callerRemove).toHaveBeenCalledOnce();
    expect(timeoutRemove).toHaveBeenCalledOnce();
    caller.abort();
    expect(combined.signal.aborted).toBe(false);
  });
});
