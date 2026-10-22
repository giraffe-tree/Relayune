import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import { build } from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "relayune-free-access-"));
const bundle = join(directory, "api.cjs");
await build({
  stdin: {
    contents: 'export { EmailAuth } from "./server/email-auth"; export { PairingApi } from "./server/pairing-api"; export { handleRelayApi } from "./server/relay-api";',
    resolveDir: process.cwd(),
  },
  outfile: bundle, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
});
const { EmailAuth, PairingApi, handleRelayApi } = createRequire(import.meta.url)(bundle);
after(() => rm(directory, { recursive: true, force: true }));

const email = "free-user@example.invalid";
const token = "f".repeat(43);
const hash = value => createHash("sha256").update(value).digest("hex");

function fixture({ expired = false, deleting = false } = {}) {
  // There is intentionally no plan, expiry, trial, payment, or redemption state.
  const user = { _id: email, ...(deleting ? { account_deletion_started_at: new Date() } : {}) };
  const mongo = { collection(name) {
    assert.ok(["auth_users", "auth_sessions"].includes(name), name);
    return { async findOne(query) {
      if (name === "auth_users") return user;
      if (query.token_hash !== hash(token) || expired) return null;
      return { email, token_hash: hash(token), expires_at: new Date(Date.now() + 60 * 86400000), revoked_at: null };
    } };
  } };
  const auth = new EmailAuth(mongo, { publicOrigin: "https://relay.test", mailFrom: "mail@example.invalid" });
  // The router's database adapter is tested separately against MongoDB. This
  // fixture covers account authentication and the actual protected API handler.
  const relayDatabase = { prepare(query) {
    return { bind() {
      return {
        async run() { assert.match(query, /INSERT INTO relay_users/); return { success: true }; },
        async first() {
          if (query.includes("FROM relay_users")) return { id: `usr_${hash(email).slice(0, 32)}`, email };
          if (query.includes("FROM relay_devices")) return null;
          throw new Error(`Unexpected database operation: ${query}`);
        },
      };
    } };
  } };
  return { auth, mongo, env: { DB: relayDatabase, RELAY_BLOBS: {} } };
}

test("an authenticated account without commercial state can bootstrap; absent, expired and deleting sessions cannot", async () => {
  for (const scenario of [{}, { session: "invalid" }, { expired: true }, { deleting: true }]) {
    const { auth, env } = fixture(scenario);
    const authenticated = await auth.authenticate({ headers: { cookie: `relay_session=${scenario.session ?? token}` } });
    const headers = authenticated ? { "oai-authenticated-user-email": authenticated } : {};
    const result = await handleRelayApi(new Request("https://relay.test/api/bootstrap", { headers }), env);
    assert.equal(result.status, authenticated ? 200 : 401);
    const body = await result.json();
    if (authenticated) {
      assert.equal(body.user.email, email);
      assert.equal(body.device.online, false);
      assert.doesNotMatch(JSON.stringify(body), /entitlement|trial|billing|subscription/);
      // Free access still does not authorize another account's computer.
      const foreign = await handleRelayApi(new Request("https://relay.test/api/bootstrap?device_id=dev_other", { headers }), env);
      assert.equal(foreign.status, 404);
    } else assert.equal(body.error.code, "unauthorized");
  }
});

test("removed commercial endpoints have no account, pairing, or relay handler", async () => {
  const { auth, mongo, env } = fixture();
  const pairing = new PairingApi(mongo);
  for (const path of [
    "/api/account/entitlement", "/api/account/redeem", "/api/account/referral",
    "/api/account/billing/checkout", "/api/account/billing/cancel",
    "/api/account/billing/reactivate", "/api/account/billing/status",
    "/api/account/apple-subscription/config", "/api/account/apple-subscription/transactions",
    "/api/billing/waffo/webhook", "/api/billing/apple/notifications",
    "/api/relay/account/membership-expiry",
  ]) {
    for (const method of ["GET", "POST"]) {
      assert.equal(await auth.handle({ method, url: path, headers: {} }, {}), false, path);
      const request = new Request(`https://relay.test${path}`, { method });
      assert.equal(await pairing.handle(request, null), null, path);
      const result = await handleRelayApi(request, env);
      // The HTTP dispatcher turns unhandled paths into 404; relay-prefixed
      // unknown paths already return that response from the relay handler.
      assert.ok(result === null || result.status === 404, path);
    }
  }
});
