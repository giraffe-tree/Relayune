// Kept as source so the bundled Relay sidecar can materialize the extension.
// No user-global extensions are loaded into this managed RPC process.
export const PI_EXTENSION_SOURCE = `
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { unlinkSync, chmodSync } from "node:fs";
export default function (pi) {
  pi.registerCommand("relayune-capabilities", {
    description: "Relayune Pi bridge v1",
    handler: async (_args, ctx) => ctx.ui.notify("relayune-pi-v1", "info"),
  });
  pi.registerCommand("relayune-turn", {
    description: "Persist Relayune turn identity",
    handler: async (args) => {
      const data = JSON.parse(args);
      if (!/^turn_pi_[a-zA-Z0-9_-]+$/.test(data.turnId) || typeof data.userId !== "string") throw new Error("Invalid turn identity");
      pi.appendEntry("relayune-turn", { turnId: data.turnId, userId: data.userId });
    },
  });
  pi.registerCommand("relayune-fork", {
    description: "Persist a new Relayune conversation through a completed reply",
    handler: async (args, ctx) => {
      let data;
      try { data = JSON.parse(args); } catch { return; }
      if (typeof data.requestId !== "string" || typeof data.entryId !== "string" ||
          typeof data.sourceId !== "string" || typeof data.sessionDir !== "string" ||
          typeof data.cwd !== "string" || ctx.mode !== "rpc") return;
      const reply = result => ctx.ui.notify(JSON.stringify({ bridge: "relayune-pi-fork-v1",
        requestId: data.requestId, ...result }), "info");
      let trimmed;
      try {
        if (!ctx.isIdle()) return reply({ code: "session_fork_busy" });
        const manager = SessionManager.open(ctx.sessionManager.getSessionFile(), data.sessionDir);
        if (manager.getSessionId() !== data.sourceId) return reply({ code: "session_not_found" });
        const branch = manager.getBranch();
        const index = branch.findIndex(entry => entry.id === data.entryId);
        const entry = branch[index];
        if (index < 0 || entry.type !== "message" || entry.message?.role !== "assistant" ||
            !["stop", "length"].includes(entry.message.stopReason) ||
            (Array.isArray(entry.message.content) && entry.message.content.some(part => part.type === "toolCall"))) {
          return reply({ code: "session_fork_invalid_reply" });
        }
        trimmed = manager.createBranchedSession(entry.id);
        const fork = manager.getCwd() === data.cwd ? manager :
          SessionManager.forkFrom(trimmed, data.cwd, data.sessionDir);
        fork.appendCustomEntry("relayune-managed", { version: 1 });
        chmodSync(fork.getSessionFile(), 0o600);
        if (fork !== manager) { unlinkSync(trimmed); trimmed = undefined; }
        // Neither the live ctx.sessionManager nor its original file is changed.
        reply({ id: fork.getSessionId(), path: fork.getSessionFile(), cwd: fork.getCwd() });
      } catch {
        // A failure after createBranchedSession may already have persisted a fork.
        reply({ code: trimmed ? "session_fork_outcome_unknown" : "session_fork_invalid_reply" });
      }
    },
  });
  pi.on("tool_call", async (event, ctx) => {
    if (["read", "grep", "find", "ls", "relayune_ask"].includes(event.toolName)) return;
    const description = JSON.stringify({ bridge: "relayune-pi-v1", tool: event.toolName,
      toolCallId: event.toolCallId, input: event.input });
    // Never approve a truncated action or continue without a working UI bridge.
    if (description.length > 12000 || ctx.mode !== "rpc") {
      return { block: true, reason: "This operation cannot be approved in Relayune.", terminate: true };
    }
    const allowed = await ctx.ui.confirm("Pi operation", description, { timeout: 300000 });
    if (allowed !== true) return { block: true, reason: "Operation rejected or approval expired.", terminate: true };
  });
  pi.registerTool({
    name: "relayune_ask", label: "Ask user",
    description: "Ask the user a structured question. Provide non-empty options for a choice. For free text use options: [] (or omit options).",
    parameters: { type: "object", properties: { question: { type: "string", minLength: 1, maxLength: 4000 },
      options: { type: "array", minItems: 0, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 200 } } },
      required: ["question"], additionalProperties: false },
    async execute(_id, params, signal, _onUpdate, ctx) {
      const options = { signal, timeout: 300000 };
      const answer = params.options?.length ? await ctx.ui.select(params.question, params.options, options)
        : await ctx.ui.input(params.question, "", options);
      return { content: [{ type: "text", text: answer === undefined ? "User did not answer." : String(answer) }], details: {} };
    },
  });
}
`;
