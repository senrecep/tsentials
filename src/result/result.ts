import type { AppError } from '../errors/app-error.js';
import { Err } from '../errors/app-error.js';
import type { ErrorType } from '../errors/error-type.js';
import {
  type AbortOptions,
  isCallerAbort,
  observe,
  rethrowIfAborted,
  throwIfAborted,
  withAbort,
} from './abort.js';

/**
 * Result<T> represents either a successful value or one or more errors.
 * Uses a discriminated union for zero-cost type narrowing at compile time.
 *
 * Design notes:
 * - Discriminated union `{ ok: true; value: T } | { ok: false; errors: ... }`
 *   for zero-cost type narrowing at compile time
 * - `Result` namespace merging: same identifier works as both type and factory
 * - Sync + async pipeline in one file
 * - No implicit conversions — explicit `Result.success()` / `Result.failure()`
 */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly AppError[] };

/**
 * Non-generic Result for operations with no meaningful return value.
 */
export type VoidResult = Result<void>;

// biome-ignore lint/suspicious/noConfusingVoidType: void is required here to match the Result<void> type
const _success = Object.freeze({ ok: true as const, value: undefined as void });

export const Result = {
  // ─── FACTORIES ────────────────────────────────────────────────────────────

  /**
   * Creates a successful Result wrapping a value.
   */
  success<T>(value: T): Result<T> {
    return Object.freeze({ ok: true, value }) as Result<T>;
  },

  /**
   * Creates a successful void Result.
   */
  ok(): VoidResult {
    return _success;
  },

  /**
   * Creates a failed Result with one or more errors.
   */
  failure<T = never>(...errors: AppError[]): Result<T> {
    if (errors.length === 0) {
      throw new Error('Result.failure requires at least one error.');
    }
    return Object.freeze({ ok: false, errors: Object.freeze([...errors]) }) as Result<T>;
  },

  /**
   * Creates a failed Result from an array of errors.
   */
  failureFrom<T = never>(errors: readonly AppError[]): Result<T> {
    if (errors.length === 0) {
      throw new Error('Result.failureFrom requires at least one error.');
    }
    return Object.freeze({ ok: false, errors: Object.freeze([...errors]) }) as Result<T>;
  },

  // ─── TYPE GUARDS ──────────────────────────────────────────────────────────

  isSuccess<T>(result: Result<T>): result is { ok: true; value: T } {
    return result.ok;
  },

  isFailure<T>(result: Result<T>): result is { ok: false; errors: readonly AppError[] } {
    return !result.ok;
  },

  // ─── ERROR ACCESSORS ──────────────────────────────────────────────────────

  firstError<T>(result: Result<T>): AppError {
    if (result.ok)
      return Err.unexpected(
        'Result.NoFirstError',
        'First error cannot be retrieved from a successful Result.',
      );
    return result.errors[0] ?? Err.unexpected('Result.Empty', 'No errors found.');
  },

  lastError<T>(result: Result<T>): AppError {
    if (result.ok)
      return Err.unexpected(
        'Result.NoLastError',
        'Last error cannot be retrieved from a successful Result.',
      );
    return (
      result.errors[result.errors.length - 1] ?? Err.unexpected('Result.Empty', 'No errors found.')
    );
  },

  // ─── CONDITIONAL CREATION ─────────────────────────────────────────────────

  /**
   * Returns success if condition is true, failure otherwise.
   */
  successIf<T>(condition: boolean, value: T, error: AppError): Result<T> {
    return condition ? Result.success(value) : Result.failure(error);
  },

  /**
   * Returns failure if condition is true, success otherwise.
   */
  failIf<T>(condition: boolean, value: T, error: AppError): Result<T> {
    return condition ? Result.failure(error) : Result.success(value);
  },

  // ─── RAILWAY PIPELINE ─────────────────────────────────────────────────────

  /**
   * Chains a function that returns a new Result (monadic bind).
   * Short-circuits on failure — the function is not called.
   */
  // biome-ignore lint/suspicious/noThenProperty: intentional monadic bind method on Result namespace, not a Promise
  then<T, U>(result: Result<T>, fn: (value: T) => Result<U>): Result<U> {
    return result.ok ? fn(result.value) : Result.failureFrom<U>(result.errors);
  },

  /**
   * Transforms the success value (functor map).
   */
  map<T, U>(result: Result<T>, fn: (value: T) => U): Result<U> {
    return result.ok ? Result.success(fn(result.value)) : Result.failureFrom<U>(result.errors);
  },

  /**
   * Guards the success value with a predicate.
   * An error factory is called only when the predicate fails (lazy).
   */
  ensure<T>(
    result: Result<T>,
    predicate: (value: T) => boolean,
    error: AppError | ((value: T) => AppError),
  ): Result<T> {
    if (!result.ok) return result;
    return predicate(result.value) ? result : Result.failure(resolveError(error, result.value));
  },

  /**
   * Runs a side effect on success without altering the result.
   */
  tap<T>(result: Result<T>, fn: (value: T) => void): Result<T> {
    if (result.ok) fn(result.value);
    return result;
  },

  /**
   * Runs a side effect on failure without altering the result.
   */
  tapError<T>(result: Result<T>, fn: (errors: readonly AppError[]) => void): Result<T> {
    if (!result.ok) fn(result.errors);
    return result;
  },

  /**
   * Transforms errors on failure (error functor map).
   */
  mapError<T>(result: Result<T>, fn: (errors: readonly AppError[]) => AppError[]): Result<T> {
    if (result.ok) return result;
    return Result.failureFrom<T>(fn(result.errors));
  },

  /**
   * Maps every error of a failed Result, one by one and in order.
   * On success the mapper is never called.
   *
   * @example
   * Result.mapEachError(r, e => ({ ...e, code: `Api.${e.code}` }));
   */
  mapEachError<T>(result: Result<T>, fn: (error: AppError) => AppError): Result<T> {
    if (result.ok) return result;
    return Result.failureFrom<T>(result.errors.map((e) => fn(e)));
  },

  /**
   * Exhaustive pattern match — extracts a value from either branch.
   */
  match<T, U>(
    result: Result<T>,
    onSuccess: (value: T) => U,
    onError: (errors: readonly AppError[]) => U,
  ): U {
    return result.ok ? onSuccess(result.value) : onError(result.errors);
  },

  /**
   * Returns a fallback Result on failure.
   */
  else<T>(result: Result<T>, fallback: T | ((errors: readonly AppError[]) => T)): Result<T> {
    if (result.ok) return result;
    const value =
      typeof fallback === 'function'
        ? (fallback as (errors: readonly AppError[]) => T)(result.errors)
        : fallback;
    return Result.success(value);
  },

  /**
   * Returns the success value, or computes one from the errors.
   *
   * @deprecated Returns `T`, not a Result — use {@link Result.unwrapOrElse}, which is identical.
   */
  elseWith<T>(result: Result<T>, factory: (errors: readonly AppError[]) => T): T {
    return Result.unwrapOrElse(result, factory);
  },

  /**
   * Recovers from failure by returning a new Result.
   */
  compensate<T>(result: Result<T>, fn: (errors: readonly AppError[]) => Result<T>): Result<T> {
    return result.ok ? result : fn(result.errors);
  },

  /**
   * Wraps a throwing function, catching exceptions as Result.failure.
   */
  try<T>(fn: () => T, onError?: (error: unknown) => AppError): Result<T> {
    try {
      return Result.success(fn());
    } catch (e) {
      return Result.failure(onError ? onError(e) : Err.fromException(e));
    }
  },

  /**
   * Async version of Result.try.
   *
   * With `{ signal }`: `fn` receives the signal, and when the caller's signal is aborted
   * the abort PROPAGATES (the promise rejects with it) instead of becoming a failure —
   * even if `fn` ignores the signal. An abort-like error while the signal is not aborted
   * (another source) still becomes a failure. `fn` is invoked even when the signal is
   * already aborted; the call then rejects with `signal.reason`.
   *
   * @example
   * await Result.tryAsync((signal) => fetch(url, { signal }), { signal });
   * await Result.tryAsync(() => load(), e => Err.unexpected('Load.Failed', String(e)), { signal });
   */
  async tryAsync<T>(
    fn: (signal?: AbortSignal) => PromiseLike<T>,
    onErrorOrOptions?: ((error: unknown) => AppError) | AbortOptions,
    options?: AbortOptions,
  ): Promise<Result<T>> {
    const onError = typeof onErrorOrOptions === 'function' ? onErrorOrOptions : undefined;
    const signal = (typeof onErrorOrOptions === 'object' ? onErrorOrOptions : options)?.signal;
    try {
      return Result.success(await withAbort(fn(signal), signal));
    } catch (e) {
      rethrowIfAborted(e, signal);
      return Result.failure(onError ? onError(e) : Err.fromException(e));
    }
  },

  // ─── ASYNC PIPELINE ───────────────────────────────────────────────────────

  /**
   * Async version of Result.then.
   */
  async thenAsync<T, U>(
    result: Result<T>,
    fn: (value: T) => Promise<Result<U>>,
  ): Promise<Result<U>> {
    return result.ok ? fn(result.value) : Result.failureFrom<U>(result.errors);
  },

  /**
   * Async version of Result.map.
   */
  async mapAsync<T, U>(result: Result<T>, fn: (value: T) => Promise<U>): Promise<Result<U>> {
    return result.ok
      ? Result.success(await fn(result.value))
      : Result.failureFrom<U>(result.errors);
  },

  /**
   * Async version of Result.ensure. The error factory is called only when the predicate fails.
   */
  async ensureAsync<T>(
    result: Result<T>,
    predicate: (value: T) => Promise<boolean>,
    error: AppError | ((value: T) => AppError),
  ): Promise<Result<T>> {
    if (!result.ok) return result;
    return (await predicate(result.value))
      ? result
      : Result.failure(resolveError(error, result.value));
  },

  // ─── COMBINATION ──────────────────────────────────────────────────────────

  /**
   * Collects multiple Results — succeeds only if ALL succeed.
   * Collects ALL errors on failure (does not short-circuit).
   */
  and<T>(results: ReadonlyArray<Result<T>>): Result<T[]> {
    const errors: AppError[] = [];
    const values: T[] = [];
    for (const r of results) {
      if (r.ok) values.push(r.value);
      else errors.push(...r.errors);
    }
    return errors.length > 0 ? Result.failureFrom(errors) : Result.success(values);
  },

  /**
   * Returns first success from multiple Results.
   * Collects ALL errors if all fail.
   */
  or<T>(results: ReadonlyArray<Result<T>>): Result<T> {
    if (results.length === 0) {
      return Result.failure(
        Err.validation('Result.Or.Empty', 'Result.or requires at least one result'),
      );
    }
    const errors: AppError[] = [];
    for (const r of results) {
      if (r.ok) return r;
      errors.push(...r.errors);
    }
    return Result.failureFrom(errors);
  },

  /**
   * Throws a ResultUnwrapError if the result is a failure.
   * Use sparingly — prefer match/then for safe pipelines.
   */
  unwrap<T>(result: Result<T>): T {
    if (!result.ok) {
      throw new ResultUnwrapError(result.errors);
    }
    return result.value;
  },

  /**
   * Deconstructs a Result into a tuple.
   */
  deconstruct<T>(
    result: Result<T>,
  ): [ok: true, value: T, errors: null] | [ok: false, value: null, errors: readonly AppError[]] {
    return result.ok ? [true, result.value, null] : [false, null, result.errors];
  },

  /**
   * Atomically extracts value and errors from a Result.
   * Returns a tuple with success flag, optional value, and optional errors.
   *
   * @example
   * const [ok, value, errors] = Result.tryGet(result);
   * if (ok) console.log(value);
   * else console.error(errors[0].description);
   */
  tryGet<T>(
    result: Result<T>,
  ):
    | [ok: true, value: T, errors: undefined]
    | [ok: false, value: undefined, errors: readonly AppError[]] {
    return result.ok ? [true, result.value, undefined] : [false, undefined, result.errors];
  },

  /**
   * Void-only pattern match — runs side effects without returning a value.
   * Complement of `match` for cases where you only need side effects.
   *
   * @example
   * Result.switch(result,
   *   user => console.log(`Fetched ${user.name}`),
   *   errs => console.error(errs[0].description),
   * );
   */
  switch<T>(
    result: Result<T>,
    onSuccess: (value: T) => void,
    onError: (errors: readonly AppError[]) => void,
  ): void {
    if (result.ok) onSuccess(result.value);
    else onError(result.errors);
  },

  /**
   * Pattern match using only the first error.
   * Useful when you want to handle the primary failure reason.
   */
  matchFirst<T, U>(
    result: Result<T>,
    onSuccess: (value: T) => U,
    onFirstError: (error: AppError) => U,
  ): U {
    return result.ok
      ? onSuccess(result.value)
      : onFirstError(result.errors[0] ?? Err.unexpected('Result.Empty', 'No errors found.'));
  },

  /**
   * Pattern match using only the last error.
   * Useful when the last error represents the most specific failure.
   */
  matchLast<T, U>(
    result: Result<T>,
    onSuccess: (value: T) => U,
    onLastError: (error: AppError) => U,
  ): U {
    return result.ok
      ? onSuccess(result.value)
      : onLastError(
          result.errors[result.errors.length - 1] ??
            Err.unexpected('Result.Empty', 'No errors found.'),
        );
  },

  /**
   * Void-only switch using only the first error.
   */
  switchFirst<T>(
    result: Result<T>,
    onSuccess: (value: T) => void,
    onFirstError: (error: AppError) => void,
  ): void {
    if (result.ok) onSuccess(result.value);
    else onFirstError(result.errors[0] ?? Err.unexpected('Result.Empty', 'No errors found.'));
  },

  /**
   * Void-only switch using only the last error.
   */
  switchLast<T>(
    result: Result<T>,
    onSuccess: (value: T) => void,
    onLastError: (error: AppError) => void,
  ): void {
    if (result.ok) onSuccess(result.value);
    else
      onLastError(
        result.errors[result.errors.length - 1] ??
          Err.unexpected('Result.Empty', 'No errors found.'),
      );
  },

  /**
   * Runs a side effect on the first error only.
   * Complement of `tapError` which receives all errors.
   */
  tapErrorFirst<T>(result: Result<T>, fn: (firstError: AppError) => void): Result<T> {
    if (!result.ok && result.errors.length > 0) {
      const [firstError] = result.errors;
      if (firstError) fn(firstError);
    }
    return result;
  },

  /**
   * Guards the success value against null/undefined.
   * If the value is null or undefined, returns a failure with the provided error.
   */
  ensureNotNull<T>(result: Result<T | null | undefined>, error: AppError): Result<T> {
    if (!result.ok) return Result.failureFrom<T>(result.errors);
    if (result.value == null) return Result.failure(error);
    return Result.success(result.value);
  },

  /**
   * Fails the result if the predicate matches the success value.
   * Opposite of `ensure` — turns a success into a failure when the predicate is true.
   * An error factory is called only when the predicate matches (lazy).
   *
   * @example
   * Result.failWhen(result, n => n < 0, Err.validation('Value.Negative', 'Must be non-negative'));
   */
  failWhen<T>(
    result: Result<T>,
    predicate: (value: T) => boolean,
    error: AppError | ((value: T) => AppError),
  ): Result<T> {
    if (!result.ok) return result;
    return predicate(result.value) ? Result.failure(resolveError(error, result.value)) : result;
  },

  /**
   * Wraps a function call that may throw, catching exceptions as Result.failure.
   * Applied to an existing Result's success value.
   *
   * @example
   * Result.tryCatch(result, user => JSON.parse(user.config), Err.validation('JSON.Invalid', 'Bad config'));
   */
  tryCatch<T, U>(
    result: Result<T>,
    fn: (value: T) => U,
    error?: AppError | ((error: unknown) => AppError),
  ): Result<U> {
    if (!result.ok) return Result.failureFrom<U>(result.errors);
    try {
      return Result.success(fn(result.value));
    } catch (e) {
      const err = error
        ? typeof error === 'function'
          ? (error as (error: unknown) => AppError)(e)
          : error
        : Err.fromException(e);
      return Result.failure(err);
    }
  },

  /**
   * Creates a Result from a plain value (success).
   */
  fromValue<T>(value: T): Result<T> {
    return Result.success(value);
  },

  /**
   * Async version of tryCatch.
   */
  async tryCatchAsync<T, U>(
    result: Result<T>,
    fn: (value: T) => Promise<U>,
    error?: AppError | ((error: unknown) => AppError),
  ): Promise<Result<U>> {
    if (!result.ok) return Result.failureFrom<U>(result.errors);
    try {
      return Result.success(await fn(result.value));
    } catch (e) {
      const err = error
        ? typeof error === 'function'
          ? (error as (error: unknown) => AppError)(e)
          : error
        : Err.fromException(e);
      return Result.failure(err);
    }
  },

  /**
   * Creates a failed Result from an error.
   */
  fromError<T = never>(error: AppError): Result<T> {
    return Result.failure(error);
  },

  /**
   * Returns the success value, or a default if failed.
   * Safer alternative to unwrap() for cases where a fallback makes sense.
   */
  unwrapOr<T>(result: Result<T>, defaultValue: T): T {
    return result.ok ? result.value : defaultValue;
  },

  /**
   * Returns the success value, or computes a fallback from errors.
   */
  unwrapOrElse<T>(result: Result<T>, fn: (errors: readonly AppError[]) => T): T {
    return result.ok ? result.value : fn(result.errors);
  },

  /**
   * Flattens a nested Result<Result<T>> into Result<T>.
   * Useful when chaining operations that each return Result<Result<T>>.
   */
  flatten<T>(result: Result<Result<T>>): Result<T> {
    return result.ok ? result.value : Result.failureFrom<T>(result.errors);
  },

  // ─── ASYNC PIPELINE (continued) ──────────────────────────────────────────

  /**
   * Async version of Result.tap.
   */
  async tapAsync<T>(result: Result<T>, fn: (value: T) => Promise<void>): Promise<Result<T>> {
    if (result.ok) await fn(result.value);
    return result;
  },

  /**
   * Async version of Result.tapError.
   */
  async tapErrorAsync<T>(
    result: Result<T>,
    fn: (errors: readonly AppError[]) => Promise<void>,
  ): Promise<Result<T>> {
    if (!result.ok) await fn(result.errors);
    return result;
  },

  /**
   * Async version of Result.compensate.
   */
  async compensateAsync<T>(
    result: Result<T>,
    fn: (errors: readonly AppError[]) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    return result.ok ? result : fn(result.errors);
  },

  /**
   * Async version of Result.mapError.
   */
  async mapErrorAsync<T>(
    result: Result<T>,
    fn: (errors: readonly AppError[]) => Promise<AppError[]>,
  ): Promise<Result<T>> {
    if (result.ok) return result;
    return Result.failureFrom<T>(await fn(result.errors));
  },

  /**
   * Async version of Result.mapEachError — maps every error one at a time, in order.
   * With `{ signal }` the signal is checked before each mapper call (throws `signal.reason`);
   * a running mapper is not abandoned.
   */
  async mapEachErrorAsync<T>(
    result: Result<T>,
    fn: (error: AppError) => PromiseLike<AppError> | AppError,
    options?: AbortOptions,
  ): Promise<Result<T>> {
    if (result.ok) return result;
    const mapped: AppError[] = [];
    for (const e of result.errors) {
      throwIfAborted(options?.signal);
      mapped.push(await fn(e));
    }
    return Result.failureFrom<T>(mapped);
  },

  // ─── CONDITIONAL PIPELINE ─────────────────────────────────────────────────

  /**
   * Chains fn only if condition is true (or predicate returns true).
   * If condition is false, passes the result through unchanged.
   * Short-circuits on failure as usual.
   */
  bindIf<T>(
    result: Result<T>,
    condition: boolean | ((value: T) => boolean),
    fn: (value: T) => Result<T>,
  ): Result<T> {
    if (!result.ok) return result;
    const cond = typeof condition === 'function' ? condition(result.value) : condition;
    return cond ? fn(result.value) : result;
  },

  /**
   * Async version of bindIf.
   */
  async bindIfAsync<T>(
    result: Result<T>,
    condition: boolean | ((value: T) => boolean),
    fn: (value: T) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    if (!result.ok) return result;
    const cond = typeof condition === 'function' ? condition(result.value) : condition;
    return cond ? fn(result.value) : result;
  },

  /**
   * Runs a side effect only when condition is true (or predicate returns true).
   * Passes result through unchanged.
   */
  tapIf<T>(
    result: Result<T>,
    condition: boolean | ((value: T) => boolean),
    fn: (value: T) => void,
  ): Result<T> {
    if (result.ok) {
      const cond = typeof condition === 'function' ? condition(result.value) : condition;
      if (cond) fn(result.value);
    }
    return result;
  },

  /**
   * Runs a side effect on failure only when condition is true (or predicate returns true).
   * Passes result through unchanged.
   */
  tapErrorIf<T>(
    result: Result<T>,
    condition: boolean | ((errors: readonly AppError[]) => boolean),
    fn: (errors: readonly AppError[]) => void,
  ): Result<T> {
    if (!result.ok) {
      const cond = typeof condition === 'function' ? condition(result.errors) : condition;
      if (cond) fn(result.errors);
    }
    return result;
  },

  // ─── TARGETED RECOVERY ────────────────────────────────────────────────────

  /**
   * Recovers from failure using only the first error.
   * Passes through success unchanged.
   */
  compensateFirst<T>(result: Result<T>, fn: (firstError: AppError) => Result<T>): Result<T> {
    if (result.ok) return result;
    const firstError = result.errors[0] ?? Err.unexpected('Result.Empty', 'No errors found.');
    return fn(firstError);
  },

  /**
   * Async version of compensateFirst.
   */
  async compensateFirstAsync<T>(
    result: Result<T>,
    fn: (firstError: AppError) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    if (result.ok) return result;
    const firstError = result.errors[0] ?? Err.unexpected('Result.Empty', 'No errors found.');
    return fn(firstError);
  },

  /**
   * Targeted recovery. Scans ALL errors in order; the first error matching `match`
   * (an `ErrorType` or a predicate) is passed to `fn`. If none matches, the failure
   * passes through unchanged.
   *
   * Use {@link Result.recoverFirst} to look at the first error only.
   *
   * @example
   * Result.recover(r, ErrorType.NotFound, () => Result.success(defaultUser));
   * Result.recover(r, e => e.code === 'Cache.Miss', () => loadFromDb());
   */
  recover<T>(
    result: Result<T>,
    match: ErrorType | ((error: AppError) => boolean),
    fn: (error: AppError) => Result<T>,
  ): Result<T> {
    if (result.ok) return result;
    const found = findError(result.errors, match);
    return found ? fn(found) : result;
  },

  /**
   * Async version of recover (scans all errors).
   */
  async recoverAsync<T>(
    result: Result<T>,
    match: ErrorType | ((error: AppError) => boolean),
    fn: (error: AppError) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    if (result.ok) return result;
    const found = findError(result.errors, match);
    return found ? fn(found) : result;
  },

  /**
   * Recovers only if the FIRST error matches `match` (an `ErrorType` or a predicate).
   * Otherwise passes through unchanged.
   */
  recoverFirst<T>(
    result: Result<T>,
    match: ErrorType | ((error: AppError) => boolean),
    fn: (error: AppError) => Result<T>,
  ): Result<T> {
    if (result.ok) return result;
    const first = result.errors[0];
    return first && matches(first, match) ? fn(first) : result;
  },

  /**
   * Async version of recoverFirst.
   */
  async recoverFirstAsync<T>(
    result: Result<T>,
    match: ErrorType | ((error: AppError) => boolean),
    fn: (error: AppError) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    if (result.ok) return result;
    const first = result.errors[0];
    return first && matches(first, match) ? fn(first) : result;
  },

  // ─── TERMINAL / FINALIZATION ──────────────────────────────────────────────

  /**
   * Always runs fn with the full Result, regardless of success or failure.
   * Useful for cleanup and audit that must run unconditionally.
   * Returns whatever fn returns (not the Result itself).
   */
  always<T, U>(result: Result<T>, fn: (result: Result<T>) => U): U {
    return fn(result);
  },

  /**
   * Async version of always.
   */
  async alwaysAsync<T, U>(result: Result<T>, fn: (result: Result<T>) => Promise<U>): Promise<U> {
    return fn(result);
  },

  // ─── APPLICATIVE COMBINATOR ───────────────────────────────────────────────

  /**
   * Collects multiple heterogeneous Results into a tuple Result.
   * Succeeds only if ALL succeed; collects ALL errors if any fail.
   */
  combine<T extends readonly Result<unknown>[]>(
    ...results: T
  ): Result<{ [K in keyof T]: T[K] extends Result<infer V> ? V : never }> {
    const errors: AppError[] = [];
    const values: unknown[] = [];
    for (const r of results) {
      if (r.ok) values.push(r.value);
      else errors.push(...r.errors);
    }
    if (errors.length > 0) return Result.failureFrom(errors);
    return Result.success(values as { [K in keyof T]: T[K] extends Result<infer V> ? V : never });
  },

  /**
   * Applicative apply — applies a function inside a Result to a value inside a Result.
   * If both are success, returns success with the applied value.
   * If either is failure, collects all errors.
   *
   * @example
   * const fn = Result.success((n: number) => n * 2);
   * const val = Result.success(5);
   * Result.ap(fn, val); // Result.success(10)
   */
  ap<A, B>(fab: Result<(a: A) => B>, fa: Result<A>): Result<B> {
    if (fab.ok && fa.ok) return Result.success(fab.value(fa.value));
    const errors: AppError[] = [];
    if (!fab.ok) errors.push(...fab.errors);
    if (!fa.ok) errors.push(...fa.errors);
    return Result.failureFrom(errors);
  },

  // ─── PARTITION ─────────────────────────────────────────────────────────────

  /**
   * Returns the errors of the first failed Result, or success with all values when
   * none failed. Stops at the first failure (unlike `and`, which collects all errors).
   */
  firstFailureOrSuccesses<T>(results: Iterable<Result<T>>): Result<T[]> {
    const values: T[] = [];
    for (const r of results) {
      if (!r.ok) return Result.failureFrom<T[]>(r.errors);
      values.push(r.value);
    }
    return Result.success(values);
  },

  /**
   * Partitions an array of Results into successes and failures.
   * Unlike `and` or `or`, this does NOT short-circuit — it processes all items.
   *
   * @example
   * const { ok, err } = Result.partition([
   *   Result.success(1),
   *   Result.failure(Err.validation('X', 'bad')),
   *   Result.success(3),
   * ]);
   * // ok = [1, 3], err = [AppError]
   */
  partition<T>(results: ReadonlyArray<Result<T>>): {
    ok: Array<T>;
    err: Array<AppError>;
  } {
    const ok: Array<T> = [];
    const err: Array<AppError> = [];
    for (const r of results) {
      if (r.ok) ok.push(r.value);
      else err.push(...r.errors);
    }
    return { ok, err };
  },

  // ─── TRAVERSE ──────────────────────────────────────────────────────────────

  /**
   * Maps items through a Result-returning function, collecting ALL errors.
   * Unlike `and(items.map(fn))`, this avoids creating an intermediate array of Results.
   */
  traverse<A, B>(items: readonly A[], fn: (item: A) => Result<B>): Result<B[]> {
    const values: B[] = [];
    const errors: AppError[] = [];
    for (const item of items) {
      const r = fn(item);
      if (r.ok) values.push(r.value);
      else errors.push(...r.errors);
    }
    return errors.length > 0 ? Result.failureFrom<B[]>(errors) : Result.success(values);
  },

  /**
   * Async version of traverse; collects ALL errors, in item order.
   *
   * - Default: sequential — one item at a time.
   * - `concurrency`: at most N items in flight (integer ≥ 1, or `Infinity`); results
   *   are still assembled in item order.
   * - `signal`: checked before each item starts (throws `signal.reason`) and passed to `fn`.
   *   A running `fn` is not abandoned — pass the signal into it to stop early.
   * - If `fn` throws/rejects, no further items start, in-flight items settle, then the
   *   first exception is rethrown.
   */
  async traverseAsync<A, B>(
    items: readonly A[],
    fn: (item: A, signal?: AbortSignal) => PromiseLike<Result<B>>,
    options?: TraverseOptions,
  ): Promise<Result<B[]>> {
    const signal = options?.signal;
    const concurrency = options?.concurrency ?? 1;
    if (
      !(
        concurrency === Number.POSITIVE_INFINITY ||
        (Number.isInteger(concurrency) && concurrency >= 1)
      )
    ) {
      throw new RangeError(
        `concurrency must be a positive integer or Infinity, got ${concurrency}`,
      );
    }
    const results: Result<B>[] = new Array(items.length);
    let next = 0;
    let failed = false;
    let firstError: unknown;
    const worker = async (): Promise<void> => {
      while (!failed && next < items.length) {
        const index = next++;
        try {
          throwIfAborted(signal);
          results[index] = await fn(items[index] as A, signal);
        } catch (e) {
          if (!failed) {
            failed = true;
            firstError = e;
          }
        }
      }
    };
    const workers = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workers }, worker));
    if (failed) throw firstError;
    return Result.and(results);
  },

  // ─── ASYNC SEQUENCE ────────────────────────────────────────────────────────

  /**
   * Awaits pending Results in order and collects them into a single Result<T[]>.
   * Succeeds only if ALL succeed; collects ALL errors from failures.
   *
   * - Every promise is awaited (allSettled semantics). If any REJECTS, the remaining ones
   *   are still awaited and the first rejection (in input order) is rethrown afterwards.
   * - `signal`: when the caller's signal aborts, rejects with `signal.reason` at once;
   *   the remaining promises are observed so their rejections are never unhandled.
   *
   * @example
   * const users = await Result.sequenceAsync([fetchUser(1), fetchUser(2)], { signal });
   */
  async sequenceAsync<T>(
    promises: ReadonlyArray<PromiseLike<Result<T>>>,
    options?: AbortOptions,
  ): Promise<Result<T[]>> {
    return Result.and(await settleInOrder(promises, options?.signal));
  },

  /**
   * Same as {@link Result.sequenceAsync}.
   */
  async sequence<T>(
    promises: ReadonlyArray<PromiseLike<Result<T>>>,
    options?: AbortOptions,
  ): Promise<Result<T[]>> {
    return Result.sequenceAsync(promises, options);
  },
} as const;

