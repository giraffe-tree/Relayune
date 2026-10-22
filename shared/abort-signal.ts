export interface CombinedAbortSignal {
  signal: AbortSignal;
  dispose: () => void;
}

/**
 * Combine cancellation sources without the signal-combining primitive that
 * first shipped in Safari 17.4. Dispose after the request settles so completed
 * requests do not remain attached to a longer-lived caller signal.
 */
export function combineAbortSignals(
  signals: readonly AbortSignal[],
): CombinedAbortSignal {
  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();

  const dispose = () => {
    for (const [signal, listener] of listeners) {
      signal.removeEventListener("abort", listener);
    }
    listeners.clear();
  };

  for (const signal of signals) {
    if (listeners.has(signal)) continue;
    if (signal.aborted) {
      controller.abort();
      dispose();
      break;
    }
    const listener = () => {
      if (!controller.signal.aborted) controller.abort();
      dispose();
    };
    listeners.set(signal, listener);
    signal.addEventListener("abort", listener, { once: true });
  }

  return { signal: controller.signal, dispose };
}
