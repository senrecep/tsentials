import type { AppError } from '../errors/app-error.js';
import { Result } from './result.js';

/**
 * Fluent chainable wrapper around Result<T>.
 *
 * Provides a fluent method-chaining API for Result<T>,
 * while internally using the pure-function Result utilities.
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

  else(fallback: T | ((errors: readonly AppError[]) => T)): ResultChain<T> {
    return new ResultChain(Result.else(this._result, fallback));
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

  recover(
    predicate: (error: AppError) => boolean,
    fn: (error: AppError) => Result<T>,
  ): ResultChain<T> {
    return new ResultChain(Result.recover(this._result, predicate, fn));
  }

  always<U>(fn: (result: Result<T>) => U): U {
    return Result.always(this._result, fn);
  }

  async alwaysAsync<U>(fn: (result: Result<T>) => Promise<U>): Promise<U> {
    return Result.alwaysAsync(this._result, fn);
  }

  async bindIfAsync(
    condition: boolean | ((value: T) => boolean),
    fn: (value: T) => Promise<Result<T>>,
  ): Promise<ResultChain<T>> {
    return new ResultChain(await Result.bindIfAsync(this._result, condition, fn));
  }

  async compensateFirstAsync(
    fn: (firstError: AppError) => Promise<Result<T>>,
  ): Promise<ResultChain<T>> {
    return new ResultChain(await Result.compensateFirstAsync(this._result, fn));
  }

  async recoverAsync(
    predicate: (error: AppError) => boolean,
    fn: (error: AppError) => Promise<Result<T>>,
  ): Promise<ResultChain<T>> {
    return new ResultChain(await Result.recoverAsync(this._result, predicate, fn));
  }

  match<U>(onSuccess: (value: T) => U, onError: (errors: readonly AppError[]) => U): U {
    return Result.match(this._result, onSuccess, onError);
  }

  // ── Async ─────────────────────────────────────────────────────────────────

  async thenAsync<U>(fn: (value: T) => Promise<Result<U>>): Promise<ResultChain<U>> {
    return new ResultChain(await Result.thenAsync(this._result, fn));
  }

  async mapAsync<U>(fn: (value: T) => Promise<U>): Promise<ResultChain<U>> {
    return new ResultChain(await Result.mapAsync(this._result, fn));
  }

  async ensureAsync(
    predicate: (value: T) => Promise<boolean>,
    error: AppError | ((value: T) => AppError),
  ): Promise<ResultChain<T>> {
    return new ResultChain(await Result.ensureAsync(this._result, predicate, error));
  }

  async tapAsync(fn: (value: T) => Promise<void>): Promise<ResultChain<T>> {
    return new ResultChain(await Result.tapAsync(this._result, fn));
  }

  async tapErrorAsync(fn: (errors: readonly AppError[]) => Promise<void>): Promise<ResultChain<T>> {
    return new ResultChain(await Result.tapErrorAsync(this._result, fn));
  }

  async compensateAsync(
    fn: (errors: readonly AppError[]) => Promise<Result<T>>,
  ): Promise<ResultChain<T>> {
    return new ResultChain(await Result.compensateAsync(this._result, fn));
  }

  async mapErrorAsync(
    fn: (errors: readonly AppError[]) => Promise<AppError[]>,
  ): Promise<ResultChain<T>> {
    return new ResultChain(await Result.mapErrorAsync(this._result, fn));
  }

  async elseAsync(
    fallback: T | ((errors: readonly AppError[]) => Promise<T>),
  ): Promise<ResultChain<T>> {
    if (this._result.ok) return new ResultChain(this._result);
    const value =
      typeof fallback === 'function'
        ? await (fallback as (errors: readonly AppError[]) => Promise<T>)(this._result.errors)
        : fallback;
    return new ResultChain(Result.success(value));
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
