import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("session list binds a stateful SVG to structured Agent activity", async () => {
  const [page, icon, runningState, css] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/session-activity-icon.tsx", "utf8"),
    readFile("app/session-running-state.mjs", "utf8"),
    readFile("app/workbench.css", "utf8"),
  ]);

  assert.match(page, /const sessionRunning = isSessionRunning\(/);
  assert.doesNotMatch(page, /const \[runningMap,/);
  assert.match(
    page,
    /function isSessionRunning\(session: Session\) \{\s*return isSessionStatusRunning\(session\);\s*\}/,
  );
  assert.match(
    page,
    /<SessionActivityIcon[\s\S]{0,100}running=\{sessionRunning\}/,
  );
  assert.match(page, /data-agent-running=\{sessionRunning\}/);
  assert.doesNotMatch(
    runningState,
    /session\?\.(?:name|title)|进行中|运行中|\[Running\]/i,
  );
  assert.match(runningState, /session\?\.status === "active"/);

  assert.match(icon, /running \? \(/);
  assert.match(icon, /session-activity-orbit/);
  assert.match(icon, /session-activity-bubble/);
  assert.match(icon, /role="img"/);
  assert.match(icon, /aria-label=\{label\}/);

  assert.match(css, /@keyframes session-activity-orbit/);
  assert.match(css, /@keyframes session-activity-pulse/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.session-activity-orbit,[\s\S]*\.session-activity-core,[\s\S]*animation: none !important/,
  );
});

test("mobile session hierarchy stays compact while preserving readable titles", async () => {
  const css = await readFile("app/workbench.css", "utf8");
  const mobile = css.slice(css.indexOf("@media (max-width: 820px)"));

  assert.match(mobile, /width: min\(calc\(100vw - 24px\), 380px\)/);
  assert.match(mobile, /\.project-section-label \{[\s\S]{0,120}min-height: 40px/);
  assert.match(mobile, /\.session-item \{[\s\S]{0,180}min-height: 58px/);
  assert.match(mobile, /\.session-copy strong \{[\s\S]{0,240}-webkit-line-clamp: 2/);
  assert.match(mobile, /\.relay-card \.relay-meter,[\s\S]{0,80}display: none/);
});
