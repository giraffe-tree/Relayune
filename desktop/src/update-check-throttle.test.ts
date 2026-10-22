import { describe, expect, it } from "vitest";
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_STORAGE_KEY,
  UpdateCheckThrottle,
} from "./update-check-throttle";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("UpdateCheckThrottle", () => {
  it("admits the first check and enforces the ten-minute boundary", () => {
    let now = 1_000_000;
    const throttle = new UpdateCheckThrottle(memoryStorage, () => now);

    expect(throttle.claim()).toBe(true);
    now += UPDATE_CHECK_INTERVAL_MS - 1;
    expect(throttle.claim()).toBe(false);
    now += 1;
    expect(throttle.claim()).toBe(true);
  });

  it("persists the last attempt across cold starts", () => {
    let now = 2_000_000;
    const storage = memoryStorage();
    expect(new UpdateCheckThrottle(() => storage, () => now).claim()).toBe(true);

    now += 30_000;
    expect(new UpdateCheckThrottle(() => storage, () => now).claim()).toBe(false);
    expect(storage.getItem(UPDATE_CHECK_STORAGE_KEY)).toBe("2000000");
  });

  it("lets a manual check bypass the interval and restart it", () => {
    let now = 3_000_000;
    const throttle = new UpdateCheckThrottle(memoryStorage, () => now);
    expect(throttle.claim()).toBe(true);

    now += 1_000;
    expect(throttle.claim(true)).toBe(true);
    now += UPDATE_CHECK_INTERVAL_MS - 1;
    expect(throttle.claim()).toBe(false);
  });

  it("falls back to process memory when WebView storage is unavailable", () => {
    let now = 4_000_000;
    const unavailableStorage = () => {
      throw new Error("storage unavailable");
    };
    const throttle = new UpdateCheckThrottle(unavailableStorage, () => now);

    expect(throttle.claim()).toBe(true);
    now += 60_000;
    expect(throttle.claim()).toBe(false);
  });

  it("does not let a future persisted timestamp lock checks forever", () => {
    const storage = memoryStorage();
    storage.setItem(UPDATE_CHECK_STORAGE_KEY, "9000000");
    const throttle = new UpdateCheckThrottle(() => storage, () => 5_000_000);

    expect(throttle.claim()).toBe(true);
    expect(storage.getItem(UPDATE_CHECK_STORAGE_KEY)).toBe("5000000");
  });
});
