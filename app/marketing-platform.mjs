/**
 * @param {string} userAgent
 * @param {number} [maxTouchPoints]
 * @returns {"mac" | "windows" | "android" | "mobile" | "other"}
 */
export function detectMarketingPlatform(userAgent, maxTouchPoints = 0) {
  if (/Android/i.test(userAgent)) return "android";
  if (
    /iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)
  ) {
    return "mobile";
  }
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "mac";
  return "other";
}

/**
 * Keeps the custom before/after range fully keyboard-operable even in browsers
 * that do not apply native range key steps consistently to an overlaid input.
 * @param {number} current
 * @param {string} key
 * @returns {number | null}
 */
export function comparisonSplitForKey(current, key) {
  const clamp = (value) => Math.min(88, Math.max(12, value));
  if (key === "Home") return 12;
  if (key === "End") return 88;
  if (key === "ArrowRight" || key === "ArrowUp") return clamp(current + 1);
  if (key === "ArrowLeft" || key === "ArrowDown") return clamp(current - 1);
  if (key === "PageUp") return clamp(current + 10);
  if (key === "PageDown") return clamp(current - 10);
  return null;
}
