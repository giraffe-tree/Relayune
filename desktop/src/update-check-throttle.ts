export const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1_000;
export const UPDATE_CHECK_STORAGE_KEY = "relayune.updater.last-check-at.v1";

type UpdateCheckStorage = Pick<Storage, "getItem" | "setItem">;

export class UpdateCheckThrottle {
  private lastAttemptAt = 0;

  constructor(
    private readonly getStorage: () => UpdateCheckStorage = () =>
      window.localStorage,
    private readonly now: () => number = () => Date.now(),
  ) {
    try {
      const stored = Number(this.getStorage().getItem(UPDATE_CHECK_STORAGE_KEY));
      const current = this.now();
      // A wall-clock correction must not suppress update checks indefinitely.
      if (Number.isFinite(stored) && stored > 0 && stored <= current) {
        this.lastAttemptAt = stored;
      }
    } catch {
      // Some managed WebViews restrict localStorage. The in-memory timestamp
      // still prevents duplicate checks for the lifetime of this process.
    }
  }

  claim(force = false) {
    const current = this.now();
    const elapsed = current - this.lastAttemptAt;
    if (
      !force &&
      this.lastAttemptAt > 0 &&
      elapsed >= 0 &&
      elapsed < UPDATE_CHECK_INTERVAL_MS
    ) {
      return false;
    }

    this.lastAttemptAt = current;
    try {
      this.getStorage().setItem(UPDATE_CHECK_STORAGE_KEY, String(current));
    } catch {
      // The in-memory timestamp above remains authoritative for this process.
    }
    return true;
  }
}
