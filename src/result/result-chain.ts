import type { AppError } from '../errors/app-error.js';
import type { ErrorType } from '../errors/error-type.js';
import { Result } from './result.js';
import { ResultAsync } from './result-async.js';

/**
 * Fluent chainable wrapper around Result<T>.
 *
 * Provides a fluent method-chaining API for Result<T>,
 * while internally using the pure-function Result utilities.
 * Async methods (`*Async`) return a {@link ResultAsync}, so the pipeline stays fluent
 * and is awaited once at the end (`await` yields a plain `Result<T>`).
 *
 * @example
 * const profile = await chain(Result.success(userId))
 *   .bind(id => findUser(id))
 *   .ensure(user => user.isActive, Err.validation('User.Inactive', 'User is not active'))
 *   .map(user => user.profile)
 *   .match(
 *     profile => profile,
 *     errors => null,
 *   );
 */
export class ResultChain<T> {
  private constructor(private readonly _result: Result<T>) {}

  static of<T>(result: Result<T>): ResultChain<T> {
    return new ResultChain(result);
  }

  /** Unwraps the underlying Result<T>. */
  unwrap(): Result<T> {
    return this._result;
  }

  bind<U>(fn: (value: T) => Result<U>): ResultChain<U> {
    return new ResultChain(Result.then(this._result, fn));
  }

  map<U>(fn: (value: T) => U): ResultChain<U> {
    return new ResultChain(Result.map(this._result, fn));
  }

  ensure(
    predicate: (value: T) => boolean,
    error: AppError | ((value: T) => AppError),
  ): ResultChain<T> {
    return new ResultChain(Result.ensure(this._result, predicate, error));
  }

  tap(fn: (value: T) => void): ResultChain<T> {
    return new ResultChain(Result.tap(this._result, fn));
  }

  tapError(fn: (errors: readonly AppError[]) => void): ResultChain<T> {
    return new ResultChain(Result.tapError(this._result, fn));
  }

  mapError(fn: (errors: readonly AppError[]) => AppError[]): ResultChain<T> {
    return new ResultChain(Result.mapError(this._result, fn));
  }

  /** Maps every error, in order. See {@link Result.mapEachError}. */
  mapEachError(fn: (error: AppError) => AppError): ResultChain<T> {
    return new ResultChain(Result.mapEachError(this._result, fn));
  }

  else(fallback: T | ((errors: readonly AppError[]) => T)): ResultChain<T> {
    return new ResultChain(Result.else(this._result, fallback));
  }

  /**
   * Returns the success value, or computes one from the errors.
   *
   * @deprecated Returns `T`, not a ResultChain, use {@link ResultChain.unwrapOrElse}.
   */
  elseWith(factory: (errors: readonly AppError[]) => T): T {
    return this.unwrapOrElse(factory);
  }

  compensate(fn: (errors: readonly AppError[]) => Result<T>): ResultChain<T> {
    return new ResultChain(Result.compensate(this._result, fn));
  }

  bindIf(
    condition: boolean | ((value: T) => boolean),
    fn: (value: T) => Result<T>,
  ): ResultChain<T> {
    return new ResultChain(Result.bindIf(this._result, condition, fn));
  }

  tapIf(condition: boolean | ((value: T) => boolean), fn: (value: T) => void): ResultChain<T> {
    return new ResultChain(Result.tapIf(this._result, condition, fn));
  }

  tapErrorIf(
    condition: boolean | ((errors: readonly AppError[]) => boolean),
    fn: (errors: readonly AppError[]) => void,
  ): ResultChain<T> {
    return new ResultChain(Result.tapErrorIf(this._result, condition, fn));
  }

  compensateFirst(fn: (firstError: AppError) => Result<T>): ResultChain<T> {
    return new ResultChain(Result.compensateFirst(this._result, fn));
  }

  /** Scans all errors for a match. See {@link Result.recover}. */
  recover(
    match: ErrorType | ((error: AppError) => boolean),
    fn: (error: AppError) => Result<T>,
  ): ResultChain<T> {
    return new ResultChain(Result.recover(this._result, match, fn));
  }

  /** Recovers only if the first error matches. See {@link Result.recoverFirst}. */
  recoverFirst(
    match: ErrorType | ((error: AppError) => boolean),
    fn: (error: AppError) => Result<T>,
  ): ResultChain<T> {
    return new ResultChain(Result.recoverFirst(this._result, match, fn));
  }

  always<U>(fn: (result: Result<T>) => U): U {
    return Result.always(this._result, fn);
  }

