export interface QueueOptions {
  /** Max tasks running concurrently. */
  concurrency?: number;
  /** Hard timeout in ms after which a task is abandoned and its promise rejects. */
  timeoutMs?: number;
}

export class QueueTimeoutError extends Error {
  override readonly name = 'QueueTimeoutError';
  constructor(timeoutMs: number) {
    super(`Task exceeded ${timeoutMs}ms`);
  }
}

/**
 * Lightweight in-memory task queue with concurrency cap and hard timeout.
 *
 * Deliberately per-process (not Redis-backed): a shared queue would be a single
 * point of failure across all 8 bots, and the plan requires bot isolation.
 * Used to keep AI calls, web search and other slow external work off the
 * Discord gateway event loop.
 */
export class TaskQueue {
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private dropped = 0;

  constructor(opts: QueueOptions = {}) {
    this.concurrency = opts.concurrency ?? 2;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  get stats(): { active: number; pending: number; dropped: number } {
    return { active: this.active, pending: this.waiting.length, dropped: this.dropped };
  }

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiting.shift();
    if (next) next();
  }

  /**
   * Runs `task` respecting the concurrency cap. Rejects with QueueTimeoutError
   * if it exceeds `timeoutMs`. Backpressure: if the queue is longer than
   * `maxPending`, the task is rejected immediately instead of piling up.
   */
  async run<T>(task: () => Promise<T>, opts: { timeoutMs?: number; maxPending?: number } = {}): Promise<T> {
    const maxPending = opts.maxPending ?? 32;
    if (this.waiting.length >= maxPending) {
      this.dropped += 1;
      throw new ServiceBusyError();
    }

    await this.acquire();
    const timeout = opts.timeoutMs ?? this.timeoutMs;
    let timer: NodeJS.Timeout | undefined;
    const taskPromise = Promise.resolve().then(task);
    const trackedTask = taskPromise.finally(() => this.release());
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new QueueTimeoutError(timeout)), timeout);
      timer.unref?.();
    });

    try {
      // Stop waiting at the deadline, but retain the slot until the underlying
      // task settles so timeouts cannot exceed the concurrency limit.
      return await Promise.race([trackedTask, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export class ServiceBusyError extends Error {
  override readonly name = 'ServiceBusyError';
  constructor() {
    super('Service is busy, please retry shortly');
  }
}
