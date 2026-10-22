const COMPLETED_STATUSES = new Set([
  "completed",
  "success",
  "succeeded",
  "done",
]);

const FAILED_STATUSES = new Set([
  "failed",
  "error",
  "errored",
  "declined",
  "interrupted",
  "cancelled",
  "canceled",
]);

export function isToolActivityEvent(event) {
  return ["command.started", "command.output", "command.completed"].includes(
    event?.kind,
  );
}

export function toolActivityStatus(event) {
  const status = String(event?.status ?? "").toLowerCase();
  if (FAILED_STATUSES.has(status)) return "failed";
  if (event?.kind === "command.completed" || COMPLETED_STATUSES.has(status)) {
    return "completed";
  }
  return "running";
}

export function toolActivityMessageId(event, turnId) {
  const toolCallId = event.item_id ?? "legacy";
  return `command_${turnId}_${toolCallId}`;
}

export function toolActivityLabel(event, fallbackLabel, locale = "zh-CN") {
  const chinese = String(locale).toLowerCase().startsWith("zh");
  const type = event?.activity_type ?? (event?.command ? "command" : null);
  const name = compactValue(event?.activity_name, 100);
  const subject = compactValue(event?.activity_subject, 160);
  const count = Number(event?.activity_count);
  switch (type) {
    case "command":
      return chinese ? "执行命令" : "Run command";
    case "file_read":
      if (Number.isFinite(count) && count > 1) {
        return subject
          ? chinese
            ? `读取 ${count} 个文件：${subject}`
            : `Read ${count} files: ${subject}`
          : chinese
            ? `读取 ${count} 个文件`
            : `Read ${count} files`;
      }
      return subject
        ? chinese
          ? `读取文件：${subject}`
          : `Read file: ${subject}`
        : chinese
          ? "读取文件"
          : "Read file";
    case "file_change":
      if (Number.isFinite(count) && count > 1) {
        return subject
          ? chinese
            ? `修改 ${count} 个文件：${subject}`
            : `Edit ${count} files: ${subject}`
          : chinese
            ? `修改 ${count} 个文件`
            : `Edit ${count} files`;
      }
      return subject
        ? chinese
          ? `修改文件：${subject}`
          : `Edit file: ${subject}`
        : chinese
          ? "修改文件"
          : "Edit files";
    case "mcp_tool":
    case "dynamic_tool":
    case "tool_call":
      return name
        ? chinese
          ? `调用工具：${name}`
          : `Use tool: ${name}`
        : chinese
          ? "调用工具"
          : "Use tool";
    case "web_search":
      return subject
        ? chinese
          ? `搜索网页：${subject}`
          : `Search web: ${subject}`
        : chinese
          ? "搜索网页"
          : "Search web";
    case "image_view":
      return subject
        ? chinese
          ? `查看图像：${subject}`
          : `View image: ${subject}`
        : chinese
          ? "查看图像"
          : "View image";
    case "image_generation":
      return chinese ? "生成图片" : "Generate image";
    case "context_compaction":
      return chinese ? "自动压缩上下文" : "Compact context";
    case "wait": {
      const milliseconds = Number(subject);
      if (Number.isFinite(milliseconds) && milliseconds > 0) {
        const seconds = Math.max(1, Math.round(milliseconds / 1000));
        return chinese ? `等待 ${seconds} 秒` : `Wait ${seconds}s`;
      }
      return chinese ? "等待任务" : "Wait for task";
    }
    default:
      return compactValue(event?.command, 100) ?? fallbackLabel;
  }
}

function compactValue(value, limit) {
  const text = String(value ?? "").replaceAll(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
