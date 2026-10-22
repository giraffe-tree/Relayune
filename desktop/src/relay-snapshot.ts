import type { RelaySnapshot } from "./types";

export function relaySnapshotAfterBootstrap(
  bootstrapSnapshot: RelaySnapshot,
  latestEventSnapshot: RelaySnapshot | null,
  eventRevisionAtStart: number,
  currentEventRevision: number,
): RelaySnapshot {
  // A relay-status event received while the native bootstrap command was in
  // flight is newer than the snapshot captured by that command. This also
  // covers cold start, when the event arrives before the first Bootstrap has
  // made the WebView listener actionable.
  return latestEventSnapshot && currentEventRevision > eventRevisionAtStart
    ? latestEventSnapshot
    : bootstrapSnapshot;
}
