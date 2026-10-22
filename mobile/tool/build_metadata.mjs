import { execFileSync } from "node:child_process";

export function readBuildMetadata(cwd, now = new Date()) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  return {
    built_at: now.toISOString(),
    source_commit: git("rev-parse", "HEAD"),
    source_dirty: git("status", "--porcelain", "--untracked-files=normal").length > 0,
  };
}

export function withBuildMetadata(args, metadata) {
  // Put authoritative values last, including after any caller-provided defines.
  return [...args,
    `--dart-define=RELAYUNE_BUILT_AT=${metadata.built_at}`,
    `--dart-define=RELAYUNE_SOURCE_COMMIT=${metadata.source_commit}`,
    `--dart-define=RELAYUNE_SOURCE_DIRTY=${metadata.source_dirty}`,
  ];
}
