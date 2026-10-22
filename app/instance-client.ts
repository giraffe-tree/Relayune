export type InstanceCapabilities = {
  schema_version: 1;
  auth_mode: "email" | "username";
  setup_required: boolean;
  registration_enabled?: boolean;
  account_deletion_enabled?: boolean;
};

export type InstanceUser = {
  email: string | null;
  username?: string;
  account_id?: string;
  display_name?: string;
  auth_mode?: "email" | "username";
};

export function instanceUserLabel(user: InstanceUser) {
  return user.display_name || user.username || user.email || "";
}

// Browser keys and cookies belong to this origin. Native clients have a separate,
// explicit instance-switch flow; a Web build must never transplant them by changing
// a public build variable or following an authentication redirect.
export function sameOriginApiUrl(path: string, apiBase: string, pageOrigin: string) {
  const base = new URL(apiBase || pageOrigin, pageOrigin);
  const loopback = base.hostname === "localhost" || base.hostname === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(base.hostname);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) {
    throw new Error("instance_https_required");
  }
  if (base.origin !== pageOrigin || base.username || base.password || base.search || base.hash ||
      !path.startsWith("/api/") || path.startsWith("//")) {
    throw new Error("instance_origin_mismatch");
  }
  const target = new URL(`${apiBase}${path}`, pageOrigin);
  if (target.origin !== pageOrigin) throw new Error("instance_origin_mismatch");
  return target.href;
}

export function parseInstanceCapabilities(value: unknown): InstanceCapabilities {
  if (!value || typeof value !== "object") throw new Error("instance_invalid_response");
  const item = value as Record<string, unknown>;
  if (item.schema_version !== 1 || (item.auth_mode !== "email" && item.auth_mode !== "username") ||
      typeof item.setup_required !== "boolean") throw new Error("instance_invalid_response");
  return {
    schema_version: 1,
    auth_mode: item.auth_mode as InstanceCapabilities["auth_mode"],
    setup_required: item.setup_required,
    ...(typeof item.registration_enabled === "boolean" ? { registration_enabled: item.registration_enabled } : {}),
    ...(typeof item.account_deletion_enabled === "boolean" ? { account_deletion_enabled: item.account_deletion_enabled } : {}),
  };
}

export async function discoverInstance(
  apiBase: string,
  pageOrigin: string,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<InstanceCapabilities> {
  const response = await request(sameOriginApiUrl("/api/instance", apiBase, pageOrigin), {
    credentials: "omit", redirect: "error", cache: "no-store", signal,
  });
  // Only the known official origin may be an older email-only server. Unknown
  // instances must identify their authentication mode before showing credentials.
  if (response.status === 404 && pageOrigin === "https://relayune.giraffetree.cn") {
    return { schema_version: 1, auth_mode: "email", setup_required: false };
  }
  if (!response.ok) throw new Error("instance_unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("instance_invalid_response");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 16 * 1024) throw new Error("instance_invalid_response");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return parseInstanceCapabilities(JSON.parse(new TextDecoder().decode(bytes)));
}
