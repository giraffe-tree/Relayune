import { connect } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { codexHookReviewer } from "./codex-hook-context.mjs";

export const HOOK_MAX_BYTES = 256 * 1024;
export const HOOK_WAIT_MS = 90_000;
export function codexHookPaths(home = process.env.CODEX_HOME || join(homedir(), ".codex")) {
  const directory = join(resolve(home), "relayune-hooks");
  return { home: resolve(home), directory, socket: join(directory, "approval.sock"),
    registration: join(directory, "registration.json"), hooks: join(resolve(home), "hooks.json") };
}

export async function runCodexHook(payload, { socketPath = codexHookPaths().socket,
  timeoutMs = HOOK_WAIT_MS + 2000, skip = process.env.RELAYUNE_SKIP_CODEX_HOOKS === "1" } = {}) {
  if (skip || payload?.hook_event_name !== "PermissionRequest") return {};
  if (await codexHookReviewer(payload) !== "user") return {};
  const frame = JSON.stringify(payload) + "\n";
  if (Buffer.byteLength(frame) > HOOK_MAX_BYTES) return {};
  return new Promise(resolveResult => {
    const socket = connect(socketPath);
    let bytes = "";
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolveResult(value);
    };
    const timer = setTimeout(() => finish({}), timeoutMs);
    socket.on("error", () => finish({}));
    socket.on("close", () => finish({}));
    socket.on("connect", () => socket.write(frame));
    socket.on("data", chunk => {
      bytes += chunk.toString("utf8");
      if (bytes.length > 4096) return finish({});
      if (!bytes.includes("\n")) return;
      try {
        const { behavior } = JSON.parse(bytes.split("\n")[0]);
        if (!["allow", "deny"].includes(behavior)) return finish({});
        finish({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: {
          behavior, ...(behavior === "deny" ? { message: "Rejected by the user in Relayune." } : {}),
        } } });
      } catch { finish({}); }
    });
  });
}

export async function codexHookMain(input = process.stdin, output = process.stdout, options = {}) {
  // This entry point must never log payloads, credentials or diagnostics to stdout.
  let result = {};
  try {
    if (process.env.RELAYUNE_SKIP_CODEX_HOOKS !== "1") {
      let size = 0;
      const chunks = [];
      for await (const chunk of input) {
        size += chunk.length;
        if (size > HOOK_MAX_BYTES) throw new Error("oversized_hook");
        chunks.push(Buffer.from(chunk));
      }
      result = await runCodexHook(JSON.parse(Buffer.concat(chunks).toString("utf8")), options);
    }
  } catch { /* No decision means native handling, never implicit approval. */ }
  output.write(JSON.stringify(result) + "\n");
}
