import { Maybe } from '../maybe/maybe.js';
import { throwIfAborted } from '../result/index.js';

const INT32_MAX = 2_147_483_647;

/** Releases a lock. Releasing twice is a no-op. */
export interface LockHandle {
  release(): void | Promise<void>;
}

/**
 * Named lock over a resource key. Releasing the returned handle
 * releases the lock. Implementations that need a numeric key should derive it with a
 * stable hash (for example FNV-1a 64 over the UTF-8 bytes of the key).
 */
export interface ResourceLock {
  /**
   * Waits until the lock for `key` is acquired.
   * @param timeoutMs Maximum wait; `undefined` waits until `signal` aborts.
   * @throws LockTimeoutError when the lock is not acquired within `timeoutMs`.
   */
  acquire(key: string, timeoutMs?: number, signal?: AbortSignal): Promise<LockHandle>;
  /** Acquires the lock when it is free, without waiting; otherwise returns `None`. */
  tryAcquire(key: string, signal?: AbortSignal): Promise<Maybe<LockHandle>>;
}

/** Thrown when a lock is not acquired in time. */
export class LockTimeoutError extends Error {
  // Deliberately not 'TimeoutError': that name is treated as an abort by isAbortError.
  override readonly name = 'LockTimeoutError';
  constructor(
    readonly key: string,
    readonly timeoutMs: number,
  ) {
    super(`The lock for '${key}' was not acquired within ${formatDuration(timeoutMs)}.`);
  }
}

/**
 * Formats milliseconds as `[-][d.]hh:mm:ss[.fffffff]` for log and error messages.
 */
export function formatDuration(ms: number): string {
  let ticks = Math.round(ms * 10_000);
  const negative = ticks < 0;
  if (negative) ticks = -ticks;
  const ticksPerSecond = 10_000_000;
  const fraction = ticks % ticksPerSecond;
  let seconds = Math.floor(ticks / ticksPerSecond);
  const days = Math.floor(seconds / 86_400);
  seconds -= days * 86_400;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    (negative ? '-' : '') +
    (days > 0 ? `${days}.` : '') +
    `${pad(hours)}:${pad(minutes)}:${pad(secs)}` +
    (fraction > 0 ? `.${String(fraction).padStart(7, '0')}` : '')
  );
}

interface Waiter {
  grant(): void;
}

interface Entry {
  held: boolean;
  references: number;
  readonly waiters: Waiter[];
}

function validateKey(key: string): void {
  if (typeof key !== 'string') throw new TypeError('The lock key must be a string.');
  if (key.length === 0) throw new TypeError('The lock key must not be empty.');
}

/**
 * {@link ResourceLock} for a single process: one FIFO queue per key, removed when no caller
 * holds or waits for it. It does not coordinate several
 * processes. The lock is not reentrant: acquiring a key you already hold waits for yourself.
 */
export class InProcessResourceLock implements ResourceLock {
  readonly #entries = new Map<string, Entry>();

  /** Number of keys currently held or waited for. */
  get keyCount(): number {
    return this.#entries.size;
  }

  acquire(key: string, timeoutMs?: number, signal?: AbortSignal): Promise<LockHandle> {
    try {
      validateKey(key);
      if (
        timeoutMs !== undefined &&
        (Number.isNaN(timeoutMs) || timeoutMs < 0 || timeoutMs > INT32_MAX)
      ) {
        throw new RangeError(
          'The timeout must be zero or positive up to 2147483647 milliseconds, or undefined.',
        );
      }
      throwIfAborted(signal);
    } catch (error) {
      return Promise.reject(error);
    }

    const entry = this.#rent(key);
    if (!entry.held) {
      entry.held = true;
      return Promise.resolve(this.#handle(key, entry));
    }
    if (timeoutMs === 0) {
      this.#return(key, entry);
      return Promise.reject(new LockTimeoutError(key, 0));
    }

    return new Promise<LockHandle>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const index = entry.waiters.indexOf(waiter);
        if (index >= 0) entry.waiters.splice(index, 1);
      };
      const giveUp = (error: unknown): void => {
        cleanup();
        this.#return(key, entry);
        reject(error);
      };
      const onAbort = (): void => giveUp(signal?.reason);
      const waiter: Waiter = {
        grant: () => {
          cleanup();
          resolve(this.#handle(key, entry));
        },
      };
      entry.waiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => giveUp(new LockTimeoutError(key, timeoutMs)), timeoutMs);
      }
    });
  }

  tryAcquire(key: string, signal?: AbortSignal): Promise<Maybe<LockHandle>> {
    try {
      validateKey(key);
      throwIfAborted(signal);
    } catch (error) {
      return Promise.reject(error);
    }
    const entry = this.#rent(key);
    if (!entry.held) {
      entry.held = true;
      return Promise.resolve(Maybe.some(this.#handle(key, entry)));
    }
    this.#return(key, entry);
    return Promise.resolve(Maybe.none<LockHandle>());
  }

  #rent(key: string): Entry {
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      entry = { held: false, references: 0, waiters: [] };
      this.#entries.set(key, entry);
    }
    entry.references++;
    return entry;
  }

  #return(key: string, entry: Entry): void {
    if (--entry.references > 0) return;
    if (this.#entries.get(key) === entry) this.#entries.delete(key);
  }

  #handle(key: string, entry: Entry): LockHandle {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const next = entry.waiters.shift();
        if (next !== undefined) next.grant();
        else entry.held = false;
        this.#return(key, entry);
      },
    };
  }
}
