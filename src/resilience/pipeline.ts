import { isCallerAbort } from '../result/abort.js';
import type { Result } from '../result/result.js';
import { Result as R } from '../result/result.js';
import type { DateTimeProvider } from '../time/date-time-provider.js';
import { SystemDateTimeProvider } from '../time/date-time-provider.js';
import { toResilienceError } from './classifier.js';

/**
 * Waits `ms` milliseconds; must reject with `signal.reason` as soon as `signal` aborts
 * (and release its timer). Used for retry backoff and the timeout timer.
 */
export type DelayFn = (ms: number, signal: AbortSignal) => Promise<void>;

/**
 * Injectable time sources: for deterministic tests.
 * Defaults: `SystemDateTimeProvider` and a `setTimeout`-based delay, both of which
 * follow `vi.useFakeTimers()`.
 */
export interface ResilienceTime {
  /** Clock used by the circuit breaker (sampling windows, break duration). */
  readonly clock?: DateTimeProvider | undefined;
  /** Delay used by retry backoff and the timeout timer. */
  readonly delay?: DelayFn | undefined;
}

/** @internal Fully resolved {@link ResilienceTime}. */
export interface Clock {
  readonly clock: DateTimeProvider;
  readonly delay: DelayFn;
}

const defaultDelay: DelayFn = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

/** @internal */
export const resolveTime = (time: ResilienceTime | undefined): Clock => ({
  clock: time?.clock ?? SystemDateTimeProvider,
  delay: time?.delay ?? defaultDelay,
});

/**
 * @internal What one layer of the pipeline produced: a returned Result, or a thrown value
 *. Thrown values stay thrown until the policy boundary.
 */
export type Outcome<T> =
  | { readonly thrown: false; readonly result: Result<T> }
  | { readonly thrown: true; readonly error: unknown };

/** @internal Calls the next (inner) layer with the signal of the current layer. */
export type Next<T> = (signal: AbortSignal) => Promise<Outcome<T>>;

/** @internal One resilience strategy: wraps the inner layer. */
export type Strategy = <T>(signal: AbortSignal, next: Next<T>) => Promise<Outcome<T>>;

/** @internal Operation run by a policy, already normalised to return a Result. */
export type Operation<T> = (signal: AbortSignal) => PromiseLike<Result<T>> | Result<T>;

/** @internal */
export const thrown = <T>(error: unknown): Outcome<T> => ({ thrown: true, error });

/**
 * @internal Runs a layer safely: when `signal` is
 * already aborted the layer is NOT invoked and the outcome is `signal.reason`; anything the
 * layer throws becomes a thrown outcome.
 */
export async function invoke<T>(next: Next<T>, signal: AbortSignal): Promise<Outcome<T>> {
  if (signal.aborted) return thrown(signal.reason);
  try {
    return await next(signal);
  } catch (error) {
    return thrown(error);
  }
}

const runOperation = async <T>(
  operation: Operation<T>,
  signal: AbortSignal,
): Promise<Outcome<T>> => {
  try {
    return { thrown: false, result: await operation(signal) };
  } catch (error) {
    return thrown(error);
  }
};

/**
 * @internal Executes `operation` through `strategies` (outermost first) and converts the final
 * outcome at the boundary:
 *
 * - thrown caller abort → rethrown (the promise rejects with it);
 * - any other thrown value → failure via {@link toResilienceError};
 * - returned Result while the caller's signal is aborted and `isRetryable(result)` → rejects with
 *   `signal.reason` (cancellation wins over returning a transient failure); an `isRetryable`
 *   that throws at that point also rejects with `signal.reason`;
 * - otherwise the returned Result.
 *
 * With no strategies the operation runs directly, even on an already-aborted signal; every strategy pre-checks its signal before running.
 */
export async function runPipeline<T>(
  strategies: readonly Strategy[],
  operation: Operation<T>,
  callerSignal: AbortSignal | undefined,
  isRetryable: (result: Result<T>) => boolean,
): Promise<Result<T>> {
  const signal = callerSignal ?? new AbortController().signal;

  const innermost: Next<T> = (s) => runOperation(operation, s);
  const chain = strategies.reduceRight<Next<T>>(
    (inner, strategy) => (s) => strategy(s, (innerSignal) => invoke(inner, innerSignal)),
    innermost,
  );

  // Neither `runOperation` nor `invoke` throws: every error is already a thrown outcome.
  const outcome = strategies.length === 0 ? await chain(signal) : await invoke(chain, signal);

  if (outcome.thrown) {
    if (isCallerAbort(outcome.error, callerSignal)) throw outcome.error;
    return R.failure(toResilienceError(outcome.error));
  }
  if (callerSignal?.aborted) {
    // A throwing classifier after a caller abort must not surface as a non-abort rejection:
    // cancellation wins.
    let retryable: boolean;
    try {
      retryable = isRetryable(outcome.result);
    } catch {
      throw callerSignal.reason;
    }
    if (retryable) throw callerSignal.reason;
  }
  return outcome.result;
}
