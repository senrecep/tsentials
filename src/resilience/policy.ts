import type { AppError } from '../errors/app-error.js';
import type { AbortOptions } from '../result/abort.js';
import { isCallerAbort } from '../result/abort.js';
import type { Result } from '../result/result.js';
import { Result as R } from '../result/result.js';
import { ResultAsync } from '../result/result-async.js';
import type { CircuitBreakerOptions } from './circuit-breaker.js';
import { circuitBreakerStrategy, resolveCircuitBreaker } from './circuit-breaker.js';
import { isRetryable, toResilienceError } from './classifier.js';
import type { Clock, Outcome, ResilienceTime, Strategy } from './pipeline.js';
import { resolveTime, runPipeline } from './pipeline.js';
import type { RetryOptions, TimeoutOptions } from './strategies.js';
import {
  fallbackStrategy,
  resolveRetry,
  resolveTimeout,
  retryStrategy,
  timeoutStrategy,
} from './strategies.js';

/** Options for {@link ResiliencePolicy.create}. */
export interface ResiliencePolicyOptions {
  readonly retry?: RetryOptions | undefined;
  readonly circuitBreaker?: CircuitBreakerOptions | undefined;
  readonly timeout?: TimeoutOptions | undefined;
  /** Clock / delay used by every strategy added to this policy (tests). */
  readonly time?: ResilienceTime | undefined;
}

/** Options for {@link retryIfFailed}. */
export interface RetryIfFailedOptions extends RetryOptions, AbortOptions {
  readonly time?: ResilienceTime | undefined;
}

/** An operation run by a policy; receives the signal of the innermost strategy. */
export type ResilienceAction<T> = (signal: AbortSignal) => PromiseLike<Result<T>> | Result<T>;

/** Retry predicate shared by `withRetry` and `retryIfFailed` without a custom predicate. */
const defaultRetryHandle = (outcome: Outcome<unknown>, signal: AbortSignal): boolean =>
  outcome.thrown ? !isCallerAbort(outcome.error, signal) : isRetryable(outcome.result);

/**
 * Wraps a custom `shouldRetry`: a throwing predicate stops retrying (the throw becomes the
 * Unexpected failure of the call), except after an abort of `signal`, where the cancellation
 * wins and the abort reason is thrown instead.
 */
const guardShouldRetry =
  (shouldRetry: (error: AppError) => boolean, signal: () => AbortSignal | undefined) =>
  (error: AppError): boolean => {
    try {
      return shouldRetry(error);
    } catch (predicateError) {
      const aborted = signal();
      if (aborted?.aborted) throw aborted.reason;
      throw predicateError;
    }
  };

/** Retry predicate of `withRetry` and `retryIfFailed`; `undefined` uses the default one. */
function retryHandle(
  shouldRetry: ((error: AppError) => boolean) | undefined,
): (outcome: Outcome<unknown>, signal: AbortSignal) => boolean {
  if (shouldRetry === undefined) return defaultRetryHandle;
  return (outcome, signal) => {
    const guarded = guardShouldRetry(shouldRetry, () => signal);
    if (outcome.thrown) {
      return !isCallerAbort(outcome.error, signal) && guarded(toResilienceError(outcome.error));
    }
    const first = outcome.result.ok ? undefined : outcome.result.errors[0];
    return first !== undefined && guarded(first);
  };
}

/** Circuit breaker counts any thrown value and every retryable failure. */
const circuitBreakerHandle = (outcome: Outcome<unknown>): boolean =>
  outcome.thrown || isRetryable(outcome.result);

/**
 * Composable, immutable resilience pipeline returning `Result`s. Every `with…` call returns a NEW policy with the strategy
 * appended INSIDE the existing ones: the first strategy added is the outermost, except
 * {@link withFallback}, which is always placed outermost.
 *
 * `T` is the value type of the fallback. Leave it as the default (`never`) when no fallback is
 * used; `execute` then infers its type per call.
 *
 * Outcome rules (identical for every policy):
 * - a thrown value becomes a failure, `Resilience.Timeout`, `Resilience.CircuitBroken`, or
 *   `Err.fromException(e, Unexpected)`;
 * - an abort of the caller's `signal` rejects the returned promise with the abort reason, also
 *   when the last attempt returned a retryable failure while the caller was aborting;
 * - non-retryable failures (Validation, NotFound, Unauthorized, Forbidden) pass straight through.
 *
 * @example
 * const policy = ResiliencePolicy.create()
 *   .withRetry({ maxAttempts: 3, delay: 200 })
 *   .withCircuitBreaker()
 *   .withTimeout(5_000);
 *
 * const user = await policy.execute(signal => fetchResult.get<User>('/users/42', { signal }));
 */
export class ResiliencePolicy<T = never> {
  private constructor(
    private readonly strategies: readonly Strategy[],
    private readonly time: Clock,
  ) {}

  /**
   * Creates a policy. Without options it is empty (the action runs directly, once). With options
   * the strategies are added in this order: retry, circuit breaker, timeout, so the timeout applies
   * to EACH attempt and every attempt is counted by the circuit breaker.
   */
  static create<T = never>(options?: ResiliencePolicyOptions): ResiliencePolicy<T> {
    let policy = new ResiliencePolicy<T>([], resolveTime(options?.time));
    if (options?.retry !== undefined) policy = policy.withRetry(options.retry);
    if (options?.circuitBreaker !== undefined) {
      policy = policy.withCircuitBreaker(options.circuitBreaker);
    }
    if (options?.timeout !== undefined) policy = policy.withTimeout(options.timeout);
    return policy;
  }