/** Options for {@link Result.traverseAsync}. */
export interface TraverseOptions extends AbortOptions {
  /** Maximum items in flight. Integer ≥ 1 or `Infinity`. Default: 1 (sequential). */
  readonly concurrency?: number | undefined;
}

function resolveError<T>(error: AppError | ((value: T) => AppError), value: T): AppError {
  return typeof error === 'function' ? error(value) : error;
}

function matches(error: AppError, match: ErrorType | ((error: AppError) => boolean)): boolean {
  return typeof match === 'function' ? match(error) : error.type === match;
}

function findError(
  errors: readonly AppError[],
  match: ErrorType | ((error: AppError) => boolean),
): AppError | undefined {
  for (const e of errors) if (matches(e, match)) return e;
  return undefined;
}

/**
 * Awaits pending Results one by one, in input order.
 * A rejection is remembered and the loop continues; the first rejection is rethrown
 * after every promise settled. The caller's abort rejects immediately; the remaining
 * promises are observed. All inputs are observed up front so a later rejection never
 * surfaces as unhandled while an earlier item is still pending.
 *
 * @internal Shared by Result and ResultAsync collection helpers.
 */
export async function settleInOrder<T>(
  promises: ReadonlyArray<PromiseLike<Result<T>>>,
  signal: AbortSignal | undefined,
): Promise<Result<T>[]> {
  for (const p of promises) observe(p);
  const results: Result<T>[] = [];
  let faulted = false;
  let fault: unknown;
  for (const p of promises) {
    throwIfAborted(signal);
    try {
      results.push(await withAbort(p, signal));
    } catch (e) {
      if (isCallerAbort(e, signal)) throw e;
      if (!faulted) {
        faulted = true;
        fault = e;
      }
    }
  }
  if (faulted) throw fault;
  return results;
}

/**
 * Error thrown when calling Result.unwrap() on a failed Result.
 */
export class ResultUnwrapError extends Error {
  constructor(public readonly errors: readonly AppError[]) {
    super(`Cannot unwrap a failed Result. Errors: ${errors.map((e) => e.code).join(', ')}`);
    this.name = 'ResultUnwrapError';
  }
}
