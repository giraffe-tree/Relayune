/**
 * Monotonic guard for async work whose native operation cannot be aborted.
 * Older promises may still settle, but only the latest revision may commit UI
 * or durable presentation state.
 */
export class LatestRequestGate {
  private revision = 0;

  invalidate() {
    this.revision += 1;
  }

  begin() {
    this.revision += 1;
    return this.revision;
  }

  isCurrent(revision: number) {
    return revision === this.revision;
  }
}
