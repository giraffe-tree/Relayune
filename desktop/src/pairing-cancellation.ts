export type PairingCancellationResult =
  | { ok: true }
  | { ok: false; error: unknown };

export class PairingCancellationQueue {
  private readonly attempts = new Map<
    string,
    Promise<PairingCancellationResult>
  >();

  constructor(private readonly onActiveChange: () => void = () => {}) {}

  get active() {
    return this.attempts.size > 0;
  }

  enqueue(
    pairingId: string,
    cancel: () => Promise<void>,
    finalAttempt = false,
  ): Promise<PairingCancellationResult> {
    const previous =
      this.attempts.get(pairingId) ??
      Promise.resolve<PairingCancellationResult>({ ok: true });
    const wasActive = this.active;
    const attempt = previous
      .then(async (): Promise<PairingCancellationResult> => {
        try {
          await cancel();
          return { ok: true };
        } catch (error) {
          return { ok: false, error };
        }
      })
      .finally(() => {
        if (finalAttempt && this.attempts.get(pairingId) === attempt) {
          const activeBeforeDelete = this.active;
          this.attempts.delete(pairingId);
          if (activeBeforeDelete !== this.active) this.onActiveChange();
        }
      });
    this.attempts.set(pairingId, attempt);
    if (wasActive !== this.active) this.onActiveChange();
    return attempt;
  }
}
