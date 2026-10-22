import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "relayune-agent-completion-"));
after(() => rm(directory, { recursive: true, force: true }));
const outfile = join(directory, "render.mjs");
await build({
  stdin: {
    contents: `import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import InlineAgentStatus from "./app/inline-agent-status";
      export const render = (agents) => renderToStaticMarkup(React.createElement(InlineAgentStatus, { agents, locale: "zh-CN", openRequest: 1 }));`,
    resolveDir: process.cwd(),
  },
  outfile, bundle: true, platform: "node", format: "esm",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const { render } = await import(pathToFileURL(outfile));
const agent = (status, name) => ({ id: name, name, task: `${name} 的任务`, status });

test("completed work retains an inspectable record at the composer", () => {
  const html = render([agent("completed", "设计")]);
  assert.match(html, /settled/);
  assert.match(html, /1 项 Agent 工作记录/);
  assert.match(html, /设计/);
  assert.match(html, /查看结果与状态/);
});

test("mixed failures and completions are records, not a fabricated all-success state", () => {
  const html = render([agent("completed", "设计"), agent("errored", "验证")]);
  assert.match(html, /2 项 Agent 工作记录/);
  assert.match(html, /失败/);
  assert.doesNotMatch(html, /全部完成|全部成功/);
});

test("active count excludes completed work but both remain inspectable", () => {
  const html = render([agent("running", "验证"), agent("completed", "设计")]);
  assert.match(html, /1 个子 Agent/);
  assert.match(html, /设计/);
  assert.match(html, /验证/);
});

test("a session with no subagents has no empty tray", () => assert.equal(render([]), ""));


test("completed duration does not inherit a running sibling's later update", () => {
  const html = render([
    { ...agent("completed", "设计"), started_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:01:00Z" },
    { ...agent("running", "验证"), started_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:10:00Z" },
  ]);
  assert.match(html, /设计[\s\S]*?<time[^>]*>已运行 1分钟<\/time>/);
});
