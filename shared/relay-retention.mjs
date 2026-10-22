// Fixed transport windows, shared by the API and the desktop relay. These are
// delivery buffers; durable conversation history belongs to the local agent.
export const EVENT_WINDOW_MS = 10 * 60_000;
export const RESPONSE_WINDOW_MS = 5 * 60_000;
export const COMMAND_MAX_TTL_MS = 24 * 60 * 60_000;
export const COMMAND_RECEIPT_GRACE_MS = 5 * 60_000;
export const CLOCK_SKEW_MS = 2 * 60_000;
export const RETENTION_POLICY = Object.freeze({
  event_window_ms: EVENT_WINDOW_MS,
  response_window_ms: RESPONSE_WINDOW_MS,
});

export function withinRetention(createdAt, windowMs, now = Date.now()) {
  const time = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt);
  return Number.isFinite(time) && time > now - windowMs && time <= now + CLOCK_SKEW_MS;
}

// Only timestamped transport payloads are eligible; catalogs and receipts have
// different lifetimes. Timestamp-less records cannot be uploaded as events.
export function transportPayloadExpired(message, now = Date.now()) {
  const window = message.kind === 'event' ? EVENT_WINDOW_MS
    : message.kind === 'response' ? RESPONSE_WINDOW_MS : null;
  if (window === null) return false;
  return !withinRetention(message.aad?.created_at ?? message.created_at, window, now);
}