  private add(strategy: Strategy): ResiliencePolicy<T> {
    return new ResiliencePolicy<T>([...this.strategies, strategy], this.time);
  }

  /**
   * Adds a retry strategy. Retries thrown values (except the caller's abort) and retryable
   * failures (or what `shouldRetry` accepts); defaults: 3 retries, 1000 ms, exponential (1 s, 2 s,
   * 4 s). No jitter. A failure with `retryAfterMs` metadata waits at least that long, capped at
   * `maxRetryAfterMs` (default 30 s).
   * @throws RangeError for `maxAttempts < 1`, or `delay` / `maxRetryAfterMs` outside 0 … 1 day.
   */
  withRetry(options?: RetryOptions): ResiliencePolicy<T> {
    return this.add(
      retryStrategy(resolveRetry(options), this.time, retryHandle(options?.shouldRetry)),
    );
  }

  /**
   * Adds a cooperative timeout : the action's signal aborts after `timeout` ms and the
   * resulting abort becomes `Resilience.Timeout`. An action that ignores its signal is not
   * abandoned. Default 30 000 ms when an options object without `timeout` is given.
   * @throws RangeError when the timeout is outside 10 ms … 1 day.
   */
  withTimeout(timeout: number | TimeoutOptions): ResiliencePolicy<T> {
    return this.add(timeoutStrategy(resolveTimeout(timeout), this.time));
  }

  /**
   * Adds a circuit breaker (defaults: minimumThroughput 10, samplingDuration 60 s,
   * breakDuration 30 s, failureRatio 0.5). Counts thrown values and retryable failures; Validation /
   * NotFound / Unauthorized / Forbidden count as successes. The circuit state is created here and
   * shared by every policy derived from the returned one.
   * @throws RangeError for out-of-range options (see {@link CircuitBreakerOptions}).
   */
  withCircuitBreaker(options?: CircuitBreakerOptions): ResiliencePolicy<T> {
    return this.add(
      circuitBreakerStrategy(resolveCircuitBreaker(options), this.time, circuitBreakerHandle),
    );
  }

  /**
   * Places a fallback OUTSIDE all strategies. It replaces ANY failure (including Validation) and
   * any thrown value except the caller's abort with `Result.success(await fallback(signal))`.
   * If `fallback` itself throws, the result is `Err.fromException(e)` (type Failure).
   */
  withFallback(fallback: (signal: AbortSignal) => PromiseLike<T> | T): ResiliencePolicy<T> {
    return this.withFallbackResult(async (signal) => R.success(await fallback(signal)));
  }

  /** Like {@link withFallback}, but the fallback returns a `Result` that is used as is. */
  withFallbackResult(fallback: ResilienceAction<T>): ResiliencePolicy<T> {
    return new ResiliencePolicy<T>([fallbackStrategy(fallback), ...this.strategies], this.time);
  }

  /**
   * Runs `action` through the policy. Never rejects except with the caller's abort reason.
   * The action receives the signal of the innermost strategy (aborted by the caller's signal and
   * by the timeout): pass it on to the underlying I/O.
   */
  execute<U = T>(action: ResilienceAction<U>, options?: AbortOptions): ResultAsync<U | T> {
    return ResultAsync.from(
      runPipeline<U | T>(this.strategies, action, options?.signal, isRetryable),
    );
  }

  /** Like {@link execute} for an action returning a plain value (wrapped as success). */
  executeValue<U = T>(
    action: (signal: AbortSignal) => PromiseLike<U> | U,
    options?: AbortOptions,
  ): ResultAsync<U | T> {
    return this.execute<U>(async (signal) => R.success(await action(signal)), options);
  }
}

/**
 * Retries `operation` while it returns a retryable failure or throws.
 * Unauthorized, Forbidden, NotFound and Validation failures are not retried (unless a custom
 * `shouldRetry` says so). An abort of `options.signal` is never retried and rejects the returned
 * promise with the abort reason. `maxAttempts` counts RETRIES: the operation runs at most
 * `maxAttempts + 1` times.
 *
 * @example
 * const result = await retryIfFailed(signal => loadOrder(id, signal), { maxAttempts: 2, delay: 100 });
 */
export function retryIfFailed<T>(
  operation: ResilienceAction<T>,
  options?: RetryIfFailedOptions,
): ResultAsync<T> {
  // Invalid options reject the returned promise.
  return ResultAsync.from(
    (async (): Promise<Result<T>> => {
      const config = resolveRetry(options);
      const customRetry = options?.shouldRetry;
      const callerSignal = options?.signal;
      const postCheck =
        customRetry === undefined
          ? isRetryable
          : (result: Result<T>): boolean => {
              const first = result.ok ? undefined : result.errors[0];
              return (
                first !== undefined && guardShouldRetry(customRetry, () => callerSignal)(first)
              );
            };

      return runPipeline<T>(
        [retryStrategy(config, resolveTime(options?.time), retryHandle(customRetry))],
        operation,
        options?.signal,
        postCheck,
      );
    })(),
  );
}
