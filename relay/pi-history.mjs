import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join, isAbsolute } from "node:path";

import { customSessionTitle } from "./session-titles.mjs";

const MAX_FILE_BYTES = 32 * 1024 * 1024;

export async function readPiSession(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error("Pi session is not a supported regular file.");
    const source = await handle.readFile("utf8");
    const lines = source.split("\n");
    // An actively written last record is not evidence of corrupt history.
    if (lines.at(-1)?.trim()) lines.pop();
    const records = lines.filter(line => line.trim()).map(line => {
      try { return JSON.parse(line); } catch { throw new Error("Pi session contains invalid JSON."); }
    });
    const header = records.shift();
    if (header?.type !== "session" || header.version !== 3 || typeof header.id !== "string" ||
      !header.id || !isAbsolute(header.cwd ?? "")) throw new Error("Unsupported Pi session format.");
    const entries = new Map();
    for (const entry of records) {
      if (typeof entry.id !== "string" || entries.has(entry.id)) throw new Error("Invalid Pi session entry identity.");
      entries.set(entry.id, entry);
    }
    const branch = [], seen = new Set();
    let entry = records.at(-1);
    while (entry) {
      if (seen.has(entry.id)) throw new Error("Pi session has a cyclic branch.");
      seen.add(entry.id); branch.push(entry);
      if (entry.parentId == null) break;
      entry = entries.get(entry.parentId);
      if (!entry) throw new Error("Pi session branch is incomplete.");
    }
    branch.reverse();
    const info = [...branch].reverse().find(e => e.type === "session_info");
    const model = [...branch].reverse().find(e => e.type === "model_change");
    if (branch.some(entry => entry.type === "custom" && entry.customType === "relayune-managed" &&
        entry.data?.version === 1)) header.relayuneManaged = true;
    return { header, branch, path, title: piSessionTitle(info?.name, branch), model,
      updatedAt: new Date(stat.mtimeMs).toISOString() };
  } finally { await handle.close(); }
}

