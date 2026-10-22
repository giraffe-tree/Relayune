import { open } from "node:fs/promises";
import { constants } from "node:fs";

// Rollout metadata is version-dependent. Never borrow another turn's reviewer,
// and never treat an unreadable/missing context as permission to intercept.
export async function codexHookReviewer(payload, { limit = 2 * 1024 * 1024 } = {}) {
  if (typeof payload?.turn_id !== "string" || typeof payload?.transcript_path !== "string") return "unknown";
  let file;
  try {
    file = await open(payload.transcript_path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile()) return "unknown";
    const size = Math.min(limit, stat.size);
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await file.read(buffer, 0, size, stat.size - size);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
    if (stat.size > size) lines.shift();
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try { entry = JSON.parse(lines[i]); } catch { continue; }
      if (entry.type !== "turn_context" || entry.payload?.turn_id !== payload.turn_id) continue;
      const reviewer = entry.payload.approvals_reviewer;
      if (["auto_review", "guardian_subagent"].includes(reviewer)) return "auto";
      return reviewer === "user" ? "user" : "unknown";
    }
  } catch { /* Hand back to the native approval flow. */ }
  finally { await file?.close().catch(() => {}); }
  return "unknown";
}
