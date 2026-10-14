import type { AppError } from '../errors/app-error.js';
import { Err } from '../errors/app-error.js';
import { ErrorType } from '../errors/error-type.js';
import type { Result } from '../result/result.js';

/** Error codes produced by the resilience strategies. */
export const ResilienceErrorCode = {
  /** The timeout strategy cancelled the operation — `Err.failure('Resilience.Timeout', …)`. */
  Timeout: 'Resilience.Timeout',
  /** The circuit breaker rejected the call — `Err.failure('Resilience.CircuitBroken', …)`. */
  CircuitBroken: 'Resilience.CircuitBroken',
} as const;

export type ResilienceErrorCode = (typeof ResilienceErrorCode)[keyof typeof ResilienceErrorCode];

/**
 * Thrown inside the pipeline when the timeout strategy cancels an attempt. Deliberately NOT abort-like (`name` is not `AbortError` /
 * `TimeoutError`), so outer strategies treat it as an ordinary failure. Never escapes
 * the policy — it is mapped to {@link ResilienceErrorCode.Timeout} at the boundary.
 */
export class TimeoutRejectedError extends Error {
  override readonly name = 'TimeoutRejectedError';
}

/**
 * Thrown inside the pipeline when the circuit breaker rejects a call. Mapped to {@link ResilienceErrorCode.CircuitBroken} at the boundary.
 */
export class BrokenCircuitError extends Error {
  override readonly name = 'BrokenCircuitError';
}

const NON_RETRYABLE: ReadonlySet<ErrorType> = new Set<ErrorType>([
  ErrorType.Unauthorized,
  ErrorType.Forbidden,
  ErrorType.NotFound,
  ErrorType.Validation,
]);

/**
 * The default transient-failure rule shared by retry, circuit breaker and the
 * cancellation check: a failed result is retryable
 * unless its FIRST error is `Unauthorized`, `Forbidden`, `NotFound` or `Validation` —
 * running the operation again would give the same answer. Every other failure type
 * (`Failure`, `Unexpected`, `Conflict`, `Unknown`) is transient. A success is never retryable.
 */
export function isRetryable<T>(result: Result<T>): boolean {
  if (result.ok) return false;
  const first = result.errors[0];
  return first === undefined || !NON_RETRYABLE.has(first.type);
}

/**
 * Converts a thrown value to the error a policy returns for it:
 * timeout → `Resilience.Timeout`, open circuit → `Resilience.CircuitBroken` (both `Failure`),
 * anything else → `Err.fromException(e, Unexpected)`.
 */
export function toResilienceError(error: unknown): AppError {
  if (error instanceof BrokenCircuitError) {
    return Err.failure(ResilienceErrorCode.CircuitBroken, 'Circuit breaker is open.');
  }
  if (error instanceof TimeoutRejectedError) {
    return Err.failure(ResilienceErrorCode.Timeout, 'Operation timed out.');
  }
  return Err.fromException(error, ErrorType.Unexpected);
}
