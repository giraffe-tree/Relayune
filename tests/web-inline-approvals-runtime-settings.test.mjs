import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("active-root approvals render and resolve inside the conversation", async () => {
  const [page, css] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/workbench.css", "utf8"),
  ]);

  assert.match(page, /type Approval = \{[\s\S]{0,180}root_session_id\?: string/);
  assert.match(
    page,
    /session_id: event\.session_id \?\? record\.session_id,[\s\S]{0,100}root_session_id: event\.root_session_id \?\? record\.session_id/,
    "subagent approvals must keep their actual resolving session while retaining root routing",
  );
  assert.match(
    page,
    /function approvalBelongsToRoot[\s\S]{0,800}sourceSession\?\.root_session_id === rootSessionId/,
  );
  assert.match(
    page,
    /allApprovals\.filter\(\(approval\) =>[\s\S]{0,140}approvalBelongsToRoot\(approval, rootSessionId, allSessions\)/,
    "approvals from unrelated roots must stay out of the active conversation",
  );
  assert.match(
    page,
    /className="conversation-approvals"[\s\S]{0,1000}<ApprovalCard/,
    "the existing actionable card belongs in the message scroll",
  );
  assert.match(
    page,
    /function focusConversationApprovals\(\)[\s\S]{0,500}setMobilePanel\("workspace"\)[\s\S]{0,500}approvalSection\.focus\(\)/,
  );
  assert.match(
    page,
    /className="composer-approval-notice"[\s\S]{0,140}onClick=\{focusConversationApprovals\}/,
  );
  assert.match(css, /\.conversation-approvals \{/);
  assert.match(css, /\.approval-conversation-link \{/);
});

test("the web composer hides unsupported runtime settings", async () => {
  const [page, css] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/workbench.css", "utf8"),
  ]);

  assert.match(page, /session_config_options\?: SessionConfigOption\[\]/);
  assert.match(
    page,
    /session_config_options: event\.config_options/,
    "live updates must populate the provider-neutral option field",
  );
  assert.doesNotMatch(page, /RuntimeSettingsPanel/);
  assert.doesNotMatch(page, /runtime-settings-trigger/);
  assert.doesNotMatch(css, /\.runtime-settings-panel/);
  assert.doesNotMatch(css, /\.runtime-settings-trigger/);
  assert.match(
    page,
    /async function configureKimiSession[\s\S]{0,900}sendEncryptedCommand\([\s\S]{0,80}"session\.configure"/,
    "the encrypted protocol remains available for Kimi native session settings",
  );
  assert.match(
    page,
    /async function configureKimiSession[\s\S]*?const response = await waitForEncryptedResponse<[\s\S]*?session\.configure_result[\s\S]*?session_config_options: response\.config_options/,
    "the retained configuration protocol must wait for the encrypted desktop result",
  );
  assert.match(
    page,
    /if \(provider === "kimi"\) \{[\s\S]{0,120}if \(configId === "mode" && \["auto", "yolo"\]\.includes\(value\)\)/,
    "Kimi autonomous modes keep the existing explicit confirmation",
  );
});

test("Claude Cowork uses an isolated provider and the encrypted runtime controls", async () => {
  const [page, css, providers] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/workbench.css", "utf8"),
    readFile("shared/agent-order.ts", "utf8"),
  ]);

  assert.match(
    page,
    /import type \{ AgentProvider \} from "\.\.\/shared\/agent-order"/,
  );
  assert.match(providers, /AGENT_PROVIDER_IDS = \[[^\]]*"claude-cowork"/);
  assert.match(providers, /type AgentProvider = \(typeof AGENT_PROVIDER_IDS\)\[number\]/);
  assert.match(
    page.match(/const AGENT_PROVIDER_OPTIONS[^=]*= \[([\s\S]*?)\n\];/)?.[1] ?? "",
    /\{ id: "claude-cowork", label: "Claude Cowork", shortLabel: "Cowork", icon: "claude" \}/,
  );
  assert.match(
    page,
    /hasSessionSettings =\s*hasKimiCommands \|\| provider === "claude-cowork"/,
  );
  assert.match(
    page,
    /hasSessionSettings && commandPaletteOpen[\s\S]{0,1200}settingsOnly=\{!hasKimiCommands\}/,
    "Cowork should reuse session.configure settings without exposing Kimi commands",
  );
  assert.match(
    page,
    /className=\{`provider-pill \$\{provider\}`\}[\s\S]{0,100}\{agentName\}/,
  );
  assert.match(css, /\.provider-pill\.claude-cowork\s*\{/);
  assert.match(
    page,
    /provider === "claude-cowork"[\s\S]{0,120}configId === "mode"[\s\S]{0,120}"bypassPermissions"/,
    "permission-bypassing Cowork modes require an explicit confirmation",
  );
  assert.match(
    page,
    /const pendingConfigOption = pendingConfirmation[\s\S]{0,300}option\.value === pendingConfirmation\.value/,
  );
  assert.match(
    page,
    /mode: settingsOnly[\s\S]{0,160}pendingConfigOption\?\.name[\s\S]{0,240}settingsOnly[\s\S]{0,120}pendingConfigOption\?\.description/,
    "Cowork confirmation copy must come from the adapter-advertised option",
  );
  assert.match(
    page,
    /isRunning && !supportsSteering[\s\S]{0,220}provider === "kimi"[\s\S]{0,400}"runningStopBeforeSend"/,
    "Cowork must not inherit Kimi-only running hints",
  );
});

test("Claude Cowork reuses existing tasks instead of offering a failing create action", async () => {
  const [page, language] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/workbench-language.ts", "utf8"),
  ]);

  assert.match(
    page,
    /selectedProvider === "claude-cowork" && \([\s\S]{0,180}className="provider-project-note"[\s\S]{0,120}"coworkCreateInDesktop"/,
  );
  assert.match(
    page,
    /selectedProvider !== "claude-cowork" && \([\s\S]{0,180}className="project-add-button"/,
    "the project add button must not render for Cowork",
  );
  assert.match(
    page,
    /async function createSession[\s\S]{0,180}selectedProvider === "claude-cowork"[\s\S]{0,160}"coworkCreateInDesktop"/,
    "the create handler should also fail safely if invoked through stale UI",
  );
  assert.match(
    language,
    /coworkCreateInDesktop: "Create new Cowork tasks in Claude Desktop first\./,
  );
  assert.match(
    language,
    /coworkCreateInDesktop: "请先在 Claude Desktop 创建 Cowork 任务/,
  );
});


test("Codex permission controls use confirmed state and require full-access confirmation", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");
  assert.match(page, /provider === "codex" && !current\?\.is_subagent/);
  assert.match(page, /sessionConfigOptions\.filter\(option => option.id === "permissions"\)/);
  assert.match(page, /provider === "codex" && configId === "permissions" && value === "full"[\s\S]{0,160}setPendingConfigConfirmation/);
  assert.match(page, /workbenchText\(locale, "desktopPermissionsFuture"\)/);
  const language = await readFile("app/workbench-language.ts", "utf8");
  assert.match(language, /desktopPermissionsFuture: "电脑端后续消息采用："/);
  assert.match(language, /desktopPermissionsFuture: "Desktop permissions for future messages: "/);
  assert.match(page, /response\.session_id !== current.id/);
});
