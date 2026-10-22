import { describe, expect, it } from "vitest";
import { relaySnapshotAfterBootstrap } from "./relay-snapshot";
import type { RelayPhase, RelaySnapshot } from "./types";

function snapshot(phase: RelayPhase): RelaySnapshot {
  return {
    phase,
    pid: phase === "connected" ? 42 : null,
    started_at: null,
    last_error: null,
    logs: [],
  };
}

describe("relaySnapshotAfterBootstrap", () => {
  it("keeps a newer event received while bootstrap was in flight", () => {
    const staleBootstrap = snapshot("starting");
    const connectedEvent = snapshot("connected");

    expect(
      relaySnapshotAfterBootstrap(staleBootstrap, connectedEvent, 3, 4),
    ).toBe(connectedEvent);
  });

  it("trusts bootstrap when no newer event arrived", () => {
    const stoppedBootstrap = snapshot("stopped");
    const olderEvent = snapshot("starting");

    expect(
      relaySnapshotAfterBootstrap(stoppedBootstrap, olderEvent, 7, 7),
    ).toBe(stoppedBootstrap);
    expect(
      relaySnapshotAfterBootstrap(stoppedBootstrap, null, 7, 8),
    ).toBe(stoppedBootstrap);
  });
});
