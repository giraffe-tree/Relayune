type ImageJob = {
  priority: () => number;
  signal: AbortSignal;
  start: () => Promise<void>;
};

/** Batch a render's requests before choosing the last attachment in the conversation. */
export class ImageLoadQueue {
  private waiting: ImageJob[] = [];
  private active = 0;
  private scheduled = false;

  run<T>(load: () => Promise<T>, priority: () => number, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new DOMException("Image load cancelled", "AbortError"));
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      this.waiting.push({
        priority,
        signal,
        start: async () => {
          try {
            resolve(await load());
          } catch (error) {
            reject(error);
          } finally {
            signal.removeEventListener("abort", abort);
          }
        },
      });
      if (!this.scheduled) {
        this.scheduled = true;
        setTimeout(() => {
          this.scheduled = false;
          this.drain();
        }, 0);
      }
    });
  }

  private drain() {
    this.waiting = this.waiting.filter((job) => !job.signal.aborted);
    this.waiting.sort((left, right) => right.priority() - left.priority());
    while (this.active < 5 && this.waiting.length) {
      const job = this.waiting.shift()!;
      this.active += 1;
      void job.start().finally(() => {
        this.active -= 1;
        this.drain();
      });
    }
  }
}
