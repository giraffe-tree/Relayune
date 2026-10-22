import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ClaudeCodeAdapter, readClaudeSessionCatalog } from "../relay/claude-adapter.mjs";

for (const provider of ["claude", "claude-cowork"]) {
  test(`${provider} reads a newly persisted first reply without a prior catalog refresh`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), "relayune-first-history-"));
    let catalogReads = 0;
    const adapter = new ClaudeCodeAdapter({
      provider, claudeHome: home, modelCatalogReader: async () => [],
      catalogReader: async (options) => {
        catalogReads++;
        return readClaudeSessionCatalog(options);
      },
    });
    t.after(async () => { await adapter.close(); await rm(home, { recursive: true, force: true }); });
    const session = await adapter.createSession({ cwd: home, name: "First reply" });
    const peer = await adapter.createSession({ cwd: home, name: "Empty peer" });
    assert.deepEqual((await adapter.readHistory({ sessionId: session.id })).messages, []);
    const directory = join(home, "projects", "fixture");
    await mkdir(directory, { recursive: true });
    const records = [
      { type: "user", cwd: home, timestamp: "2026-09-09T08:00:00Z", message: { role: "user", content: "Read the fixture" } },
      { type: "assistant", cwd: home, timestamp: "2026-09-09T08:00:01Z", message: { id: "fixture-reply", role: "assistant", content: [{ type: "text", text: "FIRST_HISTORY_OK" }] } },
    ];
    await writeFile(join(directory, `${session.id}.jsonl`), records.map(JSON.stringify).join("\n") + "\n");
    // The CLI has persisted its transcript; nobody has requested listSessions.
    const history = await adapter.readHistory({ sessionId: session.id });
    assert.deepEqual(history.messages.map(m => [m.role, m.content]), [["user", "Read the fixture"], ["codex", "FIRST_HISTORY_OK"]]);
    const discoveredReads = catalogReads;
    assert.deepEqual((await adapter.readHistory({ sessionId: session.id })).messages, history.messages);
    assert.equal(catalogReads, discoveredReads, "Known transcripts should not rescan the catalog on each history read");
    assert.deepEqual((await adapter.readHistory({ sessionId: peer.id })).messages, [], "Another new session must remain empty");
  });
}

test("first-history discovery errors are not reported as an empty conversation", async (t) => {
  const adapter = new ClaudeCodeAdapter({
    modelCatalogReader: async () => [],
    catalogReader: async () => { throw new Error("Fixture catalog unavailable"); },
  });
  t.after(() => adapter.close());
  const session = await adapter.createSession({ cwd: process.cwd() });
  await assert.rejects(adapter.readHistory({ sessionId: session.id }), /Fixture catalog unavailable/);
});
