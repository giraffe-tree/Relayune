import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("当前回复内显示各 Agent 的运行状态，结束后自动移除", async () => {
  const [page, language, styles] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/workbench-language.ts", "utf8"),
    readFile("app/workbench.css", "utf8"),
  ]);

  for (const agentName of ["Codex", "Kimi Code", "Claude Code"]) {
    assert.ok(page.includes(`label: "${agentName}"`));
  }
  assert.match(
    page,
    /<ConversationTurn[\s\S]{0,180}agentName=\{agentName\}[\s\S]{0,180}runningStartedAt=\{runningStartedAt\}[\s\S]{0,220}active=\{/,
  );
  assert.match(
    page,
    /<MessageArticle[\s\S]{0,220}message=\{finalMessage\}[\s\S]{0,260}runningAgentName=\{active \? agentName : undefined\}[\s\S]{0,120}runningStartedAt=\{active \? runningStartedAt : undefined\}/,
  );
  assert.match(
    page,
    /function MessageRunningStatus[\s\S]{0,800}setInterval\(\(\) => setNow\(Date\.now\(\)\), 1_000\)[\s\S]{0,500}className="message-running-status"/,
  );
  assert.match(
    page,
    /role="status" aria-live="polite" aria-atomic="true"[\s\S]{0,300}className="message-running-elapsed" aria-hidden="true"[\s\S]{0,180}workbenchText\(locale, "runningElapsed"/,
  );
  assert.match(page, /workbenchText\(locale, "messageAgentRunning"/);
  assert.match(language, /messageAgentRunning: "\{agent\} is running"/);
  assert.match(language, /messageAgentRunning: "\{agent\} 正在运行"/);
  assert.match(styles, /\.message-running-status\s*\{[\s\S]{0,600}\.message-running-elapsed\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 820px\)[\s\S]*\.message-running-status\s*\{[\s\S]{0,220}min-height: 32px;[\s\S]{0,220}flex-wrap: wrap;[\s\S]{0,220}font-size: 11px/,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.message-running-dot,[\s\S]*animation: none !important/,
  );
});
