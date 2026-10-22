import { describe, expect, it } from "vitest";
import { LatestRequestGate } from "./latest-request";

describe("LatestRequestGate", () => {
  it("rejects an older completion after retry or immediate invalidation", () => {
    const gate = new LatestRequestGate();
    const first = gate.begin();
    const retry = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(retry)).toBe(true);

    gate.invalidate();
    expect(gate.isCurrent(retry)).toBe(false);
  });
});
