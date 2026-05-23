import type { AppError } from '../errors/app-error.js';
import { Err } from '../errors/app-error.js';

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
   */
  ensure<T>(
    result: Result<T>,
    predicate: (value: T) => boolean,
    error: AppError | ((value: T) => AppError),
  ): Result<T> {
    if (!result.ok) return result;
    const err = typeof error === 'function' ? error(result.value) : error;
    return predicate(result.value) ? result : Result.failure(err);
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
   * Returns a fallback value on failure using an explicit factory function.
   * Use instead of `else` when `T` is a function type, to avoid ambiguity.
   */
  elseWith<T>(result: Result<T>, factory: (errors: readonly AppError[]) => T): T {
    if (result.ok) return result.value;
    return factory(result.errors);
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
   */
  async tryAsync<T>(
    fn: () => Promise<T>,
    onError?: (error: unknown) => AppError,
  ): Promise<Result<T>> {
    try {
      return Result.success(await fn());
    } catch (e) {
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
   * Async version of Result.ensure.
   */
  async ensureAsync<T>(
    result: Result<T>,
    predicate: (value: T) => Promise<boolean>,
    error: AppError | ((value: T) => AppError),
  ): Promise<Result<T>> {
    if (!result.ok) return result;
    const err = typeof error === 'function' ? error(result.value) : error;
    return (await predicate(result.value)) ? result : Result.failure(err);
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
      fn(result.errors[0] ?? Err.unexpected('Result.Empty', 'No errors found.'));
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
   *
   * @example
   * Result.failIf(result, n => n < 0, Err.validation('Value.Negative', 'Must be non-negative'));
   */
  failWhen<T>(
    result: Result<T>,
    predicate: (value: T) => boolean,
    error: AppError | ((value: T) => AppError),
  ): Result<T> {
    if (!result.ok) return result;
    const err = typeof error === 'function' ? error(result.value) : error;
    return predicate(result.value) ? Result.failure(err) : result;
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
   * Equivalent to C# implicit operator `Result<T>(TValue)`.
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
   * Equivalent to C# implicit operator `Result<T>(Error)`.
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
   * Predicate-based single-error recovery.
   * If result is failure AND predicate matches the first error, calls fn for recovery.
   * Otherwise passes through unchanged.
   */
  recover<T>(
    result: Result<T>,
    predicate: (error: AppError) => boolean,
    fn: (error: AppError) => Result<T>,
  ): Result<T> {
    if (result.ok) return result;
    const firstError = result.errors[0];
    if (!firstError || !predicate(firstError)) return result;
    return fn(firstError);
  },

  /**
   * Async version of recover.
   */
  async recoverAsync<T>(
    result: Result<T>,
    predicate: (error: AppError) => boolean,
    fn: (error: AppError) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    if (result.ok) return result;
    const firstError = result.errors[0];
    if (!firstError || !predicate(firstError)) return result;
    return fn(firstError);
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

  // ─── ASYNC SEQUENCE ────────────────────────────────────────────────────────

  /**
   * Awaits an array of Promise<Result<T>> and collects them into a single Result<T[]>.
   * Succeeds only if ALL succeed; collects ALL errors from failures.
   *
   * @example
   * const results = await Result.sequence([
   *   fetchUser(1),
   *   fetchUser(2),
   * ]);
   */
  async sequence<T>(promises: ReadonlyArray<Promise<Result<T>>>): Promise<Result<T[]>> {
    const results = await Promise.all(promises);
    return Result.and(results);
  },
} as const;

/**
 * Error thrown when calling Result.unwrap() on a failed Result.
 */
export class ResultUnwrapError extends Error {
  constructor(public readonly errors: readonly AppError[]) {
    super(`Cannot unwrap a failed Result. Errors: ${errors.map((e) => e.code).join(', ')}`);
    this.name = 'ResultUnwrapError';
  }
}
