export type ProjectSessionRecord = {
  id: string;
  name: string;
  project: string;
  cwd: string;
  updated_at: string;
  is_subagent?: boolean;
  provider?: string;
};

export type SavedProjectRecord = {
  id: string;
  name: string;
  cwd: string;
  updated_at: string;
  provider?: string;
};

export type SessionProjectGroup<T extends ProjectSessionRecord> = {
  key: string;
  name: string;
  displayName: string;
  cwd: string;
  normalizedCwd: string;
  sessions: T[];
  updatedAt: number;
};

function compareText(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sessionTimestamp(session: ProjectSessionRecord) {
  const timestamp = Date.parse(session.updated_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareSessions(
  left: ProjectSessionRecord,
  right: ProjectSessionRecord,
) {
  const byUpdatedAt = sessionTimestamp(right) - sessionTimestamp(left);
  return byUpdatedAt || compareText(left.id, right.id);
}

/**
 * Produces one lexical path identity without touching the filesystem. This
 * deliberately accepts both relay path styles so reconnects cannot split one
 * project merely because a Windows relay changed slash style or a relay sent a
 * trailing separator.
 */
export function normalizeProjectPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const slashed = trimmed.replaceAll("\\", "/");
  const driveMatch = slashed.match(/^([A-Za-z]:)(?:\/|$)/);
  const drive = driveMatch?.[1].toUpperCase() ?? "";
  const absolute = Boolean(drive) || slashed.startsWith("/");
  const body = drive ? slashed.slice(drive.length) : slashed;
  const segments: string[] = [];

  for (const segment of body.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length && segments.at(-1) !== "..") {
        segments.pop();
      } else if (!absolute) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }

  const prefix = drive ? `${drive}/` : absolute ? "/" : "";
  const normalized = `${prefix}${segments.join("/")}`;
  return normalized || (absolute ? prefix : ".");
}

export function projectGroupKey(cwd: string, project: string) {
  const normalizedCwd = normalizeProjectPath(cwd);
  return normalizedCwd || `project:${project.trim() || "workspace"}`;
}

export function rootSessionsForProvider<T extends ProjectSessionRecord>(
  sessions: readonly T[],
  provider: string,
  defaultProvider = "codex",
) {
  return sessions.filter(
    (session) =>
      !session.is_subagent &&
      (session.provider ?? defaultProvider) === provider,
  );
}

function fallbackProjectName(session: ProjectSessionRecord, normalizedCwd: string) {
  const explicitName = session.project.trim();
  if (explicitName) return explicitName;
  const pathName = normalizedCwd.split("/").filter(Boolean).at(-1);
  return pathName || "workspace";
}

export function groupSessionsByProject<T extends ProjectSessionRecord>(
  sessions: readonly T[],
): SessionProjectGroup<T>[] {
  const groups = new Map<
    string,
    Omit<SessionProjectGroup<T>, "displayName">
  >();

  for (const session of sessions) {
    if (session.is_subagent) continue;
    const normalizedCwd = normalizeProjectPath(session.cwd);
    const key = projectGroupKey(session.cwd, session.project);
    const updatedAt = sessionTimestamp(session);
    const existing = groups.get(key);
    const group = existing ?? {
      key,
      name: fallbackProjectName(session, normalizedCwd),
      cwd: session.cwd.trim(),
      normalizedCwd,
      sessions: [],
      updatedAt,
    };
    group.sessions.push(session);
    group.updatedAt = Math.max(group.updatedAt, updatedAt);
    groups.set(key, group);
  }

  const duplicateNames = new Map<string, number>();
  for (const group of groups.values()) {
    const identity = group.name.toLowerCase();
    duplicateNames.set(identity, (duplicateNames.get(identity) ?? 0) + 1);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      displayName:
        (duplicateNames.get(group.name.toLowerCase()) ?? 0) > 1
          ? `${group.name} · ${group.normalizedCwd || group.key}`
          : group.name,
      sessions: [...group.sessions].sort(compareSessions),
    }))
    .sort((left, right) => {
      const byUpdatedAt = right.updatedAt - left.updatedAt;
      return byUpdatedAt || compareText(left.key, right.key);
    });
}

/** Shows only projects and sessions owned by the selected local agent. */
export function projectGroupsForProvider<T extends ProjectSessionRecord>(
  sessions: readonly T[],
  provider: string,
  defaultProvider = "codex",
  projects: readonly SavedProjectRecord[] = [],
): SessionProjectGroup<T>[] {
  const providerGroups = new Map<string, SessionProjectGroup<T>>(
    groupSessionsByProject(
      rootSessionsForProvider(sessions, provider, defaultProvider),
    ).map((group) => [group.key, group]),
  );
  for (const project of projects) {
    if ((project.provider ?? defaultProvider) !== provider) continue;
    const normalizedCwd = normalizeProjectPath(project.cwd);
    if (!normalizedCwd) continue;
    const key = projectGroupKey(project.cwd, project.name);
    const existing = providerGroups.get(key);
    providerGroups.set(key, {
      key,
      name: project.name.trim() || normalizedCwd.split("/").at(-1) || "workspace",
      displayName:
        project.name.trim() || normalizedCwd.split("/").at(-1) || "workspace",
      cwd: project.cwd.trim(),
      normalizedCwd,
      sessions: existing?.sessions ?? [],
      updatedAt: Math.max(
        existing?.updatedAt ?? 0,
        sessionTimestamp({
          ...project,
          project: project.name,
        }),
      ),
    });
  }
  const groups = [...providerGroups.values()];
  const duplicateNames = new Map<string, number>();
  for (const group of groups) {
    const identity = group.name.toLowerCase();
    duplicateNames.set(identity, (duplicateNames.get(identity) ?? 0) + 1);
  }
  return groups
    .map((group) => ({
      ...group,
      displayName:
        (duplicateNames.get(group.name.toLowerCase()) ?? 0) > 1
          ? `${group.name} · ${group.normalizedCwd || group.key}`
          : group.name,
    }))
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || compareText(left.key, right.key),
    );
}

export function preserveProjectSessionSelection<T extends ProjectSessionRecord>(
  sessions: readonly T[],
  activeSessionId: string,
) {
  const roots = sessions
    .filter((session) => !session.is_subagent)
    .sort(compareSessions);
  return roots.some((session) => session.id === activeSessionId)
    ? activeSessionId
    : (roots[0]?.id ?? "");
}
