// A wake-up hint only. MongoDB remains the durable command queue and lease owner.
// Register before reading the queue so an enqueue during that read cannot be lost.
export class CommandWaitHub {
  private readonly waiters = new Map<string, (reason: WaitReason) => void>();
  private closed = false;

  subscribe(deviceId: string, timeoutMs: number, signal?: AbortSignal) {
    this.waiters.get(deviceId)?.("cancelled");
    let finish!: (reason: WaitReason) => void;
    const promise = new Promise<WaitReason>((resolve) => { finish = resolve; });
    const abort = () => complete("cancelled");
    const complete = (reason: WaitReason) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (this.waiters.get(deviceId) === complete) this.waiters.delete(deviceId);
      finish(reason);
    };
    this.waiters.set(deviceId, complete);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => complete("timeout"), timeoutMs);
    if (this.closed || signal?.aborted) complete("cancelled");
    return { promise, dispose: abort };
  }

  notify(deviceId: string) {
    this.waiters.get(deviceId)?.("command");
  }

  close() {
    this.closed = true;
    for (const complete of this.waiters.values()) complete("cancelled");
  }
}

type WaitReason = "command" | "timeout" | "cancelled";
