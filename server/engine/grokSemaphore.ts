/**
 * Concurrency semaphore for Grok video generation.
 * Even when multiple channels run in parallel, Grok video generation requests
 * are throttled to MAX_PARALLEL_GROK (default 2) to avoid rate limits or credit errors on shared accounts.
 */

class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  public async acquire(): Promise<() => void> {
    if (this.current >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.current++;
    return () => {
      this.current--;
      const next = this.queue.shift();
      if (next) next();
    };
  }

  public async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const maxGrok = Number(process.env.MAX_PARALLEL_GROK) || 2;
export const grokSemaphore = new Semaphore(maxGrok);

export async function withGrokSlot<T>(fn: () => Promise<T>): Promise<T> {
  return grokSemaphore.run(fn);
}

