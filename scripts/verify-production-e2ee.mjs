import { randomUUID } from "node:crypto";
import { openJson, sealJson } from "../relay/e2ee.mjs";

// Online verification must name its target explicitly, even when credentials
// happen to be inherited from the invoking shell.
const origin = required("RELAY_SERVER_URL");
const deviceId = required("RELAY_DEVICE_ID");
const browserToken = required("RELAY_BROWSER_TOKEN");
const webCookie = required("RELAY_WEB_COOKIE");
const e2eeKey = required("RELAY_E2EE_KEY");

const webHeaders = {
  Cookie: `relay_session=${webCookie}`,
  "X-Relay-Browser-Token": browserToken,
};
const api = async (path, options = {}) => {
  const response = await fetch(new URL(path, origin), {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...webHeaders,
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      body?.error?.message || `Production Relay request failed (${response.status}).`,
    );
  }
  return body;
};

const bootstrap = await api(
  `/api/bootstrap?device_id=${encodeURIComponent(deviceId)}`,
);
if (bootstrap.protocol_version !== 2 || !bootstrap.device?.online) {
  throw new Error("Production Mac Relay is not online with protocol v2.");
}
if (!bootstrap.catalog) throw new Error("Encrypted session catalog is unavailable.");

const catalog = await openJson(
  e2eeKey,
  bootstrap.catalog.envelope,
  bootstrap.catalog.aad,
);
const requestedSessionId = process.env.RELAY_VERIFY_SESSION_ID;
const session = requestedSessionId
  ? catalog.sessions?.find((candidate) => candidate.id === requestedSessionId)
  : catalog.sessions?.[0];
if (!session?.id) {
  throw new Error(
    requestedSessionId
      ? "The requested agent session is not available for E2EE verification."
      : "No agent session is available for E2EE verification.",
  );
}

const requestId = `verify_${randomUUID()}`;
const issuedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + 120_000).toISOString();
const type = "session.read_history";
const aad = {
  direction: "web_to_relay",
  type,
  device_id: deviceId,
  session_id: session.id,
  request_id: requestId,
  event_seq: null,
  created_at: issuedAt,
  expires_at: expiresAt,
};
const command = {
  type,
  request_id: requestId,
  device_id: deviceId,
  session_id: session.id,
  payload: {
    limit: 1,
    before: null,
    proof_canary: `plaintext_${randomUUID()}`,
  },
  issued_at: issuedAt,
  expires_at: expiresAt,
};

await api("/api/commands", {
  method: "POST",
  headers: { "Idempotency-Key": requestId },
  body: JSON.stringify({
    device_id: deviceId,
    session_id: session.id,
    request_id: requestId,
    command_type: type,
    created_at: issuedAt,
    expires_at: expiresAt,
    aad,
    envelope: await sealJson(e2eeKey, command, aad),
  }),
});

let responseFrame;
for (let attempt = 0; attempt < 240; attempt += 1) {
  const response = await fetch(
    new URL(`/api/responses/${encodeURIComponent(requestId)}`, origin),
    { headers: { Accept: "application/json", ...webHeaders } },
  );
  if (response.ok) {
    responseFrame = await response.json();
    break;
  }
  if (response.status !== 404) {
    throw new Error(`Encrypted response polling failed (${response.status}).`);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!responseFrame) throw new Error("Timed out waiting for the encrypted response.");

const decrypted = await openJson(
  e2eeKey,
  responseFrame.envelope,
  responseFrame.aad,
);
if (decrypted.type !== "session.history") {
  throw new Error(
    decrypted.error ||
      `Unexpected encrypted response type: ${decrypted.type}`,
  );
}

console.log(JSON.stringify({
  ok: true,
  protocol_version: bootstrap.protocol_version,
  device_online: bootstrap.device.online,
  command_type: type,
  response_type: decrypted.type,
  decrypted_message_count: decrypted.messages?.length ?? 0,
}));

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
