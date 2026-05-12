import type { AppError } from '../errors/app-error.js';
import { Result } from './result.js';

/**
 * ResultAsync<T> wraps a Promise<Result<T>> and provides a fully pipeable async API.
 *
 * Unlike ResultChain whose async methods return Promise<ResultChain<U>> and require
 * await at each step, ResultAsync lets you build the entire pipeline without
 * intermediate awaits — all operations return ResultAsync<U> synchronously, and
 * the whole chain resolves once at the end.
 *
 * Implements PromiseLike<Result<T>> so it can be awaited directly to get Result<T>.
 *
 * @example
 * const profile = await fromAsync(fetchUser(id))
 *   .andThen(user => validateUser(user))
 *   .ensure(user => user.isActive, Err.validation('User.Inactive', 'Not active'))
 *   .map(user => user.profile)
 *   .match(
 *     profile => profile,
 *     () => null,
 *   );
 */
export class ResultAsync<T> implements PromiseLike<Result<T>> {
  private constructor(private readonly _promise: Promise<Result<T>>) {}

  // ─── PromiseLike ──────────────────────────────────────────────────────────

  /**
   * Implements PromiseLike so ResultAsync can be directly awaited.
   * `const result: Result<T> = await someResultAsync`
   */
  // biome-ignore lint/suspicious/noThenProperty: implements PromiseLike<Result<T>> so ResultAsync can be awaited
  then<TResult1 = Result<T>, TResult2 = never>(
    onfulfilled?: ((value: Result<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this._promise.then(onfulfilled, onrejected);
  }

  // ─── FACTORIES ────────────────────────────────────────────────────────────

  /**
   * Wraps a Promise<Result<T>> into a ResultAsync pipeline.
   * Primary entry point when you have an existing async operation.
   *
   * @example
   * ResultAsync.from(fetchUser(id)).map(u => u.name)
   */
  static from<T>(promise: Promise<Result<T>>): ResultAsync<T> {
    return new ResultAsync(promise);
  }

  /**
   * Creates a resolved successful ResultAsync wrapping a value.
   */
  static success<T>(value: T): ResultAsync<T> {
    return new ResultAsync(Promise.resolve(Result.success(value)));
  }

  /**
   * Creates a resolved successful void ResultAsync.
   */
  static ok(): ResultAsync<void> {
    return new ResultAsync(Promise.resolve(Result.ok()));
  }

  /**
   * Creates a resolved failed ResultAsync.
   */
  static failure<T = never>(...errors: AppError[]): ResultAsync<T> {
    return new ResultAsync(Promise.resolve(Result.failure<T>(...errors)));
  }

  /**
   * Lifts a sync Result<T> into a ResultAsync<T> for pipeline entry.
   */
  static fromResult<T>(result: Result<T>): ResultAsync<T> {
    return new ResultAsync(Promise.resolve(result));
  }

  /**
   * Wraps an async throwing function — exceptions become Result.failure.
   *
   * @example
   * const r = await ResultAsync.try(() => fetch('/api/users').then(r => r.json()))
   */
  static try<T>(fn: () => Promise<T>, onError?: (e: unknown) => AppError): ResultAsync<T> {
    return new ResultAsync(Result.tryAsync(fn, onError));
  }

  /**
   * Creates a reusable wrapper for throwing async functions.
   * Returns a factory that always yields a ResultAsync — no try/catch at call sites.
   *
   * @example
   * const safeGetUser = ResultAsync.fromThrowable(
   *   (id: string) => fetchUser(id),
   *   e => Err.unexpected('User.FetchFailed', String(e)),
   * );
   * const user = await safeGetUser(userId).map(u => u.profile);
   */
  static fromThrowable<A extends readonly unknown[], T>(
    fn: (...args: A) => Promise<T>,
    onError?: (e: unknown) => AppError,
  ): (...args: A) => ResultAsync<T> {
    return (...args: A) =>
      new ResultAsync(Result.tryAsync(() => fn(...args), onError));
  }

  // ─── PIPELINE ─────────────────────────────────────────────────────────────

  /**
   * Monadic bind — chains a function returning Result<U>, ResultAsync<U>, or
   * Promise<Result<U>>. Short-circuits on failure.
   *
   * Named `andThen` (not `then`) to avoid collision with PromiseLike.then.
   *
   * @example
   * fromAsync(getOrder(id))
   *   .andThen(order => validateOrder(order))   // Result<Order> or ResultAsync<Order>
   *   .andThen(order => fulfillOrder(order))
   */
  andThen<U>(
    fn: (value: T) => Result<U> | ResultAsync<U> | Promise<Result<U>>,
  ): ResultAsync<U> {
    return new ResultAsync(
      this._promise.then(r => {
        if (!r.ok) return Promise.resolve(Result.failureFrom<U>(r.errors));
        const next = fn(r.value);
        if (next instanceof ResultAsync) return (next as ResultAsync<U>)._promise;
        if (next instanceof Promise) return next;
        return Promise.resolve(next);
      }),
    );
  }

  /**
   * Transforms the success value (sync or async).
   */
  map<U>(fn: (value: T) => U | Promise<U>): ResultAsync<U> {
    return new ResultAsync(
      this._promise.then(async r =>
        r.ok ? Result.success(await fn(r.value)) : Result.failureFrom<U>(r.errors),
      ),
    );
  }

  /**
   * Guards the success value with a sync or async predicate.
   */
  ensure(
    predicate: (value: T) => boolean | Promise<boolean>,
    error: AppError | ((value: T) => AppError),
  ): ResultAsync<T> {
    return new ResultAsync(
      this._promise.then(async r => {
        if (!r.ok) return r;
        const err = typeof error === 'function' ? error(r.value) : error;
        return (await predicate(r.value)) ? r : Result.failure(err);
      }),
    );
  }

  /**
   * Runs a sync or async side effect on success without altering the result.
   */
  tap(fn: (value: T) => void | Promise<void>): ResultAsync<T> {
    return new ResultAsync(
      this._promise.then(async r => {
        if (r.ok) await fn(r.value);
        return r;
      }),
    );
  }

  /**
   * Runs a sync or async side effect on failure without altering the result.
   */
  tapError(fn: (errors: readonly AppError[]) => void | Promise<void>): ResultAsync<T> {
    return new ResultAsync(
      this._promise.then(async r => {
        if (!r.ok) await fn(r.errors);
        return r;
      }),
    );
  }

  /**
   * Transforms errors on failure (sync or async).
   */
  mapError(fn: (errors: readonly AppError[]) => AppError[] | Promise<AppError[]>): ResultAsync<T> {
    return new ResultAsync(
      this._promise.then(async r => {
        if (r.ok) return r;
        return Result.failureFrom<T>(await fn(r.errors));
      }),
    );
  }

  /**
   * Recovers from failure by returning a new Result or ResultAsync.
   */
  compensate(
    fn: (errors: readonly AppError[]) => Result<T> | ResultAsync<T> | Promise<Result<T>>,
  ): ResultAsync<T> {
    return new ResultAsync(
      this._promise.then(r => {
        if (r.ok) return Promise.resolve(r);
        const next = fn(r.errors);
        if (next instanceof ResultAsync) return (next as ResultAsync<T>)._promise;
        if (next instanceof Promise) return next;
        return Promise.resolve(next);
      }),
    );
  }

  /**
   * Returns a fallback value on failure.
   */
  else(fallback: T | ((errors: readonly AppError[]) => T | Promise<T>)): ResultAsync<T> {
    return new ResultAsync(
      this._promise.then(async r => {
        if (r.ok) return r;
        const value =
          typeof fallback === 'function'
            ? await (fallback as (errors: readonly AppError[]) => T | Promise<T>)(r.errors)
            : fallback;
        return Result.success(value);
      }),
    );
  }

  bindIf(
    condition: boolean | ((value: T) => boolean),
    fn: (value: T) => Result<T> | ResultAsync<T> | Promise<Result<T>>,
  ): ResultAsync<T> {
    return new ResultAsync(
      this._promise.then(async r => {
        if (!r.ok) return r;
        const cond = typeof condition === 'function' ? condition(r.value) : condition;
        if (!cond) return r;
        const next = fn(r.value);
        if (next instanceof ResultAsync) return (next as ResultAsync<T>)._promise;
        if (next instanceof Promise) return next;
        return Promise.resolve(next);
      }),
    );
  }

  tapIf(condition: boolean | ((value: T) => boolean), fn: (value: T) => void | Promise<void>): ResultAsync<T> {
    return new ResultAsync(
      this._promise.then(async r => {
        if (!r.ok) return r;
        const cond = typeof condition === 'function' ? condition(r.value) : condition;
        if (cond) await fn(r.value);
        return r;
      }),
    );
  }

  compensateFirst(
    fn: (firstError: AppError) => Result<T> | ResultAsync<T> | Promise<Result<T>>,
  ): ResultAsync<T> {
    return new ResultAsync(
      this._promise.then(r => {
        if (r.ok) return Promise.resolve(r);
        // biome-ignore lint/style/noNonNullAssertion: errors array is non-empty when ok is false
        const next = fn(r.errors[0]!);
        if (next instanceof ResultAsync) return (next as ResultAsync<T>)._promise;
        if (next instanceof Promise) return next;
        return Promise.resolve(next);
      }),
    );
  }

  recover(
    predicate: (error: AppError) => boolean,
    fn: (error: AppError) => Result<T> | ResultAsync<T> | Promise<Result<T>>,
  ): ResultAsync<T> {
    return new ResultAsync(
      this._promise.then(r => {
        if (r.ok) return Promise.resolve(r);
        // biome-ignore lint/style/noNonNullAssertion: errors array is non-empty when ok is false
        if (!predicate(r.errors[0]!)) return Promise.resolve(r);
        // biome-ignore lint/style/noNonNullAssertion: errors array is non-empty when ok is false
        const next = fn(r.errors[0]!);
        if (next instanceof ResultAsync) return (next as ResultAsync<T>)._promise;
        if (next instanceof Promise) return next;
        return Promise.resolve(next);
      }),
    );
  }

  // ─── TERMINAL ─────────────────────────────────────────────────────────────

  async always<U>(fn: (result: Result<T>) => U | Promise<U>): Promise<U> {
    const r = await this._promise;
    return fn(r);
  }

  /**
   * Exhaustive pattern match — extracts a value from either branch.
   * This is the primary way to exit the ResultAsync pipeline.
   *
   * @example
   * const name = await fromAsync(getUser(id)).match(u => u.name, () => 'anonymous');
   */
  async match<U>(
    onSuccess: (value: T) => U | Promise<U>,
    onError: (errors: readonly AppError[]) => U | Promise<U>,
  ): Promise<U> {
    const r = await this._promise;
    return r.ok ? onSuccess(r.value) : onError(r.errors);
  }

  /**
   * Throws ResultUnwrapError if failed. Returns the value on success.
   * Use match() for safe extraction without exceptions.
   */
  async unwrap(): Promise<T> {
    return Result.unwrap(await this._promise);
  }

  /**
   * Returns the success value or a default.
   */
  async unwrapOr(defaultValue: T): Promise<T> {
    return Result.unwrapOr(await this._promise, defaultValue);
  }

  /**
   * Converts the pipeline to a raw Promise<Result<T>>.
   * Use when the callee expects a plain Result.
   */
  toResult(): Promise<Result<T>> {
    return this._promise;
  }
}

/**
 * Convenience entry point for building a ResultAsync pipeline from a Promise<Result<T>>.
 *
 * @example
 * const name = await fromAsync(fetchUser(id))
 *   .andThen(user => validateUser(user))
 *   .map(user => user.name)
 *   .match(name => name, () => 'anonymous');
 */
export const fromAsync = <T>(promise: Promise<Result<T>>): ResultAsync<T> =>
  ResultAsync.from(promise);
