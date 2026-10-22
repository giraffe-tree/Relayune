#!/usr/bin/env node
import { installFatalDiagnostics } from "./fatal-diagnostics.mjs";
import { onlineBrowserIds } from "./client-presence.mjs";
import { startRelay } from "./startup.mjs";
import { createPerformanceDiagnostics } from './performance-diagnostics.mjs';
import { handleLocalControl } from "./local-control.mjs";
import { feedbackRequest } from "./feedback.mjs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { CodexAppServerAdapter } from "./codex-adapters.mjs";
import { ClaudeCodeAdapter } from "./claude-adapter.mjs";
import { ClaudeCoworkAdapter } from "./claude-cowork-adapter.mjs";
import { MCodeAdapter } from "./mcode-adapter.mjs";
import { ZCodeAdapter } from "./zcode-adapter.mjs";
import { PiAdapter } from "./pi-adapter.mjs";
import { OpenCodeAdapter } from "./opencode-adapter.mjs";
import { KimiCodeAdapter } from "./kimi-adapter.mjs";
import { MacRelay } from "./mac-relay.mjs";
import { MultiAgentAdapter } from "./multi-agent-adapter.mjs";
import { codexHookMain, codexHookPaths } from "./codex-hook-client.mjs";
import { configureCodexHooks } from "./codex-hook-install.mjs";

installFatalDiagnostics();

function hookLauncher() {
  return process.pkg ? [process.execPath] : [process.execPath, resolve(process.argv[1])];
}

