export type RealtimeTransport =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting";

export type RealtimeDeviceState = {
  online: boolean;
  lastSeenAt: string | null;
  revision: number;
  realtimeConfirmed: boolean;
  transport: RealtimeTransport;
};

export type PresenceSignal = {
  online: boolean;
  lastSeenAt: string | null;
  revision: number;
};

export const INITIAL_REALTIME_DEVICE_STATE: RealtimeDeviceState = {
  online: false,
  lastSeenAt: null,
  revision: 0,
  realtimeConfirmed: false,
  transport: "idle",
};

export function projectBootstrapPresence(
  current: RealtimeDeviceState,
  presence: { online: boolean; lastSeenAt: string | null },
): RealtimeDeviceState {
  if (current.realtimeConfirmed) return current;
  return {
    ...current,
    online: presence.online,
    lastSeenAt: presence.lastSeenAt,
  };
}

export function projectPresenceSignal(
  current: RealtimeDeviceState,
  signal: PresenceSignal,
): RealtimeDeviceState {
  if (current.realtimeConfirmed && signal.revision <= current.revision) {
    return current;
  }
  return {
    ...current,
    online: signal.online,
    lastSeenAt: signal.lastSeenAt,
    revision: signal.revision,
    realtimeConfirmed: true,
  };
}

export function projectTransport(
  current: RealtimeDeviceState,
  transport: RealtimeTransport,
): RealtimeDeviceState {
  if (current.transport === transport) return current;
  return { ...current, transport };
}

export function resetRealtimeConfirmation(
  current: RealtimeDeviceState,
): RealtimeDeviceState {
  return {
    ...current,
    revision: 0,
    realtimeConfirmed: false,
  };
}

export function realtimeReconnectDelay(
  attempt: number,
  randomValue: number,
  baseMs = 500,
  maxMs = 30_000,
): number {
  const boundedAttempt = Math.max(0, Math.min(6, Math.floor(attempt)));
  const boundedRandom = Math.max(0, Math.min(1, randomValue));
  const exponential = Math.min(maxMs, baseMs * 2 ** boundedAttempt);
  return Math.round(exponential * (0.75 + boundedRandom * 0.5));
}

export function realtimeWebSocketUrl(origin: string): string {
  const url = new URL("/api/realtime", origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function consumeVerifiedFrames<Frame, Event>(options: {
  frames: readonly Frame[];
  cursor: number;
  cursorFor(frame: Frame): number;
  verify(frame: Frame): Promise<Event>;
  apply(event: Event): void;
}): Promise<number> {
  let nextCursor = options.cursor;
  for (const frame of options.frames) {
    const cursor = options.cursorFor(frame);
    if (cursor <= nextCursor) continue;
    const event = await options.verify(frame);
    options.apply(event);
    nextCursor = cursor;
  }
  return nextCursor;
}