export async function listPiSessions(directory) {
  let folders;
  try { folders = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const sessions = [];
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    for (const file of await readdir(join(directory, folder.name), { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      sessions.push(await readPiSession(join(directory, folder.name, file.name)));
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function piText(content) {
  return typeof content === "string" ? content : (content ?? []).filter(b => b.type === "text").map(b => b.text).join("");
}

export function piHistoryMessages(session) {
  let turnId = null, userId = null, managedTurn = false;
  const messages = [], assistantByTurn = new Map();
  for (const entry of session.branch) {
    if (entry.type === "custom" && entry.customType === "relayune-turn") {
      turnId = entry.data?.turnId; userId = entry.data?.userId; managedTurn = true;
      continue;
    }
    const message = entry.message;
    if (entry.type !== "message" || !message) continue;
    if (message.role === "user" && !managedTurn) turnId = `turn_pi_${entry.id}`;
    if (!["user", "assistant", "toolResult"].includes(message.role)) continue;
    const content = piText(message.content);
    const attachments = (Array.isArray(message.content) ? message.content : []).flatMap((block, index) => {
      if (block.type !== "image" || typeof block.data !== "string" || !block.data ||
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(block.mimeType)) return [];
      return [{ id: `att_pi_${session.header.id}_${entry.id}_${index}`, type: "image", name: `Pi image ${index + 1}`,
        mime_type: block.mimeType, detail: "auto",
        relay_source: { type: "data_url", url: `data:${block.mimeType};base64,${block.data}` } }];
    });
    if (!content && !attachments.length) continue;
    if (message.role === "assistant" && assistantByTurn.has(turnId)) {
      assistantByTurn.get(turnId).content += content;
      continue;
    }
    const result = { id: message.role === "assistant" ? `codex_${turnId}`
      : message.role === "user" && userId ? userId : `pi_${session.header.id}_${entry.id}`, provider: "pi",
      role: message.role === "user" ? "user" : message.role === "toolResult" ? "system" : "codex",
      content, attachments, created_at: entry.timestamp, turn_id: turnId,
      ...(message.role === "toolResult" ? { kind: "tool", command: message.toolName, item_id: message.toolCallId } : {}) };
    messages.push(result);
    if (message.role === "assistant") assistantByTurn.set(turnId, result);
    if (message.role === "user") { userId = null; managedTurn = false; }
  }
  const replies = piTurnReplies(session);
  for (const message of messages) {
    if (message.role === "codex" && replies.get(message.turn_id)?.completed) {
      message.turn_status = "completed";
      message.message_phase = "final_answer";
    }
  }
  return messages;
}

// Pi may emit assistant text, tool calls/results and another assistant within
// one turn. The visible reply is aggregated; its cutoff is the final native
// assistant entry, so inherited tool context remains intact.
function piTurnReplies(session) {
  const turns = new Map();
  let turnId = null, managed = false;
  for (const entry of session.branch) {
    if (entry.type === "custom" && entry.customType === "relayune-turn") {
      turnId = entry.data?.turnId; managed = true; continue;
    }
    if (entry.type !== "message") continue;
    if (entry.message?.role === "user") {
      if (!managed) turnId = `turn_pi_${entry.id}`;
      managed = false;
    }
    if (!turnId) continue;
    const reply = turns.get(turnId) ?? {};
    if (entry.message?.role === "assistant") reply.entry = entry;
    reply.completed = reply.entry?.id === entry.id &&
      ["stop", "length"].includes(entry.message?.stopReason) &&
      !(Array.isArray(entry.message?.content) && entry.message.content.some(part => part.type === "toolCall"));
    turns.set(turnId, reply);
  }
  return turns;
}

export function piForkReply(session, { messageId, turnId }) {
  const reply = piTurnReplies(session).get(turnId);
  const canonicalId = messageId === `agent_${turnId}` ? `codex_${turnId}` : messageId;
  const visible = piHistoryMessages(session).find(message => message.id === canonicalId &&
    message.turn_id === turnId && message.role === "codex");
  return visible && reply?.completed ? reply.entry : null;
}

export function paginatePiHistory(messages, { limit = 100, before = null } = {}) {
  let end = messages.length;
  if (before !== null) {
    end = messages.findIndex(m => m.id === before);
    if (end < 0) throw new Error("Pi history cursor is no longer valid.");
  }
  const start = Math.max(0, end - Math.max(1, Math.min(500, Number(limit) || 100)));
  return { messages: messages.slice(start, end), has_more: start > 0, next_cursor: start > 0 ? messages[start].id : null };
}

// Derive display names without modifying Pi's single-writer session log.
// Only user text participates; image data and tool/assistant text never do.
export function piSessionTitle(name, branch) {
  const custom = customSessionTitle(name);
  if (custom && custom !== "Pi") return custom;
  for (const entry of branch) {
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    const content = entry.message.content;
    const text = (typeof content === "string" ? content :
      (Array.isArray(content) ? content : []).filter(b => b?.type === "text" && typeof b.text === "string").map(b => b.text).join(" "))
      .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, " ")
      .replace(/<image\b[^>]*\/?>/gi, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[(?:Image|图片)(?:\s*#?\d+)?\]/gi, " ")
      .replace(/data:image\/[^\s<>"']+/gi, " ")
      .replace(/<\|image[^>]*\|>/gi, " ")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim();
    if (text) {
      // Avoid Intl.Segmenter: the packaged Node/ICU runtime can crash during
      // segmentation. Keep combining marks, emoji modifiers and ZWJ sequences.
      const characters = text.match(/(?:\p{Regional_Indicator}{2}|.)(?:[\p{Mark}\p{Emoji_Modifier}]|\u200d.(?:[\p{Mark}\p{Emoji_Modifier}])*)*/gu) ?? [];
      return characters.length > 32 ? characters.slice(0, 32).join("") + "…" : text;
    }
  }
  return typeof name === "string" && name.trim() ? name.trim() : "Pi";
}
