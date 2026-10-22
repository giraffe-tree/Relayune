import { createServer, connect } from "node:net";
import { chmod, lstat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hashAction } from "./protocol.mjs";
import { codexHookReviewer } from "./codex-hook-context.mjs";
import { codexHookPaths, HOOK_MAX_BYTES, HOOK_WAIT_MS } from "./codex-hook-client.mjs";
import { withHookLock } from "./codex-hook-files.mjs";

export class CodexHookBridge {
  constructor({ home, requestApproval, resolved, available, waitMs = HOOK_WAIT_MS }) {
    this.paths = codexHookPaths(home);
    this.requestApproval = requestApproval;
    this.resolved = resolved;
    this.available = available;
    this.waitMs = waitMs;
    this.pending = new Map();
    this.sockets = new Set();
  }

  async start() {
    if (process.platform === "win32") throw new Error("codex_hooks_unix_only");
    return withHookLock(this.paths, "bridge-start", () => this.listen());
  }

  async listen() {
    const existing = await lstat(this.paths.socket).catch(e => { if (e.code !== "ENOENT") throw e; });
    if (existing) {
      if (!existing.isSocket() || existing.uid !== process.getuid()) throw new Error("unsafe_hook_socket");
      // Never steal a live socket from another Relay process.
      await new Promise((resolve, reject) => {
        const probe = connect(this.paths.socket);
        probe.setTimeout(500, () => { probe.destroy(); reject(new Error("hook_bridge_busy")); });
        probe.once("connect", () => { probe.destroy(); reject(new Error("hook_bridge_busy")); });
        probe.once("error", error => { probe.destroy();
          if (error.code === "ECONNREFUSED" || error.code === "ENOENT") resolve(); else reject(error); });
      });
      await unlink(this.paths.socket).catch(e => { if (e.code !== "ENOENT") throw e; });
    }
    this.server = createServer(socket => this.accept(socket));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.paths.socket, () => { this.server.off("error", reject); resolve(); });
    });
    this.server.on("error", () => {});
    await chmod(this.paths.socket, 0o600);
  }

  accept(socket) {
    socket.on("error", () => {});
    if (this.sockets.size >= 32) { socket.end("{}\n"); return; }
    this.sockets.add(socket);
    const deadline = Date.now() + this.waitMs;
    let data = Buffer.alloc(0);
    let received = false;
    let approvalId;
    const timer = setTimeout(() => {
      if (approvalId) void this.finish(approvalId, "expired");
      else socket.end("{}\n");
    }, this.waitMs);
    socket.once("close", () => {
      clearTimeout(timer);
      this.sockets.delete(socket);
      if (approvalId) void this.finish(approvalId, "expired");
    });
    socket.on("data", chunk => {
      if (received) return;
      data = Buffer.concat([data, chunk]);
      if (data.length > HOOK_MAX_BYTES) { received = true; socket.end("{}\n"); return; }
      if (!data.includes(10)) return;
      received = true;
      void (async () => {
        try {
          const payload = JSON.parse(data.subarray(0, data.indexOf(10)).toString("utf8"));
          if (!this.available(payload.session_id) || payload.hook_event_name !== "PermissionRequest" ||
              !validId(payload.session_id) || !validId(payload.turn_id) ||
              typeof payload.tool_name !== "string" || typeof payload.cwd !== "string" ||
              await codexHookReviewer(payload) !== "user" || socket.destroyed || socket.writableEnded ||
              Date.now() >= deadline || !this.available(payload.session_id)) {
            socket.end("{}\n"); return;
          }
          const input = payload.tool_input ?? {};
          const display = typeof input.command === "string" ? input.command : JSON.stringify(input);
          const action = { type: payload.tool_name === "Bash" ? "command.execute" :
            ["apply_patch", "Edit", "Write"].includes(payload.tool_name) ? "file.change" : "tool.execute",
            display, cwd: payload.cwd, tool_name: payload.tool_name,
            description: typeof input.description === "string" ? input.description : null,
            options: [
              { option_id: "hook_allow", name: "Allow once", kind: "allow_once" },
              { option_id: "hook_deny", name: "Reject", kind: "reject_once" },
              { option_id: "hook_native", name: "Return to Codex", kind: "reject_native" },
            ] };
          approvalId = `apr_hook_${randomUUID()}`;
          const approval = { approval_id: approvalId, request_id: approvalId,
            session_id: payload.session_id, root_session_id: payload.session_id,
            turn_id: payload.turn_id, provider: "codex", source: "codex_hook",
            action: { ...action, command_hash: hashAction(action) }, risk_level: "high",
            requested_at: new Date().toISOString(), expires_at: new Date(deadline).toISOString() };
          const pending = { socket, approval, payload, timer, published: null };
          this.pending.set(approvalId, pending);
          // Serialize resolution behind publication, including disconnect/timeout.
          pending.published = Promise.resolve().then(() => this.requestApproval(approval));
          await pending.published;
        } catch {
          if (approvalId) await this.finish(approvalId, "expired");
          else socket.end("{}\n");
        }
      })();
    });
  }

  async resolveApproval({ approvalId, decision, optionId }) {
    if (!this.pending.has(approvalId)) throw new Error("Hook approval is no longer pending.");
    const option = optionId ?? (decision === "approved" ? "hook_allow" : "hook_deny");
    if (!((option === "hook_allow" && decision === "approved") ||
        (["hook_deny", "hook_native"].includes(option) && decision === "rejected"))) {
      throw new Error("Invalid hook approval option.");
    }
    await this.finish(approvalId, option === "hook_native" ? "expired" : decision);
    return { confirmation: "hook/resolved" };
  }

  async finish(id, decision) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    await pending.published?.catch(() => {});
    if (decision !== "expired" && await codexHookReviewer(pending.payload) !== "user") decision = "expired";
    if (pending.socket.destroyed || pending.socket.writableEnded ||
        Date.parse(pending.approval.expires_at) <= Date.now()) decision = "expired";
    const behavior = decision === "approved" ? "allow" : decision === "rejected" ? "deny" : null;
    if (!pending.socket.destroyed && !pending.socket.writableEnded) {
      pending.socket.end(JSON.stringify(behavior ? { behavior } : {}) + "\n");
    }
    await Promise.resolve().then(() => this.resolved(pending.approval.session_id, {
      kind: "approval.resolved", approval_id: id, decision,
      command_hash: pending.approval.action.command_hash })).catch(() => {});
  }

  async close() {
    await Promise.all([...this.pending.keys()].map(id => this.finish(id, "expired")));
    for (const socket of this.sockets) socket.destroy();
    if (this.server?.listening) await new Promise(resolve => this.server.close(resolve));
  }
}

function validId(value) { return typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value); }