async function main() {
  const command = process.argv[2] ?? "relay";
  if (command === "webrtc-self-test") {
    try {
      const { verifyWebRtcRuntime } = await import("./webrtc-transport.mjs");
      await verifyWebRtcRuntime();
      process.stdout.write("Relayune WebRTC runtime verified\n");
    } catch { throw new Error("webrtc_self_test_failed"); }
    return;
  }
  if (command === "codex-hook") {
    await codexHookMain(process.stdin, process.stdout, { socketPath: codexHookPaths(process.argv[3]).socket });
    return;
  }
  if (command === "codex-hooks") {
    const result = await configureCodexHooks(process.argv[3] ?? "status", { argv: hookLauncher() });
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  if (command === "feedback") {
    try {
      const result = await feedbackRequest(process.env.RELAY_FEEDBACK_ACTION);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      throw new Error("relayune:feedback_failed");
    }
    return;
  }
  if (command === "revoke") {
    await revokeCurrentDevice();
    return;
  }
  if (command === "start-browser-pairing") {
    await startBrowserPairing();
    return;
  }
  if (command === "cancel-browser-pairing") {
    await cancelBrowserPairing();
    return;
  }
  if (command === "list-browser-authorizations") {
    await listBrowserAuthorizations();
    return;
  }
  if (command === "revoke-browser-authorization") {
    await revokeBrowserAuthorization();
    return;
  }
  if (command === "complete-browser-pairing") {
    await completeBrowserPairing();
    return;
  }
  if (command !== "relay") {
    throw new Error(
      "Usage: node relay/cli.mjs relay|revoke|start-browser-pairing|cancel-browser-pairing|complete-browser-pairing|list-browser-authorizations|revoke-browser-authorization",
    );
  }
  const serverUrl = required("RELAY_SERVER_URL");
  const deviceId = required("RELAY_DEVICE_ID");
  const deviceToken = required("RELAY_DEVICE_TOKEN");
  const serializedBrowserKeys = process.env.RELAY_BROWSER_KEYS;
  const browserKeys = browserKeyCredentials(serializedBrowserKeys);
  if (!deviceToken || !browserKeys.length) {
    throw new Error("请先在 Relayune 桌面端完成安全连接。");
  }
  const workspace = resolve(process.env.RELAY_WORKSPACE ?? process.cwd());
  const performanceDiagnostics = createPerformanceDiagnostics({ enabled: process.env.RELAY_PERFORMANCE_DIAGNOSTICS === '1' });
  const finishBootstrap = performanceDiagnostics.startPhase('bootstrap');
  try {
    const relay = await createMacRelay();
    finishBootstrap();
    await startRelay(relay, { configureHooks: async () => {
      if (relay.codexHooks) {
        try { await configureCodexHooks("install", { argv: hookLauncher(), automatic: true }); }
        catch { console.error("Relayune Codex hook setup needs attention; run codex-hooks status."); }
      }
    } });
    console.log(`Relayune Relay connected to ${serverUrl} (${adapterName()})`);
    const controls = createInterface({ input: process.stdin });
    let controlQueue = Promise.resolve();
    controls.on("line", line => {
      controlQueue = controlQueue.then(() => handleLocalControl(
        relay, line, ack => process.stdout.write(ack),
      )).catch(() => {});
    });
  // Private sidecar-to-parent IPC, consumed before diagnostics/logging.
  const reportPresence = () => process.stdout.write(`relayune:browser_presence:${JSON.stringify(onlineBrowserIds(relay))}\n`);
  reportPresence();
  const presenceTimer = setInterval(reportPresence, 2_000);
  presenceTimer.unref();
    await untilSignal(async () => { clearInterval(presenceTimer); controls.close(); await relay.stop(); });
  } catch (error) { finishBootstrap('failed'); throw error; }
  finally { performanceDiagnostics.close(); }

  async function createMacRelay() {
    const { AttachmentStore } = await import("./attachment-store.mjs");
    const attachmentStore = new AttachmentStore({
      path: required("RELAY_ATTACHMENT_STORE_PATH"),
      key: required("RELAY_ATTACHMENT_STORE_KEY"),
      deviceId,
    });
    delete process.env.RELAY_ATTACHMENT_STORE_KEY;
    let adapter;
    if (process.env.RELAY_ADAPTER === "codex") {
      adapter = new CodexAppServerAdapter({
        codexBin: process.env.CODEX_BIN,
        workspace,
      });
    } else if (process.env.RELAY_ADAPTER === "pi") {
      adapter = new PiAdapter({ piBin: process.env.PI_BIN, workspace });
    } else if (process.env.RELAY_ADAPTER === "mcode") {
      adapter = new MCodeAdapter({ mcodeBin: process.env.MCODE_BIN, workspace });
    } else if (process.env.RELAY_ADAPTER === "zcode") {
      adapter = new ZCodeAdapter({ zcodeBin: process.env.ZCODE_BIN, workspace });
    } else if (process.env.RELAY_ADAPTER === "opencode") {
      adapter = new OpenCodeAdapter({ opencodeBin: process.env.OPENCODE_BIN, workspace });
    } else if (process.env.RELAY_ADAPTER === "kimi") {
      adapter = new KimiCodeAdapter({
        kimiBin: process.env.KIMI_BIN,
        workspace,
      });
    } else if (process.env.RELAY_ADAPTER === "claude") {
      adapter = new ClaudeCodeAdapter({
        claudeBin: process.env.CLAUDE_BIN,
        workspace,
      });
    } else if (process.env.RELAY_ADAPTER === "claude-cowork") {
      adapter = new ClaudeCoworkAdapter({
        claudeBin: process.env.CLAUDE_COWORK_BIN,
        workspace,
      });
    } else {
      adapter = new MultiAgentAdapter({
        defaultProvider: process.env.RELAY_DEFAULT_PROVIDER ?? "kimi",
        adapters: {
          ...(process.env.RELAY_ENABLE_PI === "1" ? { pi: new PiAdapter({ piBin: process.env.PI_BIN, workspace }) } : {}),
          mcode: new MCodeAdapter({ mcodeBin: process.env.MCODE_BIN, workspace }),
          zcode: new ZCodeAdapter({ zcodeBin: process.env.ZCODE_BIN, workspace }),
          opencode: new OpenCodeAdapter({ opencodeBin: process.env.OPENCODE_BIN, workspace }),
          codex: new CodexAppServerAdapter({
            codexBin: process.env.CODEX_BIN,
            workspace,
          }),
          kimi: new KimiCodeAdapter({
            kimiBin: process.env.KIMI_BIN,
            workspace,
          }),
          claude: new ClaudeCodeAdapter({
            claudeBin: process.env.CLAUDE_BIN,
            workspace,
          }),
          "claude-cowork": new ClaudeCoworkAdapter({
            claudeBin: process.env.CLAUDE_COWORK_BIN,
            workspace,
          }),
        },
      });
    }
    return new MacRelay({
      serverUrl,
      deviceId,
      deviceToken,
      browserKeys,
      desktopVersion: process.env.RELAY_DESKTOP_VERSION,
      adapter,
      codexHooks: process.platform !== "win32" && process.env.RELAY_CODEX_HOOKS !== "0" &&
        [undefined, "multi", "codex"].includes(process.env.RELAY_ADAPTER) ? {} : null,
      workspace,
      statePath: process.env.RELAY_STATE_PATH,
      attachmentStore,
      performanceDiagnostics,
    });
  }

  function adapterName() {
    if (process.env.RELAY_ADAPTER === "pi") return "pi rpc";
    if (process.env.RELAY_ADAPTER === "codex") return "codex app-server";
    if (process.env.RELAY_ADAPTER === "mcode") return "mcode acp";
    if (process.env.RELAY_ADAPTER === "zcode") return "zcode app-server";
    if (process.env.RELAY_ADAPTER === "opencode") return "opencode acp";
    if (process.env.RELAY_ADAPTER === "kimi") return "kimi acp";
    if (process.env.RELAY_ADAPTER === "claude") return "claude code";
    if (process.env.RELAY_ADAPTER === "claude-cowork") return "claude cowork";
    return "codex app-server + kimi acp + claude code + claude cowork + opencode acp + zcode app-server + mcode acp";
  }
}

async function revokeCurrentDevice() {
  const response = await deviceRequest("/api/relay/logout", {
    method: "POST",
  });
  if (response.ok || response.status === 401) return;
  throw new Error(`无法撤销这台电脑的连接（HTTP ${response.status}）`);
}

async function startBrowserPairing() {
  const response = await deviceRequest("/api/relay/pairings/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pairing_id: required("RELAY_PAIRING_ID"),
      protocol: required("RELAY_PAIRING_PROTOCOL"),
      initiator_share: required("RELAY_PAIRING_INITIATOR_SHARE"),
    }),
  });
  await outputJsonOrThrow(response, "无法创建浏览器授权");
}

