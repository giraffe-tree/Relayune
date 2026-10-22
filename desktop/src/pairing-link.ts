export function pairingConnectionUrl(serverUrl: string, pairingId: string) {
  return `${serverUrl.replace(/\/+$/, "")}/?pair=${encodeURIComponent(pairingId)}`;
}

const pairingQrPrefix = "relayune-pairing:v1:";

/**
 * Builds the camera-only handoff shown on the desktop pairing surface.
 *
 * This deliberately is not a URL: the short code must never reach browser
 * history, an HTTP request, analytics, or a server log. The QR is only a
 * machine-readable rendering of the code already visible beside it and is
 * consumed in memory by the native Relayune mobile client.
 */
export function pairingQrPayload(pairingId: string, pairingCode: string) {
  const code = pairingCode.toUpperCase().replace(/[\s-]/g, "");
  if (!/^pair_[A-Za-z0-9_-]{43}$/.test(pairingId)) {
    throw new Error("invalid pairing id");
  }
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code)) {
    throw new Error("invalid pairing code");
  }
  return `${pairingQrPrefix}${pairingId}:${code}`;
}
