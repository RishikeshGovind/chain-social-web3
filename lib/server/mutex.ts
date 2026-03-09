/**
 * Simple async mutex for serializing access to shared resources.
 * Prevents race conditions when multiple concurrent operations access/modify the same data.
 */

type QueuedTask = {
  resolve: () => void;
};

export class AsyncMutex {
  private locked = false;
  private queue: QueuedTask[] = [];

  /**
   * Acquire the lock. If already locked, wait until it's released.
   */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push({ resolve });
    });
  }

  /**
   * Release the lock and allow the next waiting task to proceed.
   */
  release(): void {
    const next = this.queue.shift();
    if (next) {
      next.resolve();
    } else {
      this.locked = false;
    }
  }

  /**
   * Execute a function while holding the lock.
   * Automatically releases the lock when done.
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Pre-created mutexes for common stores
export const postsMutex = new AsyncMutex();
export const bookmarksMutex = new AsyncMutex();
export const profilesMutex = new AsyncMutex();
export const messagesMutex = new AsyncMutex();
export const listsMutex = new AsyncMutex();
export const notificationsMutex = new AsyncMutex();