async function cancelBrowserPairing() {
  const pairingId = required("RELAY_PAIRING_ID");
  if (!/^pair_[A-Za-z0-9_-]{43}$/.test(pairingId)) {
    throw new Error("安全连接会话无效");
  }
  const response = await deviceRequest(
    `/api/relay/pairings/${encodeURIComponent(pairingId)}/cancel`,
    { method: "POST" },
  );
  if (response.ok) return;
  throw new Error(`无法取消浏览器连接（HTTP ${response.status}）`);
}

async function listBrowserAuthorizations() {
  const response = await deviceRequest(
    "/api/relay/browser-authorizations",
  );
  await outputJsonOrThrow(response, "无法读取浏览器授权");
}


async function revokeBrowserAuthorization() {
  const browserId = required("RELAY_BROWSER_ID");
  if (!/^web_[a-f0-9]{32}$/.test(browserId)) {
    throw new Error("浏览器授权编号无效");
  }
  const response = await deviceRequest(
    `/api/relay/browser-authorizations/${encodeURIComponent(browserId)}/revoke`,
    { method: "POST" },
  );
  await outputJsonOrThrow(response, "无法取消浏览器授权");
}

async function completeBrowserPairing() {
  const pairingId = required("RELAY_PAIRING_ID");
  const browserId = required("RELAY_BROWSER_ID");
  const desktopConfirm = required("RELAY_DESKTOP_CONFIRM");
  if (!/^pair_[A-Za-z0-9_-]{43}$/.test(pairingId)) {
    throw new Error("安全连接会话无效");
  }
  if (!/^web_[a-f0-9]{32}$/.test(browserId)) {
    throw new Error("浏览器授权编号无效");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(desktopConfirm)) {
    throw new Error("安全握手确认值无效");
  }
  const serverUrl = required("RELAY_SERVER_URL");
  const response = await fetch(
    new URL(`/api/pairings/${encodeURIComponent(pairingId)}/complete`, serverUrl),
    {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        desktop_confirm: desktopConfirm,
      }),
    },
  );
  const result = await response.text();
  if (!response.ok) {
    let message = "";
    try {
      message = JSON.parse(result)?.error?.message ?? "";
    } catch {}
    throw new Error(message || `无法确认浏览器授权（HTTP ${response.status}）`);
  }
  const completed = JSON.parse(result);
  if (completed.browser_id !== browserId) {
    throw new Error("服务端确认了另一个浏览器授权");
  }
}

function browserKeyCredentials(serialized) {
  let values = [];
  if (serialized) {
    try {
      values = JSON.parse(serialized);
    } catch {
      throw new Error("RELAY_BROWSER_KEYS 格式无效");
    }
  }
  if (
    !Array.isArray(values) ||
    values.some(
      (value) =>
        !value ||
        typeof value !== "object" ||
        typeof value.browser_id !== "string" ||
        !/^web_[a-f0-9]{32}$/.test(value.browser_id) ||
        typeof value.e2ee_key !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.e2ee_key) ||
        Buffer.from(value.e2ee_key, "base64url").toString("base64url") !== value.e2ee_key,
    )
  ) {
    throw new Error("浏览器内容密钥列表无效");
  }
  const browserIds = new Set();
  const keys = new Set();
  for (const value of values) {
    if (browserIds.has(value.browser_id) || keys.has(value.e2ee_key)) {
      throw new Error("浏览器内容密钥必须独立且不可重复绑定");
    }
    browserIds.add(value.browser_id);
    keys.add(value.e2ee_key);
  }
  return values.map((value) => ({
    browserId: value.browser_id,
    e2eeKey: value.e2ee_key,
  }));
}

async function deviceRequest(pathname, init = {}) {
  const serverUrl = required("RELAY_SERVER_URL");
  const deviceToken = required("RELAY_DEVICE_TOKEN");
  return fetch(new URL(pathname, serverUrl), {
    ...init,
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${deviceToken}`,
      ...init.headers,
    },
  });
}

async function outputJsonOrThrow(response, context) {
  const text = await response.text();
  if (!response.ok) {
    let message = "";
    try {
      message = JSON.parse(text)?.error?.message ?? "";
    } catch {}
    throw new Error(message || `${context}（HTTP ${response.status}）`);
  }
  process.stdout.write(`${text}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  // Agent children and sockets can still hold the event loop after a fatal
  // startup error. exitCode alone leaves Desktop stuck on Starting forever.
  process.exit(1);
});

function untilSignal(close) {
  return new Promise((resolvePromise) => {
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      await close();
      resolvePromise();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
