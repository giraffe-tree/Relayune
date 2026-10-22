export type MessageContentSegment = {
  kind: "content" | "system-reminder";
  content: string;
};

const SYSTEM_REMINDER_PATTERN =
  /<(system-reminder|notification)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

export function splitSystemReminderSegments(
  content: string,
): MessageContentSegment[] {
  const segments: MessageContentSegment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(SYSTEM_REMINDER_PATTERN)) {
    const index = match.index;
    if (index > cursor) {
      segments.push({ kind: "content", content: content.slice(cursor, index) });
    }
    segments.push({ kind: "system-reminder", content: match[2] ?? "" });
    cursor = index + match[0].length;
  }

  if (cursor < content.length || segments.length === 0) {
    segments.push({ kind: "content", content: content.slice(cursor) });
  }

  return segments;
}

export function isSystemReminderOnlyContent(content: string): boolean {
  const segments = splitSystemReminderSegments(content);
  return (
    segments.some((segment) => segment.kind === "system-reminder") &&
    segments.every(
      (segment) =>
        segment.kind === "system-reminder" || segment.content.trim() === "",
    )
  );
}
