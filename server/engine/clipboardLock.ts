/**
 * Global mutex for macOS system clipboard operations.
 * When multiple channel browser instances run in parallel, clipboard access
 * must be serialized so one channel doesn't overwrite another channel's clipboard.
 */

class ClipboardMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  public async acquire(): Promise<() => void> {
    if (this.locked) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.locked = true;
    return () => {
      this.locked = false;
      const next = this.queue.shift();
      if (next) next();
    };
  }

  public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export const clipboardMutex = new ClipboardMutex();

export async function withClipboard<T>(fn: () => Promise<T>): Promise<T> {
  return clipboardMutex.runExclusive(fn);
}

