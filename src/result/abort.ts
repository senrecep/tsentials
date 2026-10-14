/**
 * Shared cancellation helpers — one rule:
 * "when the caller's token is cancelled the cancellation propagates; cancellation
 * from any other source is just an error".
 *
 * Import these from `tsentials/result` in any module that accepts an `AbortSignal`
 * (rules, maybe, http, resilience, …) so every module agrees on what counts as
 * the caller's abort.
 *
 * Two deliberate exceptions rethrow ANY abort-like error ({@link isAbortError}), whoever
 * aborted, because they cannot (or do not) compare against the caller's token:
 * - mediator `exceptionHandlingBehavior` (and the other mediator behaviors that share its
 *   cancellation check): an abort-like error is rethrown ahead of the generic catch, so a
 *   cancellation never becomes an error Result.
 * - sync `Maybe.fromTry`: a sync factory has no signal to compare with, so an abort-like
 *   error propagates instead of becoming `None`. (`Maybe.fromTryAsync` takes a signal and follows
 *   the caller-only rule.)
 */

/** Options accepted by every abort-aware operation. */
export interface AbortOptions {
  readonly signal?: AbortSignal | undefined;
}

/**
 * Returns true when `error` looks like a cancellation: an object whose `name` is
 * `'AbortError'` (`AbortController.abort()`, `fetch`) or `'TimeoutError'`
 * (`AbortSignal.timeout()`). Duck-typed — works for `DOMException` and plain errors.
 *
 * This says nothing about WHOSE signal was aborted; use {@link isCallerAbort} to
 * decide whether to propagate.
 */
export function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Returns true when `error` is the caller's own cancellation: `signal` is aborted
 * AND the error is `signal.reason` itself or an abort-like error
 * (see {@link isAbortError}). Both conditions are required.
 *
 * An `AbortError` raised while `signal` is NOT aborted (e.g. from an unrelated
 * controller) returns false — it should become an error Result.
 */
export function isCallerAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  return error === signal.reason || isAbortError(error);
}

/**
 * Rethrows `error` when it is the caller's own cancellation ({@link isCallerAbort});
 * otherwise returns normally so the caller can turn the error into a failure.
 *
 * @example
 * try { … } catch (e) {
 *   rethrowIfAborted(e, signal);
 *   return Result.failure(Err.fromException(e));
 * }
 */
export function rethrowIfAborted(error: unknown, signal: AbortSignal | undefined): void {
  if (isCallerAbort(error, signal)) throw error;
}

/**
 * Throws `signal.reason` when `signal` is already aborted. No-op without a signal.
 * Use between steps of a loop.
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason;
}

/**
 * Settles with `promise`, or rejects with `signal.reason` as soon as `signal`
 * aborts — whichever happens first.
 *
 * - Without a signal, returns `promise` unchanged.
 * - With an already-aborted signal, rejects immediately (checked explicitly, not
 *   left to `Promise.race` ordering).
 * - The abandoned `promise` is observed so a later rejection is never unhandled.
 * - The abort listener is removed once `promise` settles, so one long-lived signal
 *   can be reused for many calls without leaking listeners.
 *
 * Note: the underlying work is NOT stopped — pass the signal into it for that.
 */
export function withAbort<T>(promise: PromiseLike<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) {
    observe(promise);
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      observe(promise);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Marks a promise as handled so its rejection never surfaces as unhandled. */
export function observe(promise: PromiseLike<unknown>): void {
  Promise.resolve(promise).then(undefined, () => undefined);
}
