import {
  preserveProjectSessionSelection,
  type ProjectSessionRecord,
} from "./session-projects";

type SessionSelectionStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> | null;

// Session ids are routing metadata, not secrets, so they may stay in
// localStorage in plaintext. The key is scoped per relay device so multiple
// accounts or computers on one browser never restore each other's selection.
function storageKey(deviceId: string) {
  return `relayune.activeSession.${deviceId}`;
}

export function readActiveSessionSelection(
  deviceId: string,
  storage?: SessionSelectionStorage,
): string {
  if (!deviceId) return "";
  try {
    return (
      (storage ?? globalThis.localStorage)?.getItem(storageKey(deviceId)) ?? ""
    );
  } catch {
    return "";
  }
}

export function storeActiveSessionSelection(
  deviceId: string,
  sessionId: string,
  storage?: SessionSelectionStorage,
): void {
  if (!deviceId) return;
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return;
    if (sessionId) {
      target.setItem(storageKey(deviceId), sessionId);
    } else {
      target.removeItem(storageKey(deviceId));
    }
  } catch {
    // Selection persistence is best-effort; the in-memory session still works.
  }
}

export function resolveActiveSessionSelection<T extends ProjectSessionRecord>(
  sessions: readonly T[],
  rootSessions: readonly T[],
  currentId: string,
  persistedId: string,
  provider: string,
  defaultProvider = "codex",
): string {
  const stillAvailable = (id: string) =>
    id !== "" &&
    sessions.some(
      (session) =>
        session.id === id &&
        (session.provider ?? defaultProvider) === provider,
    );
  if (stillAvailable(currentId)) return currentId;
  if (stillAvailable(persistedId)) return persistedId;
  return preserveProjectSessionSelection(rootSessions, currentId);
}
