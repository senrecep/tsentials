import type { AppError } from '../errors/app-error.js';
import { Err } from '../errors/app-error.js';

/**
 * Result<T> represents either a successful value or one or more errors.
 * Uses a discriminated union for zero-cost type narrowing at compile time.
 *
 * TypeScript adaptation of CSharpEssentials.Results.Result<TValue>
 * (readonly partial record struct).
 *
 * Key design decisions vs C#:
 * - Discriminated union `{ ok: true; value: T } | { ok: false; errors: ... }`
 *   replaces null-check on internal `_errors` field
 * - `Result` namespace merging: same identifier works as both type and factory
 * - Sync + async pipeline in one file instead of 40+ partial class files
 * - No implicit conversions — explicit `Result.success()` / `Result.failure()`
 */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly AppError[] };

/**
 * Non-generic Result for operations with no meaningful return value.
 * Equivalent to C#'s non-generic `Result` struct.
 */
export type VoidResult = Result<void>;

const _success = Object.freeze({ ok: true as const, value: undefined as void });

export const Result = {
  // ─── FACTORIES ────────────────────────────────────────────────────────────

  /**
   * Creates a successful Result wrapping a value.
   * Replaces C#'s `Result.Success<T>(value)` and implicit `TValue → Result<TValue>`.
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
   * Replaces C#'s `Result.Failure(Error)` and implicit `Error → Result<T>`.
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
    if (result.ok) return Err.unexpected('Result.NoFirstError', 'First error cannot be retrieved from a successful Result.');
    return result.errors[0] ?? Err.unexpected('Result.Empty', 'No errors found.');
  },

  lastError<T>(result: Result<T>): AppError {
    if (result.ok) return Err.unexpected('Result.NoLastError', 'Last error cannot be retrieved from a successful Result.');
    return result.errors[result.errors.length - 1] ?? Err.unexpected('Result.Empty', 'No errors found.');
  },

  // ─── CONDITIONAL CREATION ─────────────────────────────────────────────────

  /**
   * Returns success if condition is true, failure otherwise.
   * Replaces C#'s `Result.SuccessIf(bool, value, error)`.
   */
  successIf<T>(condition: boolean, value: T, error: AppError): Result<T> {
    return condition ? Result.success(value) : Result.failure(error);
  },

  /**
   * Returns failure if condition is true, success otherwise.
   * Replaces C#'s `Result.FailIf(bool, value, error)`.
   */
  failIf<T>(condition: boolean, value: T, error: AppError): Result<T> {
    return condition ? Result.failure(error) : Result.success(value);
  },

  // ─── RAILWAY PIPELINE ─────────────────────────────────────────────────────

  /**
   * Chains a function that returns a new Result (monadic bind).
   * Replaces C#'s `ResultT.Then.cs` `Then<TNextValue>`.
   * Short-circuits on failure — the function is not called.
   */
  then<T, U>(result: Result<T>, fn: (value: T) => Result<U>): Result<U> {
    return result.ok ? fn(result.value) : Result.failureFrom<U>(result.errors);
  },

  /**
   * Transforms the success value (functor map).
   * Replaces C#'s `ResultT.Map.cs` `Map<TNextValue>`.
   */
  map<T, U>(result: Result<T>, fn: (value: T) => U): Result<U> {
    return result.ok ? Result.success(fn(result.value)) : Result.failureFrom<U>(result.errors);
  },

  /**
   * Guards the success value with a predicate.
   * Replaces C#'s `ResultT.Ensure.cs` `Ensure(predicate, error)`.
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
   * Replaces C#'s `ResultT.Tap.cs` `Tap(action)`.
   */
  tap<T>(result: Result<T>, fn: (value: T) => void): Result<T> {
    if (result.ok) fn(result.value);
    return result;
  },

  /**
   * Runs a side effect on failure without altering the result.
   * Replaces C#'s `ResultT.TapError.cs` `TapError(action)`.
   */
  tapError<T>(result: Result<T>, fn: (errors: readonly AppError[]) => void): Result<T> {
    if (!result.ok) fn(result.errors);
    return result;
  },

  /**
   * Transforms errors on failure (error functor map).
   * Replaces C#'s `ResultT.MapError.cs` `MapError<TNextValue>`.
   */
  mapError<T>(result: Result<T>, fn: (errors: readonly AppError[]) => AppError[]): Result<T> {
    if (result.ok) return result;
    return Result.failureFrom<T>(fn(result.errors));
  },

  /**
   * Exhaustive pattern match — extracts a value from either branch.
   * Replaces C#'s `ResultT.Match.cs` `Match<TNextValue>(onSuccess, onError)`.
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
   * Replaces C#'s `ResultT.Else.cs` `Else(value)` and `Else(onError)`.
   */
  else<T>(
    result: Result<T>,
    fallback: T | ((errors: readonly AppError[]) => T),
  ): Result<T> {
    if (result.ok) return result;
    const value = typeof fallback === 'function'
      ? (fallback as (errors: readonly AppError[]) => T)(result.errors)
      : fallback;
    return Result.success(value);
  },

  /**
   * Recovers from failure by returning a new Result.
   * Replaces C#'s `ResultT.Compensate.cs` `Compensate(onError)`.
   */
  compensate<T>(
    result: Result<T>,
    fn: (errors: readonly AppError[]) => Result<T>,
  ): Result<T> {
    return result.ok ? result : fn(result.errors);
  },

  /**
   * Wraps a throwing function, catching exceptions as Result.failure.
   * Replaces C#'s `Result.Try.cs` `Result.Try(Func<T>)`.
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
   * Replaces C#'s `Result.TryCatch.cs` `Result.TryAsync`.
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
   * Replaces C#'s Task<Result<T>> extension methods in ResultT.Then.cs.
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
  async mapAsync<T, U>(
    result: Result<T>,
    fn: (value: T) => Promise<U>,
  ): Promise<Result<U>> {
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
   * Replaces C#'s `Result.And(IEnumerable<Result>)`.
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
   * Replaces C#'s `Result.Or(IEnumerable<Result>)`.
   */
  or<T>(results: ReadonlyArray<Result<T>>): Result<T> {
    const errors: AppError[] = [];
    for (const r of results) {
      if (r.ok) return r;
      errors.push(...r.errors);
    }
    return Result.failureFrom(errors);
  },

  /**
   * Throws a ResultUnwrapError if the result is a failure.
   * Replaces C#'s `ResultT.Unwrap.cs` `Unwrap()`.
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
   * Replaces C#'s `ResultT.Deconstruct.cs`.
   */
  deconstruct<T>(
    result: Result<T>,
  ): [ok: true, value: T, errors: null] | [ok: false, value: null, errors: readonly AppError[]] {
    return result.ok
      ? [true, result.value, null]
      : [false, null, result.errors];
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
   * Replaces C#'s TapAsync extension on Task<Result<T>>.
   */
  async tapAsync<T>(result: Result<T>, fn: (value: T) => Promise<void>): Promise<Result<T>> {
    if (result.ok) await fn(result.value);
    return result;
  },

  /**
   * Async version of Result.tapError.
   * Replaces C#'s TapErrorAsync extension on Task<Result<T>>.
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
   * Replaces C#'s CompensateAsync extension on Task<Result<T>>.
   */
  async compensateAsync<T>(
    result: Result<T>,
    fn: (errors: readonly AppError[]) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    return result.ok ? result : fn(result.errors);
  },

  /**
   * Async version of Result.mapError.
   * Note: C# has no async MapError — this is an ergonomic TS addition.
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
  compensateFirst<T>(
    result: Result<T>,
    fn: (firstError: AppError) => Result<T>,
  ): Result<T> {
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
   * Replaces C#'s applicative-style `Combine` helpers.
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
} as const;

/**
 * Error thrown when calling Result.unwrap() on a failed Result.
 * Adapted from CSharpEssentials.Results.ResultUnwrapException.
 */
export class ResultUnwrapError extends Error {
  constructor(public readonly errors: readonly AppError[]) {
    super(`Cannot unwrap a failed Result. Errors: ${errors.map(e => e.code).join(', ')}`);
    this.name = 'ResultUnwrapError';
  }
}
