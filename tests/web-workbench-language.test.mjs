import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const hasHan = (value) => /\p{Script=Han}/u.test(value);
const placeholders = (value) =>
  [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort();

async function importWorkbenchLanguage() {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-workbench-language-"));
  const outfile = join(temporary, "workbench-language.mjs");
  await build({
    entryPoints: ["app/workbench-language.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return {
    language: await import(`${pathToFileURL(outfile).href}?${Date.now()}`),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

test("paired workspace copy is complete and structurally equivalent in both languages", async () => {
  const bundled = await importWorkbenchLanguage();
  try {
    const { WORKBENCH_COPY_KEYS, workbenchText } = bundled.language;
    assert.ok(Array.isArray(WORKBENCH_COPY_KEYS));
    assert.ok(
      WORKBENCH_COPY_KEYS.length >= 200,
      "the post-pairing workspace needs more than a token set of translated labels",
    );
    assert.equal(
      new Set(WORKBENCH_COPY_KEYS).size,
      WORKBENCH_COPY_KEYS.length,
      "translation keys must be unique",
    );

    for (const required of [
      "openProjectDrawer",
      "projectsAndSessions",
      "refreshHistory",
      "sendToAgent",
      "subagents",
      "approvalBoundary",
      "reliabilityStatus",
      "delegateInParallel",
      "delegatingAgents",
      "localLinkAuthenticated",
      "kimiPanelLabel",
      "networkUnavailable",
      "refreshingStatus",
      "sendingMessage",
      "runningKimiCommand",
      "requestingStop",
      "updatingSessionSetting",
      "messageSendFailed",
      "sessionCreateFailed",
      "desktopPermissionsFuture",
      "customPermissions",
      "permissionsUnconfirmed",
      "permissionsLabel",
      "desktopPermissionsUnconfirmedDetail",
    ]) {
      assert.ok(WORKBENCH_COPY_KEYS.includes(required), `missing critical key ${required}`);
    }

    for (const key of WORKBENCH_COPY_KEYS) {
      const chinese = workbenchText("zh-CN", key);
      const english = workbenchText("en", key);
      assert.ok(chinese.trim(), `${key} needs Chinese copy`);
      assert.ok(english.trim(), `${key} needs English copy`);
      assert.deepEqual(
        placeholders(english),
        placeholders(chinese),
        `${key} must interpolate the same variables in both languages`,
      );
      if (key !== "switchLanguageLabel") {
        assert.equal(
          hasHan(english),
          false,
          `${key} must not leak Chinese into the English workspace`,
        );
      }
    }
  } finally {
    await bundled.cleanup();
  }
});

function sourceRange(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function assertNoBareHan(label, source, allowed = []) {
  let audited = source;
  for (const value of allowed) audited = audited.replaceAll(value, "");
  assert.equal(
    hasHan(audited),
    false,
    `${label} still contains bare Chinese UI copy outside the workbench dictionary`,
  );
}

test("post-pairing components and event fallbacks consume the shared workspace locale", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");
  assert.match(
    page,
    /import \{ workbenchText, type WorkbenchCopyKey \} from "\.\/workbench-language"/,
  );

  const workspaceMarkup = sourceRange(
    page,
    '<main className="app-shell">',
    "function upsertMessage(",
  );
  assert.match(
    workspaceMarkup,
    /<AuthLanguageSwitch locale=\{authLocale\} onToggle=\{toggleAuthLocale\}/,
    "the language switch must remain available after pairing succeeds",
  );
  assert.match(workspaceMarkup, /workbenchText\(authLocale,/);
  assert.doesNotMatch(
    workspaceMarkup,
    /right-panel-agents|agents-content|agent-launcher/,
    "Agents must no longer render as a separate workspace destination",
  );
  assert.doesNotMatch(
    workspaceMarkup,
    />Agents<\/button>|<span>Subagents<\/span>/,
    "paired workspace navigation must not fall back to hard-coded English labels",
  );
  assertNoBareHan("paired workspace markup", workspaceMarkup);

  const pageComponent = sourceRange(
    page,
    "export default function WorkbenchPage()",
    "function upsertMessage(",
  );
  assertNoBareHan("paired workspace handlers", pageComponent, [
    "Codex 与 Kimi",
    "任务。",
    // Compatibility classifier for a legacy server response; never rendered.
    "等待|pending|尚未|不存在|404",
  ]);

  for (const [label, start, end] of [
    ["status, agent, and approval cards", "function SessionStatus(", "function formatApprovalRemaining("],
    ["Kimi commands and settings", "function KimiCommandPanel(", "type ConversationGroup ="],
    ["attachments and conversation turns", "function ImageAttachment(", "function formatTime("],
    ["browser display and encrypted helpers", "function isBrowserAuthorizedPath(", "export default function WorkbenchPage()"],
    ["history author metadata", "function toHistoryMessage(", "function mergeById<"],
  ]) {
    const range = sourceRange(page, start, end);
    assert.match(range, /workbenchText\(/, `${label} must consume localized copy`);
    assertNoBareHan(label, range);
  }

  assert.match(
    page,
    /function formatTime\(value: string \| null, locale: AuthLocale(?: = "zh-CN")?\)/,
    "workspace dates must follow the selected language",
  );
  assert.match(
    page,
    /function formatRunningElapsed\([\s\S]*?locale: AuthLocale[\s\S]*?formatDurationSeconds\(seconds, locale\)/,
    "elapsed-time units must use locale-aware Intl formatting",
  );
});
