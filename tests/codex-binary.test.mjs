import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { resolveCodexBinary } from "../relay/codex-adapters.mjs";

const current = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
const legacy = "/Applications/ChatGPT.app/Contents/Resources/codex";
const home = "/test-home";
const plugin = join(home, ".codex/plugins/.plugin-appserver/codex");
const standalone = join(home, ".codex/packages/standalone/current/bin/codex");

test("Codex uses an updated official standalone package before desktop bundles", () => {
  const available = new Set([standalone, current, legacy, plugin]);
  const options = { platform: "darwin", environment: {}, home, exists: path => available.has(path) };
  assert.equal(resolveCodexBinary(undefined, options), standalone);
  available.delete(standalone);
  assert.equal(resolveCodexBinary(undefined, options), current);
});

test("Codex uses the current desktop binary before older installations", () => {
  const available = new Set([current, legacy, plugin]);
  const options = { platform: "darwin", environment: {}, home, exists: path => available.has(path) };
  assert.equal(resolveCodexBinary(undefined, options), current);
  available.delete(current);
  assert.equal(resolveCodexBinary(undefined, options), legacy);
  available.delete(legacy);
  assert.equal(resolveCodexBinary(undefined, options), plugin);
  available.delete(plugin);
  assert.equal(resolveCodexBinary(undefined, options), "codex");
});

test("explicit Codex choices take priority over bundled binaries", () => {
  const options = { platform: "darwin", environment: { CODEX_BIN: "/env/codex" }, exists: () => true };
  assert.equal(resolveCodexBinary("/configured/codex", options), "/configured/codex");
  assert.equal(resolveCodexBinary(undefined, options), "/env/codex");
});

test("other platforms retain their existing Codex resolution", () => {
  const options = { environment: {}, home, exists: () => true };
  assert.equal(resolveCodexBinary(undefined, { ...options, platform: "win32" }), join(home, ".codex/plugins/.plugin-appserver/codex.exe"));
  assert.equal(resolveCodexBinary(undefined, { ...options, platform: "linux" }), "codex");
});
