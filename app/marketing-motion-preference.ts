export const MARKETING_MOTION_STORAGE_KEY = "relayune.marketing-motion-paused";

type MotionPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): MotionPreferenceStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function storedMarketingMotionPaused(
  getStorage: () => MotionPreferenceStorage | null = browserStorage,
) {
  try {
    return getStorage()?.getItem(MARKETING_MOTION_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function persistMarketingMotionPaused(
  paused: boolean,
  getStorage: () => MotionPreferenceStorage | null = browserStorage,
) {
  try {
    getStorage()?.setItem(MARKETING_MOTION_STORAGE_KEY, String(paused));
  } catch {
    // The visible pause control stays usable when storage is unavailable.
  }
}
