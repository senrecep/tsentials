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
  /**
   * Replaces the default classification: retry while this returns true for the first error.
   * A thrown value is converted to the error the call would return for it (Unexpected) and passed
   * here too. Caller aborts are never retried. Keep it pure — it can be called more than once for
   * the same attempt. If it throws while classifying an attempt, retrying stops and the throw is
   * returned as an Unexpected error.
   */
  readonly shouldRetry?: ((error: AppError) => boolean) | undefined;
  readonly time?: ResilienceTime | undefined;
}

/** An operation run by a policy; receives the signal of the innermost strategy. */
export type ResilienceAction<T> = (signal: AbortSignal) => PromiseLike<Result<T>> | Result<T>;

/** Retry predicate shared by `withRetry` and `retryIfFailed` without a custom predicate. */
const defaultRetryHandle = (outcome: Outcome<unknown>, signal: AbortSignal): boolean =>
  outcome.thrown ? !isCallerAbort(outcome.error, signal) : isRetryable(outcome.result);

/** Circuit breaker counts any thrown value and every retryable failure. */
const circuitBreakerHandle = (outcome: Outcome<unknown>): boolean =>
  outcome.thrown || isRetryable(outcome.result);

/**
 * Composable, immutable resilience pipeline returning `Result`s. Every `with…` call returns a NEW policy with the strategy
 * appended INSIDE the existing ones — the first strategy added is the outermost — except
 * {@link withFallback}, which is always placed outermost.
 *
 * `T` is the value type of the fallback. Leave it as the default (`never`) when no fallback is
 * used; `execute` then infers its type per call.
 *
 * Outcome rules (identical for every policy):
 * - a thrown value becomes a failure — `Resilience.Timeout`, `Resilience.CircuitBroken`, or
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
   * the strategies are added in this order: retry, circuit breaker, timeout — so the timeout applies
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
   * failures; defaults: 3 retries, 1000 ms, exponential (1 s, 2 s, 4 s). No jitter.
   * @throws RangeError for `maxAttempts < 1` or `delay` outside 0 … 1 day.
   */
  withRetry(options?: RetryOptions): ResiliencePolicy<T> {
    return this.add(retryStrategy(resolveRetry(options), this.time, defaultRetryHandle));
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
   * by the timeout) — pass it on to the underlying I/O.
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
      // A throwing predicate stops retrying: the throw becomes the Unexpected failure of the
      // call (see RetryIfFailedOptions.shouldRetry), except after a caller abort, where the
      // cancellation wins and the call rejects with the abort reason.
      const shouldRetry =
        customRetry === undefined
          ? undefined
          : (error: AppError): boolean => {
              try {
                return customRetry(error);
              } catch (predicateError) {
                if (callerSignal?.aborted) throw callerSignal.reason;
                throw predicateError;
              }
            };

      const handle =
        shouldRetry === undefined
          ? defaultRetryHandle
          : (outcome: Outcome<unknown>, signal: AbortSignal): boolean => {
              if (outcome.thrown) {
                return (
                  !isCallerAbort(outcome.error, signal) &&
                  shouldRetry(toResilienceError(outcome.error))
                );
              }
              const first = outcome.result.ok ? undefined : outcome.result.errors[0];
              return first !== undefined && shouldRetry(first);
            };

      const postCheck =
        shouldRetry === undefined
          ? isRetryable
          : (result: Result<T>): boolean => {
              const first = result.ok ? undefined : result.errors[0];
              return first !== undefined && shouldRetry(first);
            };

      return runPipeline<T>(
        [retryStrategy(config, resolveTime(options?.time), handle)],
        operation,
        options?.signal,
        postCheck,
      );
    })(),
  );
}
