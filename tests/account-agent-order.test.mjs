import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";

const temporary = await mkdtemp(join(tmpdir(), "relayune-agent-order-"));
after(() => rm(temporary, { recursive: true, force: true }));
await build({ entryPoints: ["server/email-auth.ts", "shared/agent-order.ts"], bundle: true, platform: "node", format: "cjs", outdir: temporary, logLevel: "silent" });
const { EmailAuth } = await import(pathToFileURL(join(temporary, "server/email-auth.js")).href);
const { AGENT_PROVIDER_IDS, normalizeAgentOrder, moveAgent } = await import(pathToFileURL(join(temporary, "shared/agent-order.js")).href);
const tokenA = "a".repeat(48);
const tokenB = "b".repeat(48);
const digest = (value) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const users = new Map([
    ["a@example.com", { _id: "a@example.com", password_hash: "untouched", preferences: { theme: "dark" } }],
    ["b@example.com", { _id: "b@example.com", preferences: {} }],
  ]);
  const writes = [];
  const db = { collection(name) {
    if (name === "auth_sessions") return { async findOne(query) {
      const email = query.token_hash === digest(tokenA) ? "a@example.com" : query.token_hash === digest(tokenB) ? "b@example.com" : null;
      return email ? { email, expires_at: new Date(Date.now() + 60 * 86400000), revoked_at: null } : null;
    } };
    if (name === "auth_users") return {
      async findOne(query) { return structuredClone(users.get(query._id) ?? null); },
      async updateOne(query, update) {
        writes.push({ query, update });
        const user = users.get(query._id) ?? { _id: query._id, preferences: {} };
        for (const [key, value] of Object.entries(update.$set)) user.preferences[key.split(".")[1]] = structuredClone(value);
        users.set(query._id, user);
      },
    };
    return {};
  } };
  const auth = new EmailAuth(db, { publicOrigin: "https://relay.test", mailFrom: "relay@example.com" });
  async function call(method, body, { token = tokenA, origin = "https://relay.test", raw } = {}) {
    const request = Readable.from(raw !== undefined ? [Buffer.from(raw)] : body !== undefined ? [Buffer.from(JSON.stringify(body))] : []);
    request.method = method;
    request.url = "/api/account/agent-order";
    request.headers = { origin, cookie: token ? `relay_session=${token}` : "" };
    const response = { status: 0, headers: {}, body: "", writeHead(status, headers) { this.status = status; this.headers = headers; }, end(value) { this.body = JSON.parse(value); } };
    assert.equal(await auth.handle(request, response), true);
    return response;
  }
  return { call, writes, users };
}

test("account order defaults, persists across clients, and preserves unrelated fields", async () => {
  const { call, writes, users } = fixture();
  assert.deepEqual((await call("GET")).body.agent_order, AGENT_PROVIDER_IDS);
  const next = ["kimi", "codex", "claude", "mcode", "zcode", "opencode", "claude-cowork", "pi"];
  assert.equal((await call("PUT", { agent_order: next })).status, 200);
  assert.deepEqual((await call("GET")).body.agent_order, next);
  assert.deepEqual((await call("GET", undefined, { token: tokenB })).body.agent_order, AGENT_PROVIDER_IDS);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].query, { _id: "a@example.com" });
  assert.deepEqual(Object.keys(writes[0].update.$set), ["preferences.agent_order"]);
  assert.equal(users.get("a@example.com").password_hash, "untouched");
  assert.equal(users.get("a@example.com").preferences.theme, "dark");
});

test("older saved orders append newly supported agents without losing the chosen order", async () => {
  const { call } = fixture();
  assert.deepEqual((await call("PUT", { agent_order: ["claude", "codex"] })).body.agent_order,
    ["claude", "codex", "mcode", "zcode", "opencode", "kimi", "claude-cowork", "pi"]);
  assert.deepEqual(normalizeAgentOrder(["unknown"]), AGENT_PROVIDER_IDS);
  assert.deepEqual(moveAgent(AGENT_PROVIDER_IDS, "codex", 0), ["codex", "mcode", "zcode", "opencode", "kimi", "claude", "claude-cowork", "pi"]);
  assert.deepEqual(moveAgent(AGENT_PROVIDER_IDS, "zcode", -1), AGENT_PROVIDER_IDS);
});

test("rejects malformed orders, unknown fields and attempts to select another account", async () => {
  const { call, writes } = fixture();
  for (const body of [null, [], {}, { agent_order: "codex" }, { agent_order: ["codex", "codex"] }, { agent_order: ["unknown"] }, { agent_order: [{ $ne: null }] }, { agent_order: ["codex"], email: "b@example.com" }, { agent_order: Array(7).fill("codex") }]) {
    assert.equal((await call("PUT", body)).status, 400, JSON.stringify(body));
  }
  await assert.rejects(call("PUT", undefined, { raw: "{" }), { status: 400 });
  await assert.rejects(call("PUT", undefined, { raw: " ".repeat(32769) }), { status: 413 });
  assert.equal(writes.length, 0);
});

test("requires a session, same-origin writes, and supported methods; responses are not cached", async () => {
  const { call, writes } = fixture();
  for (const method of ["GET", "PUT"]) {
    assert.equal((await call(method, method === "PUT" ? { agent_order: [] } : undefined, { token: "" })).status, 401);
    assert.equal((await call(method, method === "PUT" ? { agent_order: [] } : undefined, { token: "c".repeat(48) })).status, 401);
  }
  for (const origin of ["", "https://other.test"]) await assert.rejects(call("PUT", { agent_order: [] }, { origin }), { status: 403 });
  assert.equal((await call("POST", { agent_order: [] })).status, 405);
  assert.equal((await call("GET")).headers["Cache-Control"], "no-store");
  assert.equal(writes.length, 0);
});

test("visibility defaults to stable agents and updates independently from ordering", async () => {
  const {call} = fixture();
  assert.deepEqual((await call("GET")).body.visible_agents, ["codex", "claude", "kimi"]);
  assert.deepEqual((await call("PUT", {visible_agents:["pi", "codex"]})).body.visible_agents, ["pi", "codex"]);
  await call("PUT", {agent_order:["kimi"]});
  assert.deepEqual((await call("GET")).body.visible_agents, ["pi", "codex"]);
  assert.deepEqual((await call("PUT", {visible_agents:["mcode"]})).body.visible_agents, ["mcode"]);
  assert.deepEqual((await call("PUT", {visible_agents:[]})).body.visible_agents, []);
  assert.equal((await call("PUT", {visible_agents:["unknown"]})).status, 400);
  assert.equal((await call("PUT", {visible_agents:["pi", "pi"]})).status, 400);
  assert.deepEqual((await call("GET", undefined, {token:tokenB})).body.visible_agents, ["codex", "claude", "kimi"]);
});
