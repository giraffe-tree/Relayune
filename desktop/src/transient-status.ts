export type TransientStatusScheduler = (
  callback: () => void,
  delayMs: number,
) => void;

export class TransientStatusController<Key extends string> {
  private key: Key | null = null;
  private revision = 0;

  constructor(
    private readonly render: (key: Key | null) => void,
    private readonly schedule: TransientStatusScheduler,
  ) {}

  set(key: Key | null, clearAfterMs?: number) {
    this.key = key;
    const revision = ++this.revision;
    this.render(key);
    if (key === null || clearAfterMs === undefined) return;

    this.schedule(() => {
      if (this.revision !== revision || this.key !== key) return;
      this.key = null;
      this.revision += 1;
      this.render(null);
    }, clearAfterMs);
  }

  retranslate() {
    this.render(this.key);
  }
}
