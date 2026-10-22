import { describe, expect, it, vi } from "vitest";
import { PairingCancellationQueue } from "./pairing-cancellation";

describe("PairingCancellationQueue", () => {
  it("keeps the transaction active between immediate and final cleanup", async () => {
    const activeChanges: boolean[] = [];
    const holder: { queue?: PairingCancellationQueue } = {};
    const queue = new PairingCancellationQueue(() =>
      activeChanges.push(Boolean(holder.queue?.active)),
    );
    holder.queue = queue;
    const calls: string[] = [];

    await queue.enqueue("pair_one", async () => {
      calls.push("immediate");
    });
    expect(queue.active).toBe(true);

    await queue.enqueue(
      "pair_one",
      async () => {
        calls.push("final");
      },
      true,
    );
    expect(calls).toEqual(["immediate", "final"]);
    expect(queue.active).toBe(false);
    expect(activeChanges).toEqual([true, false]);
  });

  it("serializes a final retry after a failed immediate attempt", async () => {
    const queue = new PairingCancellationQueue();
    const order: string[] = [];
    let releaseImmediate = () => {};
    const release = new Promise<void>((resolve) => {
      releaseImmediate = resolve;
    });
    const immediate = queue.enqueue("pair_two", async () => {
      order.push("immediate-start");
      await release;
      order.push("immediate-failed");
      throw new Error("offline");
    });
    const finalTask = vi.fn(async () => {
      order.push("final");
    });
    const final = queue.enqueue("pair_two", finalTask, true);

    await Promise.resolve();
    expect(finalTask).not.toHaveBeenCalled();
    releaseImmediate();
    expect((await immediate).ok).toBe(false);
    expect((await final).ok).toBe(true);
    expect(order).toEqual(["immediate-start", "immediate-failed", "final"]);
    expect(queue.active).toBe(false);
  });
});
