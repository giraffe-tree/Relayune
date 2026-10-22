import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexAppServerAdapter } from "../relay/codex-adapters.mjs";
import { ClaudeCodeAdapter, readClaudeSessionCatalog } from "../relay/claude-adapter.mjs";
import { customSessionTitle } from "../relay/session-titles.mjs";

test("all shipped Web and mobile default names are placeholders", async () => {
  const source = await readFile(new URL("../app/workbench-language.ts", import.meta.url), "utf8");
  for (const [, name] of source.matchAll(/newRemoteSession: "([^"]+)"/g)) {
    assert.equal(customSessionTitle(name), "", name);
  }
  for (const locale of ["en", "zh_CN", "hi", "bn", "es", "fr", "pt", "ar", "ur", "id"]) {
    const arb = JSON.parse(await readFile(new URL(`../mobile/lib/l10n/app_${locale}.arb`, import.meta.url), "utf8"));
    assert.equal(customSessionTitle(arb.workbenchDefaultSessionName), "");
  }
  assert.equal(customSessionTitle("  登录流程修复  "), "登录流程修复");
});

test("Codex never persists a placeholder or display fallback as a custom name", async () => {
  for (const name of ["新建远程会话", "New remote session", undefined]) {
    const adapter = new CodexAppServerAdapter({ workspace: "/tmp/project" });
    const methods = [];
    adapter.request = async (method) => {
      methods.push(method);
      return { thread: { id: "created", preview: "", status: { type: "idle" } } };
    };
    const created = await adapter.createSession({ name });
    assert.ok(created.name);
    await adapter.finalizeSessionCreation(created);
    assert.deepEqual(methods, ["thread/start", "thread/read"]);
  }
});

test("Codex repairs legacy placeholder display and preserves custom names and agent nicknames", () => {
  const adapter = new CodexAppServerAdapter();
  const thread = { id: "old", name: "新建远程会话", preview: "修复登录按钮" };
  assert.equal(adapter.toRelaySession(thread).name, "修复登录按钮");
  assert.equal(adapter.toRelaySession({ ...thread, name: "我的标题" }).name, "我的标题");
  assert.equal(adapter.toRelaySession({ ...thread, name: "", agentNickname: "Reviewer" }).name, "Reviewer");
  assert.equal(adapter.toRelaySession({ ...thread, preview: "" }).name, "新建远程会话");
  assert.equal(adapter.toRelaySession({ id: "empty", name: "", preview: "" }).name, "Codex 会话");
});

test("Claude names new sessions from the first prompt and keeps that name across later turns", async () => {
  for (const name of ["新建远程会话", "New remote session", "我的标题"]) {
    const adapter = new ClaudeCodeAdapter({ catalogReader: async () => [] });
    adapter.handlers = { emitEvent: async () => {} };
    const launchedTitles = [];
    adapter.startTurnProcess = async (metadata) => {
      launchedTitles.push(metadata.title);
      return { writeUserMessage() {} };
    };
    const created = await adapter.createSession({ name });
    await adapter.submitMessage({ sessionId: created.id, requestId: "first", content: "修复登录按钮\n详细说明" });
    adapter.finishTurn(created.id);
    await adapter.submitMessage({ sessionId: created.id, requestId: "second", content: "补充测试" });
    adapter.finishTurn(created.id);
    const expected = name === "我的标题" ? name : "修复登录按钮";
    assert.deepEqual(launchedTitles, [expected, expected]);
    assert.equal((await adapter.listSessions())[0].name, expected);
  }
});

test("Claude catalog ignores old placeholders and uses the latest custom title before summaries", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "relayune-titles-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const directory = join(home, "projects", "project");
  await mkdir(directory, { recursive: true });
  const file = join(directory, "550e8400-e29b-41d4-a716-446655440000.jsonl");
  const records = [
    { type: "custom-title", customTitle: "新建远程会话" },
    { type: "user", cwd: "/tmp/project", message: { content: "检查登录流程" } },
  ];
  const save = () => writeFile(file, records.map((record) => JSON.stringify(record)).join("\n"));
  await save();
  assert.equal((await readClaudeSessionCatalog({ claudeHome: home }))[0].title, "检查登录流程");
  records.push(
    { type: "custom-title", customTitle: "旧名称" },
    { type: "custom-title", customTitle: "用户重命名" },
    { type: "summary", summary: "自动摘要" },
  );
  await save();
  assert.equal((await readClaudeSessionCatalog({ claudeHome: home }))[0].title, "用户重命名");
});
