export const PAIRING_COMPLETION_HANDOFF_MS = 600;

type PairingCompletionScheduler = (
  callback: () => void,
  delay: number,
) => unknown;

export function waitForPairingCompletionHandoff(
  schedule: PairingCompletionScheduler = (callback, delay) =>
    globalThis.setTimeout(callback, delay),
) {
  return new Promise<void>((resolve) => {
    schedule(() => resolve(), PAIRING_COMPLETION_HANDOFF_MS);
  });
}
