import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";

const bundleDirectory = await mkdtemp(join(tmpdir(), "relayune-mongo-store-test-"));
const bundlePath = join(bundleDirectory, "mongo-store.cjs");
await build({
  entryPoints: ["server/mongo-store.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: bundlePath,
});
const { MongoStore } = createRequire(import.meta.url)(bundlePath);

test.after(async () => {
  await rm(bundleDirectory, { recursive: true, force: true });
});

test("MongoStore resolves Relay device owners by user id", async () => {
  const calls = [];
  const database = {
    collection(name) {
      assert.equal(name, "relay_users");
      return {
        async findOne(filter, options) {
          calls.push({ filter, options });
          return filter.id === "usr_owner"
            ? { id: "usr_owner", email: "owner@example.com" }
            : null;
        },
      };
    },
  };
  const store = new MongoStore(database);
  const statement = store
    .prepare("SELECT id, email FROM relay_users WHERE id = ?")
    .bind("usr_owner");

  assert.deepEqual(await statement.first(), {
    id: "usr_owner",
    email: "owner@example.com",
  });
  assert.deepEqual(calls, [
    {
      filter: { id: "usr_owner" },
      options: { projection: { _id: 0, id: 1, email: 1 } },
    },
  ]);

  assert.equal(
    await store
      .prepare("SELECT id, email FROM relay_users WHERE id = ?")
      .bind("usr_missing")
      .first(),
    null,
  );
});


test("MongoStore updates the authenticated client version without touching other grants", async () => {
  const calls = [];
  const store = new MongoStore({
    collection(name) {
      assert.equal(name, "relay_browser_authorizations");
      return {
        async updateOne(filter, update) {
          calls.push({ filter, update });
          return { matchedCount: 1 };
        },
      };
    },
  });
  await store.prepare(`UPDATE relay_browser_authorizations
    SET last_seen_at = ?, client_version = ?
    WHERE id = ? AND revoked_at IS NULL`).bind(1234, "0.3.20+30", "web_test").run();
  await store.prepare(`UPDATE relay_browser_authorizations
    SET last_seen_at = ?
    WHERE id = ? AND revoked_at IS NULL`).bind(1235, "web_test").run();
  assert.deepEqual(calls, [
    { filter: { id: "web_test", revoked_at: null }, update: { $set: { last_seen_at: 1234, client_version: "0.3.20+30" } } },
    { filter: { id: "web_test", revoked_at: null }, update: { $set: { last_seen_at: 1235 } } },
  ]);
});
