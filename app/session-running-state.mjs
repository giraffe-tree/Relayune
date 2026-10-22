export function isSessionStatusRunning(session) {
  return session?.status === "active";
}

function activeSessionIds(sessions) {
  return new Set(
    (sessions ?? [])
      .filter((session) => isSessionStatusRunning(session))
      .map((session) => session.id),
  );
}

export function retainActiveSessionEntries(entries, sessions) {
  const activeIds = activeSessionIds(sessions);
  let changed = false;
  const next = {};
  for (const [sessionId, value] of Object.entries(entries ?? {})) {
    if (activeIds.has(sessionId)) {
      next[sessionId] = value;
    } else {
      changed = true;
    }
  }
  return changed ? next : entries;
}

export function settleInactiveSessionActivities(messageMap, sessions) {
  const activeIds = activeSessionIds(sessions);
  let changed = false;
  const next = { ...messageMap };
  for (const [sessionId, messages] of Object.entries(messageMap ?? {})) {
    if (activeIds.has(sessionId)) continue;
    let sessionChanged = false;
    const settled = messages.map((message) => {
      if (message.toolActivity?.status !== "running") return message;
      sessionChanged = true;
      return {
        ...message,
        toolActivity: { ...message.toolActivity, status: "completed" },
      };
    });
    if (sessionChanged) {
      changed = true;
      next[sessionId] = settled;
    }
  }
  return changed ? next : messageMap;
}

export function mergeCatalogSessionsWithDetails(
  catalogSessions,
  detailSessions,
) {
  const merged = new Map(
    (catalogSessions ?? []).map((session) => [session.id, session]),
  );
  for (const session of detailSessions ?? []) {
    const catalogSession = merged.get(session.id);
    merged.set(
      session.id,
      catalogSession
        ? {
            ...catalogSession,
            ...session,
            status: catalogSession.status,
            running_started_at: catalogSession.running_started_at,
            can_interrupt: catalogSession.can_interrupt,
          }
        : session,
    );
  }
  return [...merged.values()];
}
