import { sameMessageIdentity } from "./message-identity";

type HistoryMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  source?: string;
  clientMessageId?: string | null;
};

export function mergeLatestHistory<T extends HistoryMessage>(history: T[], current: T[]): T[] {
  const incomingIds = new Set(history.map((message) => message.id));
  const olderHistory = current.filter(
    (message) => message.source === "history" && !incomingIds.has(message.id),
  );
  const live = current.filter((message) => message.source === "live");
  const merged = [...olderHistory, ...history];
  for (const message of live) {
    const historicalIndex = merged.findIndex((historical) => sameMessageIdentity(historical, message));
    const historical = merged[historicalIndex];
    if (historical && message.role !== "user" && message.content.length > historical.content.length && message.content.startsWith(historical.content)) {
      // A response snapshot may predate stream deltas already rendered.
      merged[historicalIndex] = message;
      continue;
    }
    const duplicate = history.some(
      (historical) =>
        sameMessageIdentity(historical, message) ||
        (historical.role === message.role &&
        historical.content === message.content &&
        Math.abs(
          new Date(historical.createdAt).getTime() -
            new Date(message.createdAt).getTime(),
        ) < 15_000),
    );
    if (!duplicate) merged.push(message);
  }
  const ids = new Set<string>();
  return merged.filter(message => {
    if (ids.has(message.id)) return false;
    ids.add(message.id);
    return true;
  });
}
