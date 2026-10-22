import { RELAYUNE_WEB_RELEASE_VERSION } from "./release-assets";

type StoredEntryCredential =
  | { deviceId?: string; browserToken?: string }
  | null
  | undefined;

type WorkbenchEntryDependencies = {
  apiBase?: string;
  fetcher?: typeof fetch;
  loadStoredCredential?: () => Promise<StoredEntryCredential>;
};

// Keep the marketing/auth entry bundle independent of the PAKE implementation.
const PUBLIC_PAIRING_ID_PATTERN = /^pair_[A-Za-z0-9_-]{43}$/;
const PUBLIC_DESKTOP_LOGIN_ID_PATTERN = /^dlogin_[A-Za-z0-9_-]{43}$/;

export type PairingLinkErrorKey =
  | "pairingUsed"
  | "pairingExpired"
  | "pairingMissing";

export type AuthenticationRequest =
  | "emailStatus"
  | "magicLink"
  | "password"
  | "setPassword";

export type AuthenticationErrorKey =
  | "cannotReachRelay"
  | "cannotSendVerification"
  | "loginFailed"
  | "cannotSetPassword"
  | "tooManyAttempts"
  | "invalidCredentials"
  | "passwordSetupExpired";

export function authenticationErrorKey(
  request: AuthenticationRequest,
  status: number,
  code: string,
): AuthenticationErrorKey {
  if (
    status === 0 ||
    code === "network_timeout" ||
    code === "network_unavailable"
  ) {
    return "cannotReachRelay";
  }
  if (status === 429) return "tooManyAttempts";
  if (request === "password" && code === "invalid_credentials") {
    return "invalidCredentials";
  }
  if (request === "setPassword" && code === "invalid_password_setup") {
    return "passwordSetupExpired";
  }
  if (request === "magicLink") return "cannotSendVerification";
  if (request === "password") return "loginFailed";
  if (request === "setPassword") return "cannotSetPassword";
  return "cannotReachRelay";
}

/**
 * Keep one-time pairing failures stable and localizable. Server messages are
 * deliberately not returned because they can change independently of the Web
 * client and should never become user-facing copy.
 */
export function pairingLinkErrorKey(
  status: number,
  code: string,
): PairingLinkErrorKey | null {
  if (code === "pairing_already_used") return "pairingUsed";
  if (code === "pairing_expired") return "pairingExpired";
  if (status === 400 || status === 404 || status === 410) {
    return "pairingMissing";
  }
  return null;
}

export function isBrowserAuthorizationLost(
  status: number,
  code: string | undefined,
) {
  return (
    (status === 401 && code === "browser_unauthorized") ||
    (status === 404 && code === "device_not_found")
  );
}

export function hasAuthenticationEntry(search: string) {
  const parameters = new URLSearchParams(search);
  return (
    parameters.get("login") === "1" ||
    parameters.get("auth") === "set-password" ||
    parameters.has("pair") ||
    parameters.has("desktop_login")
  );
}

export function rootAuthenticationEntryPath(search: string) {
  const parameters = new URLSearchParams(search);
  const target = new URLSearchParams();

  if (parameters.get("login") === "1") target.set("login", "1");
  if (parameters.get("auth") === "set-password") {
    target.set("auth", "set-password");
  }
  if (parameters.has("pair")) {
    const pairingId = parameters.get("pair") ?? "";
    target.set(
      "pair",
      PUBLIC_PAIRING_ID_PATTERN.test(pairingId) ? pairingId : "",
    );
  }
  if (parameters.has("desktop_login")) {
    const requestId = parameters.get("desktop_login") ?? "";
    target.set(
      "desktop_login",
      PUBLIC_DESKTOP_LOGIN_ID_PATTERN.test(requestId) ? requestId : "",
    );
  }
  const query = target.toString();
  return query ? `/?${query}` : null;
}

export async function shouldOpenWorkbench(
  signal: AbortSignal,
  dependencies: WorkbenchEntryDependencies = {},
) {
  const loadStoredCredential =
    dependencies.loadStoredCredential ??
    (async () => {
      const { loadStoredRelayKey } = await import("./e2ee");
      return loadStoredRelayKey();
    });
  let stored: StoredEntryCredential;
  try {
    stored = await loadStoredCredential();
  } catch {
    stored = null;
  }

  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Relay-Client-Version": RELAYUNE_WEB_RELEASE_VERSION,
    "X-Relay-Client-Platform": "web",
  });
  if (stored?.browserToken) {
    headers.set("X-Relay-Browser-Token", stored.browserToken);
  }
  const deviceQuery = stored?.deviceId
    ? `?device_id=${encodeURIComponent(stored.deviceId)}`
    : "";
  const apiBase =
    dependencies.apiBase ?? process.env.NEXT_PUBLIC_RELAY_API_URL ?? "";
  const response = await (dependencies.fetcher ?? fetch)(
    `${apiBase}/api/bootstrap${deviceQuery}`,
    {
      credentials: "include",
      headers,
      signal,
    },
  );
  if (response.ok) return true;
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string };
  };
  return isBrowserAuthorizationLost(response.status, body.error?.code) ||
    isReviewAccountIsolated(response.status, body.error?.code);
}

/** Never discard local credentials until the server confirms session revocation. */
export async function logoutAfterConfirmation(
  requestLogout: () => Promise<unknown>,
  clearLocalSession: () => Promise<void>,
) {
  const result = await requestLogout();
  if (!result || typeof result !== "object" ||
      !("authenticated" in result) || result.authenticated !== false) {
    throw new Error("logout_not_confirmed");
  }
  await clearLocalSession();
}

export function isReviewAccountIsolated(status: number, code: string | undefined) {
  return status === 403 && code === "review_demo_isolated";
}
