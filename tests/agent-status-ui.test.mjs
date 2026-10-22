import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("[MOB-AGT-003][web] the composer owns the bounded live Agent window", async () => {
  const [page, inlineStatus] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/inline-agent-status.tsx", "utf8"),
  ]);

  const composerWrap = page.indexOf('<div className="composer-wrap">');
  const inlineAgentStatus = page.indexOf("<InlineAgentStatus", composerWrap);
  const composerForm = page.indexOf(
    '<form\n              className="composer"',
    composerWrap,
  );
  assert.ok(composerWrap >= 0 && inlineAgentStatus > composerWrap);
  assert.ok(composerForm > inlineAgentStatus);
  assert.match(
    page,
    /current && inlineAgents\.length > 0[\s\S]*<InlineAgentStatus[\s\S]*agents=\{inlineAgents\}/,
  );
  assert.match(page, /loading=\{agentActivityLoading\}/);
  assert.match(page, /error=\{agentActivityError\}/);
  assert.match(page, /onInspectAgent=\{\(agentId\) =>/);
  assert.match(
    page,
    /agentActivityViewRevision\.current \+= 1;[\s\S]*setInspectedAgentId\(null\);[\s\S]*\}, \[activeSession\]\);/,
  );
  assert.match(
    page,
    /agentActivityViewRevision\.current === viewRevision[\s\S]*setAgentActivityLoading\(false\)/,
  );

  assert.match(inlineStatus, /agents\.slice\(0, 3\)/);
  assert.match(inlineStatus, /className="inline-agent-list"[\s\S]*agents\.map/);
  assert.match(inlineStatus, /const \[expanded, setExpanded\] = useState\(openRequest > 0\)/);
  assert.match(inlineStatus, /openRequest > lastOpenRequest\.current/);
  assert.match(page, /openRequest=\{agentWindowOpenRequest\}[\s\S]*key=\{current\.id\}/);
  assert.doesNotMatch(page, /key=\{`\$\{current\.id\}:\$\{freshActiveAgentSignature\}/);
  assert.match(inlineStatus, /className="inline-agent-window"/);
  assert.match(inlineStatus, /hidden=\{!expanded\}/);
  assert.ok(
    inlineStatus.indexOf('className="inline-agent-window"') <
      inlineStatus.indexOf('className="inline-agent-toggle"'),
    "the detail window must grow upward while the summary remains next to the composer",
  );
  assert.match(inlineStatus, /className="inline-agent-more"/);
  assert.match(inlineStatus, /inlineBackgroundAgents/);
  assert.match(inlineStatus, /setSelectedAgentId\(agent\.id\)/);
  assert.match(inlineStatus, /function InlineAgentDetail/);
  assert.match(inlineStatus, /agent\.activity_log \?\? \[\]/);
  assert.match(inlineStatus, /agent\.tool_count/);
  assert.match(inlineStatus, /agent\.token_count/);
  assert.match(inlineStatus, /agent\.context_tokens/);
  assert.match(inlineStatus, /event\.key !== "Escape"/);
  assert.match(inlineStatus, /role="status" aria-live="polite"/);
  assert.doesNotMatch(inlineStatus, /private reasoning|思维过程|私有推理内容/);
});

test("the Web Agent window stretches in place and stays compact", async () => {
  const css = await readFile("app/workbench.css", "utf8");

  assert.match(
    css,
    /\.inline-agent-window \{[\s\S]*max-height: min\(390px, 44dvh\);[\s\S]*overflow: hidden;/,
  );
  assert.match(css, /\.inline-agent-list \{[\s\S]*max-height: 296px;[\s\S]*overflow-y: auto;/);
  assert.match(css, /animation: inline-agent-window-in/);
  assert.match(css, /transform-origin: bottom center/);
  assert.doesNotMatch(
    css,
    /\.inline-agent-window \{[\s\S]{0,220}position: absolute/,
  );
  assert.match(css, /button\.inline-agent-row[\s\S]*min-height: 98px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.inline-agent-window/);

  // Flutter's agent_activity_test.dart and conversation_approval_test.dart
  // exercise the mobile tray's expansion, scrolling, live updates, and sizing.
});

test("Agents navigation and manual delegation are removed from both clients", async () => {
  const [page, mobile] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("mobile/lib/src/ui/workbench_screen.dart", "utf8"),
  ]);

  assert.doesNotMatch(page, /type RightPanelTab/);
  assert.doesNotMatch(page, /right-panel-agents|agents-content|agent-launcher/);
  assert.doesNotMatch(page, /delegateInParallel|session\.create_agents/);
  assert.doesNotMatch(page, /AgentActivityDialog|<AgentCard/);
  assert.doesNotMatch(page, /setRightTab\("agents"\)/);

  assert.doesNotMatch(mobile, /class AgentsPage/);
  assert.doesNotMatch(mobile, /workbench-section-agents/);
  assert.doesNotMatch(mobile, /label: Text\('Agents'\)/);
  assert.doesNotMatch(mobile, /class _AgentDelegationDialog/);
  assert.doesNotMatch(mobile, /Text\('委派'\)|委派并行任务/);
  assert.doesNotMatch(mobile, /onOpenAgents/);
  assert.doesNotMatch(mobile, /NavigationRailDestination\(/);
});

test("[MOB-DEV-001][web] device status has no manual refresh control", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");

  assert.doesNotMatch(
    page,
    /workbenchText\(authLocale, "refreshStatus"\)/,
  );
});

test("the local Kimi tasks command opens the composer Agent window", async () => {
  const [page, mobile, relay] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("mobile/lib/src/ui/workbench_screen.dart", "utf8"),
    readFile("relay/mac-relay.mjs", "utf8"),
  ]);

  assert.match(
    page,
    /command\.name === "tasks"[\s\S]*setMobilePanel\("workspace"\)[\s\S]*setAgentWindowOpenRequest/,
  );
  assert.match(page, /command\.advertised[\s\S]*sendKimiNativeCommand/);
  assert.match(page, /sendEncryptedCommand\(\s*"session\.configure"/);
  assert.match(mobile, /command\.name == 'tasks' && !command\.advertised[\s\S]*onOpenAgentWindow\(\)/);
  assert.match(mobile, /_localAgentWindowOpenRequest \+= 1/);
  assert.match(mobile, /onOpenAgentWindow/);
  assert.match(relay, /case "session\.configure"/);
});

test("clicking an Agent loads its encrypted activity into the same window", async () => {
  const [page, inlineStatus, relay] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/inline-agent-status.tsx", "utf8"),
    readFile("relay/mac-relay.mjs", "utf8"),
  ]);

  assert.match(page, /"session\.read_agents"/);
  assert.match(
    page,
    /onInspectAgent=\{\(agentId\) =>[\s\S]*openAgentActivity\(agent\)/,
  );
  assert.match(
    page,
    /inspectedAgentActive[\s\S]*window\.setInterval\([\s\S]*loadAgentActivity/,
  );
  assert.match(inlineStatus, /selectedAgent \? \(/);
  assert.match(inlineStatus, /onBack=\{\(\) => setSelectedAgentId\(null\)\}/);
  assert.match(inlineStatus, /className="inline-agent-detail-timeline"/);
  assert.match(inlineStatus, /agentActivityLabel\(activity, locale\)/);
  assert.match(relay, /case "session\.read_agents"/);
  assert.match(relay, /message\.type === "session\.agents"/);
});
