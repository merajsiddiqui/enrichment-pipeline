/**
 * Bounds how many async tasks run concurrently, independent of how many are
 * queued. Callers await `run`, which only executes `task` once a slot is
 * free; excess callers queue in FIFO order and are resolved as slots free up.
 */
export class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  /** @param concurrency Max number of tasks allowed to run at once. */
  constructor(concurrency: number) {
    this.available = concurrency;
  }

  /** Runs `task` once a slot is available, releasing the slot when it settles (success or throw). */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.available += 1;
    }
  }
}