  async alwaysAsync<U>(fn: (result: Result<T>) => Promise<U>): Promise<U> {
    return Result.alwaysAsync(this._result, fn);
  }

  bindIfAsync(
    condition: boolean | ((value: T) => boolean),
    fn: (value: T) => Promise<Result<T>>,
  ): ResultAsync<T> {
    return ResultAsync.from(Result.bindIfAsync(this._result, condition, fn));
  }

  compensateFirstAsync(fn: (firstError: AppError) => Promise<Result<T>>): ResultAsync<T> {
    return ResultAsync.from(Result.compensateFirstAsync(this._result, fn));
  }

  recoverAsync(
    match: ErrorType | ((error: AppError) => boolean),
    fn: (error: AppError) => Promise<Result<T>>,
  ): ResultAsync<T> {
    return ResultAsync.from(Result.recoverAsync(this._result, match, fn));
  }

  recoverFirstAsync(
    match: ErrorType | ((error: AppError) => boolean),
    fn: (error: AppError) => Promise<Result<T>>,
  ): ResultAsync<T> {
    return ResultAsync.from(Result.recoverFirstAsync(this._result, match, fn));
  }

  match<U>(onSuccess: (value: T) => U, onError: (errors: readonly AppError[]) => U): U {
    return Result.match(this._result, onSuccess, onError);
  }

  // ── Async (return ResultAsync for a fluent, single-await pipeline) ─────────

  /** Lifts this chain into a {@link ResultAsync} pipeline. */
  toAsync(): ResultAsync<T> {
    return ResultAsync.fromResult(this._result);
  }

  thenAsync<U>(fn: (value: T) => Promise<Result<U>>): ResultAsync<U> {
    return ResultAsync.from(Result.thenAsync(this._result, fn));
  }

  mapAsync<U>(fn: (value: T) => Promise<U>): ResultAsync<U> {
    return ResultAsync.from(Result.mapAsync(this._result, fn));
  }

  ensureAsync(
    predicate: (value: T) => Promise<boolean>,
    error: AppError | ((value: T) => AppError),
  ): ResultAsync<T> {
    return ResultAsync.from(Result.ensureAsync(this._result, predicate, error));
  }

  tapAsync(fn: (value: T) => Promise<void>): ResultAsync<T> {
    return ResultAsync.from(Result.tapAsync(this._result, fn));
  }

  tapErrorAsync(fn: (errors: readonly AppError[]) => Promise<void>): ResultAsync<T> {
    return ResultAsync.from(Result.tapErrorAsync(this._result, fn));
  }

  compensateAsync(fn: (errors: readonly AppError[]) => Promise<Result<T>>): ResultAsync<T> {
    return ResultAsync.from(Result.compensateAsync(this._result, fn));
  }

  mapErrorAsync(fn: (errors: readonly AppError[]) => Promise<AppError[]>): ResultAsync<T> {
    return ResultAsync.from(Result.mapErrorAsync(this._result, fn));
  }

  /** Maps every error with an async mapper, sequentially and in order. */
  mapEachErrorAsync(fn: (error: AppError) => Promise<AppError>): ResultAsync<T> {
    return ResultAsync.from(Result.mapEachErrorAsync(this._result, fn));
  }

  elseAsync(fallback: T | ((errors: readonly AppError[]) => Promise<T>)): ResultAsync<T> {
    return ResultAsync.fromResult(this._result).else(fallback);
  }

  async matchAsync<U>(
    onSuccess: (value: T) => Promise<U>,
    onError: (errors: readonly AppError[]) => Promise<U>,
  ): Promise<U> {
    return this._result.ok ? onSuccess(this._result.value) : onError(this._result.errors);
  }

  unwrapOr(defaultValue: T): T {
    return Result.unwrapOr(this._result, defaultValue);
  }

  unwrapOrElse(fn: (errors: readonly AppError[]) => T): T {
    return Result.unwrapOrElse(this._result, fn);
  }

  /** Wraps a Promise<Result<T>> into a ResultChain<T>. */
  static async fromPromise<T>(promise: Promise<Result<T>>): Promise<ResultChain<T>> {
    return new ResultChain(await promise);
  }
}

/**
 * Entry point for the fluent Result chain API.
 *
 * @example
 * const result = chain(Result.success(42))
 *   .map(n => n * 2)
 *   .ensure(n => n < 100, Err.validation('Num.TooLarge', 'Must be < 100'))
 *   .unwrap();
 */
export const chain = <T>(result: Result<T>): ResultChain<T> => ResultChain.of(result);
