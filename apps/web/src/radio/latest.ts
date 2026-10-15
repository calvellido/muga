/**
 * Writes only the most recent value, with at most one write in flight. A slider fires many
 * changes a second and radios handle one request at a time; UNDOK does the same for volume
 * (Analysis doc 05 §5).
 */
export class LatestWins<T> {
  private pending: { value: T } | undefined;
  private loop: Promise<boolean> | undefined;

  constructor(
    private readonly write: (value: T) => Promise<void>,
    private readonly hooks: { onError(error: unknown): void; onSettled?(): void },
  ) {}

  get busy(): boolean {
    return this.loop !== undefined;
  }

  /** Resolves false when a write failed (the error went to `onError`). */
  push(value: T): Promise<boolean> {
    this.pending = { value };
    this.loop ??= this.drain().finally(() => {
      this.loop = undefined;
      this.hooks.onSettled?.();
    });
    return this.loop;
  }

  private async drain(): Promise<boolean> {
    try {
      while (this.pending) {
        const { value } = this.pending;
        this.pending = undefined;
        await this.write(value);
      }
      return true;
    } catch (error) {
      this.pending = undefined;
      this.hooks.onError(error);
      return false;
    }
  }
}
