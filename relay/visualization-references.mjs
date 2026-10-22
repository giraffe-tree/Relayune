import { homedir } from "node:os";
import { basename, join, relative, isAbsolute } from "node:path";

// Only generated Codex visualization artifacts qualify for HTML previews.
// Ordinary HTML links keep the existing plain-text file behavior.
export function isCodexVisualizationPath(path) {
  if (typeof path !== "string" || path.length > 4096 || !isAbsolute(path)) return false;
  const local = relative(join(homedir(), ".codex", "visualizations"), path);
  return /^\d{4}[\\/]\d{2}[\\/]\d{2}[\\/][a-f0-9-]{36}[\\/][a-z0-9][a-z0-9-]*\.html$/.test(local);
}

export function normalizeVisualizationReferences(value) {
  if (typeof value !== "string") return value;
  let fence = null;
  return value.split("\n").map((line) => {
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = null;
      return line;
    }
    if (fence) return line;
    const match = /^[ \t]*\uE200visualize\uE202(.*?)\uE201[ \t\r]*$/.exec(line);
    if (!match) return line;
    try {
      const reference = JSON.parse(match[1]);
      if (!isCodexVisualizationPath(reference?.path)) return line;
      const title = typeof reference.title === "string" && reference.title.trim()
        ? reference.title.trim().slice(0, 180) : basename(reference.path);
      const label = title.replace(/[\r\n]/g, " ").replace(/[\\[\]]/g, "\\$&");
      return `[${label}](<${reference.path}>)`;
    } catch {
      return line;
    }
  }).join("\n");
}
