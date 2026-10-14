import { Err } from '../errors/app-error.js';
import { isAbortError, isCallerAbort } from '../result/abort.js';
import type { Result } from '../result/result.js';
import { Result as R } from '../result/result.js';
import { TimeoutRejectedError } from './classifier.js';
import type { Clock, Next, Operation, Outcome, Strategy } from './pipeline.js';
import { invoke, thrown } from './pipeline.js';

const ONE_DAY_MS = 86_400_000;
/** Largest delay `setTimeout` honours; longer computed backoffs are clamped to it. */
const MAX_DELAY_MS = 2_147_483_647;

/**
 * How the retry delay grows between attempts.
 * For attempt `n` (0-based, i.e. before retry `n + 1`) with base delay `d`:
 * - `'constant'`: `d`
 * - `'linear'`: `(n + 1) · d`
 * - `'exponential'`: `d · 2ⁿ`
 */
export type BackoffType = 'constant' | 'linear' | 'exponential';

/** Retry settings. */
export interface RetryOptions {
  /**
   * Number of RETRIES after the first attempt, so the operation runs at most
   * `maxAttempts + 1` times. Integer ≥ 1. Default 3.
   */
  readonly maxAttempts?: number | undefined;
  /** Delay before the first retry in ms, 0 … 86 400 000 (1 day). Default 1000. */
  readonly delay?: number | undefined;
  /** `true` (default) → exponential backoff, `false` → constant delay. */
  readonly exponentialBackoff?: boolean | undefined;
  /**
   * Explicit backoff type; overrides `exponentialBackoff` when set.
   */
  readonly backoff?: BackoffType | undefined;
}

/** Timeout settings. */
export interface TimeoutOptions {
  /** Per-execution timeout in ms, 10 … 86 400 000 (1 day). Default 30 000. */
  readonly timeout?: number | undefined;
}

/** @internal */
export interface RetryConfig {
  readonly maxAttempts: number;
  readonly delay: number;
  readonly backoff: BackoffType;
}

/** @internal */
export const assertDuration = (name: string, value: number, min: number, max: number): void => {
  if (!(Number.isFinite(value) && value >= min && value <= max)) {
    throw new RangeError(`${name} must be between ${min} and ${max} ms (got ${value}).`);
  }
};

/** @internal Applies the defaults and validates the options. */
export function resolveRetry(options: RetryOptions | undefined): RetryConfig {
  const maxAttempts = options?.maxAttempts ?? 3;
  const delay = options?.delay ?? 1000;
  const backoff =
    options?.backoff ?? ((options?.exponentialBackoff ?? true) ? 'exponential' : 'constant');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be an integer >= 1 (got ${maxAttempts}).`);
  }
  assertDuration('delay', delay, 0, ONE_DAY_MS);
  if (backoff !== 'constant' && backoff !== 'linear' && backoff !== 'exponential') {
    throw new RangeError(`backoff must be 'constant', 'linear' or 'exponential' (got ${backoff}).`);
  }
  return { maxAttempts, delay, backoff };
}

/** @internal */
export function resolveTimeout(timeout: number | TimeoutOptions): number {
  const ms = typeof timeout === 'number' ? timeout : (timeout.timeout ?? 30_000);
  assertDuration('timeout', ms, 10, ONE_DAY_MS);
  return ms;
}

/** @internal Computes the retry delay (no jitter). */
export function retryDelay(backoff: BackoffType, attempt: number, base: number): number {
  const delay =
    backoff === 'constant'
      ? base
      : backoff === 'linear'
        ? (attempt + 1) * base
        : base * 2 ** attempt;
  return Math.min(delay, MAX_DELAY_MS);
}

/**
 * @internal Retry strategy. After each attempt:
 * stop when this layer's signal is aborted, when it was the last attempt, or when
 * `shouldHandle` rejects the outcome; otherwise wait the backoff delay (abortable, an abort
 * during the delay becomes the outcome) and try again.
 */
export function retryStrategy(
  config: RetryConfig,
  time: Clock,
  shouldHandle: (outcome: Outcome<unknown>, signal: AbortSignal) => boolean,
): Strategy {
  return async <T>(signal: AbortSignal, next: Next<T>): Promise<Outcome<T>> => {
    // `shouldHandle` runs after every attempt, even when the answer no longer matters.
    const retries = (outcome: Outcome<T>, attempt: number): boolean => {
      const handle = shouldHandle(outcome, signal);
      return !signal.aborted && attempt < config.maxAttempts && handle;
    };
    let outcome = await invoke(next, signal);
    for (let attempt = 0; retries(outcome, attempt); attempt++) {
      const delay = retryDelay(config.backoff, attempt, config.delay);
      try {
        // Also for a zero delay: yielding a macrotask between attempts lets a timer-based
        // signal (timeout, caller abort) fire even when the action settles synchronously.
        await time.delay(delay, signal);
      } catch (error) {
        return thrown(error);
      }
      outcome = await invoke(next, signal);
    }
    return outcome;
  };
}

/**
 * @internal Cooperative timeout. The inner layer gets a
 * signal that aborts with a `TimeoutError` when the timer fires (or with the outer reason when
 * the outer signal aborts). The outcome becomes `Resilience.Timeout` only when the timer fired,
 * the outer signal is not aborted and the inner layer threw an abort-like error. An operation
 * that ignores the signal is NOT abandoned: its own outcome is returned, even after the deadline.
 */
export function timeoutStrategy(timeout: number, time: Clock): Strategy {
  return async <T>(signal: AbortSignal, next: Next<T>): Promise<Outcome<T>> => {
    const inner = new AbortController();
    const timer = new AbortController();
    const onOuterAbort = (): void => inner.abort(signal.reason);
    signal.addEventListener('abort', onOuterAbort, { once: true });
    time.delay(timeout, timer.signal).then(
      () =>
        inner.abort(
          new DOMException(
            `The operation didn't complete within the allowed timeout of ${timeout} ms.`,
            'TimeoutError',
          ),
        ),
      () => undefined,
    );
    try {
      const outcome = await invoke(next, inner.signal);
      if (
        outcome.thrown &&
        inner.signal.aborted &&
        !signal.aborted &&
        (outcome.error === inner.signal.reason || isAbortError(outcome.error))
      ) {
        return thrown(
          new TimeoutRejectedError(
            `The operation didn't complete within the allowed timeout of ${timeout} ms.`,
          ),
        );
      }
      return outcome;
    } finally {
      timer.abort();
      signal.removeEventListener('abort', onOuterAbort);
    }
  };
}

/**
 * @internal Fallback: handles ANY failed Result and any thrown value
 * except this layer's caller abort. Does not run when the signal is aborted. A value or
 * Result from `fallback` replaces the outcome; if `fallback` throws (not a caller abort) the
 * outcome is `Err.fromException(e)` (type Failure).
 */
export function fallbackStrategy<T>(fallback: Operation<T>): Strategy {
  const run = async (signal: AbortSignal, next: Next<T>): Promise<Outcome<T>> => {
    const outcome = await invoke(next, signal);
    const handle = outcome.thrown ? !isCallerAbort(outcome.error, signal) : !outcome.result.ok;
    if (!handle) return outcome;
    if (signal.aborted) return thrown(signal.reason);
    try {
      const result: Result<T> = await fallback(signal);
      return { thrown: false, result };
    } catch (error) {
      if (isCallerAbort(error, signal)) return thrown(error);
      return { thrown: false, result: R.failure(Err.fromException(error)) };
    }
  };
  return run as Strategy;
}
