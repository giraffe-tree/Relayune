"use client";

import { useEffect } from "react";

const RETURN_FOCUS_KEY = "relayuneMarketingReturnFocus";

function historyState(): Record<string, unknown> {
  const value = window.history.state;
  return value && typeof value === "object"
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function markMarketingReturnFocus() {
  window.history.replaceState(
    { ...historyState(), [RETURN_FOCUS_KEY]: true },
    "",
    window.location.href,
  );
}

export function hasMarketingReturnFocus() {
  return historyState()[RETURN_FOCUS_KEY] === true;
}

function consumeMarketingReturnFocus() {
  const state = historyState();
  if (state[RETURN_FOCUS_KEY] !== true) return false;
  delete state[RETURN_FOCUS_KEY];
  window.history.replaceState(state, "", window.location.href);
  return true;
}

/**
 * Restores keyboard context after the browser returns from the login route.
 * The history marker survives a full navigation and BFCache restoration while
 * carrying no account, pairing, or locale data.
 */
export function useMarketingReturnFocus(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const restore = () => {
      if (!consumeMarketingReturnFocus()) return;
      frame = window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>("#top")?.focus();
      });
    };
    restore();
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("pageshow", restore);
      window.cancelAnimationFrame(frame);
    };
  }, [active]);
}
