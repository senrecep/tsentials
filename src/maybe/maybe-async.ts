import type { AppError } from '../errors/app-error.js';
import { type AbortOptions, throwIfAborted, withAbort } from '../result/abort.js';
import { ResultAsync } from '../result/result-async.js';
import { Maybe } from './maybe.js';

type MaybeLike<T> = Maybe<T> | PromiseLike<Maybe<T>>;

/**
 * MaybeAsync<T> wraps a Promise<Maybe<T>> and provides a fluent async API, like
 * {@link ResultAsync} does for Result: every step returns a MaybeAsync synchronously and
 * the pipeline is awaited once at the end (`await` yields a plain `Maybe<T>`).
 *
 * Callbacks may be sync or async. Each step takes an optional `{ signal }`: the callback
 * receives the signal, the step rejects with `signal.reason` when the signal is already
 * aborted before the callback runs, and stops waiting for the callback as soon as the
 * signal aborts. A step whose callback does not run (e.g. `map` on None) ignores the signal.
 *
 * @example
 * const name = await MaybeAsync.from(repo.find(id))
 *   .filter(user => user.isActive)
 *   .bind((user, signal) => loadProfile(user.id, { signal }), { signal })
 *   .map(profile => profile.displayName)
 *   .getOrElse(() => 'anonymous');
 */
export class MaybeAsync<T> implements PromiseLike<Maybe<T>> {
  private constructor(private readonly _promise: Promise<Maybe<T>>) {}

  // biome-ignore lint/suspicious/noThenProperty: implements PromiseLike<Maybe<T>> so MaybeAsync can be awaited
  then<TResult1 = Maybe<T>, TResult2 = never>(
    onfulfilled?: ((value: Maybe<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this._promise.then(onfulfilled, onrejected);
  }

  // ─── FACTORIES ────────────────────────────────────────────────────────────

  /** Wraps a pending Maybe (a Promise, another MaybeAsync, or a plain Maybe). */
  static from<T>(source: MaybeLike<T>): MaybeAsync<T> {
    return new MaybeAsync(Promise.resolve(source));
  }

  static some<T>(value: T): MaybeAsync<T> {
    return MaybeAsync.from(Maybe.some(value));
  }

  static none<T>(): MaybeAsync<T> {
    return MaybeAsync.from(Maybe.none<T>());
  }

  /** Same rules as {@link Maybe.fromTryAsync}: null/undefined or a rejection becomes None. */
  static try<T>(
    fn: (signal?: AbortSignal) => PromiseLike<T | null | undefined>,
    options?: AbortOptions,
  ): MaybeAsync<T> {
    return new MaybeAsync(Maybe.fromTryAsync(fn, options));
  }

  // ─── PIPELINE ─────────────────────────────────────────────────────────────

  /** Transforms the value. A `null`/`undefined` result is None. */
  map<U>(
    fn: (value: T, signal?: AbortSignal) => U | PromiseLike<U>,
    options?: AbortOptions,
  ): MaybeAsync<U> {
    const signal = options?.signal;
    return this.next((m) => Maybe.mapAsync(m, (v) => run(() => fn(v, signal), signal)));
  }

  /** Chains a function returning a Maybe (sync or pending). */
  bind<U>(
    fn: (value: T, signal?: AbortSignal) => MaybeLike<U>,
    options?: AbortOptions,
  ): MaybeAsync<U> {
    const signal = options?.signal;
    return this.next((m) => Maybe.bindAsync(m, (v) => run(() => fn(v, signal), signal)));
  }

  /** Becomes None when the predicate returns false. */
  filter(
    predicate: (value: T, signal?: AbortSignal) => boolean | PromiseLike<boolean>,
    options?: AbortOptions,
  ): MaybeAsync<T> {
    const signal = options?.signal;
    return this.next((m) => Maybe.filterAsync(m, (v) => run(() => predicate(v, signal), signal)));
  }

  /** Runs a side effect on Some without altering the Maybe. */
  tap(
    fn: (value: T, signal?: AbortSignal) => void | PromiseLike<void>,
    options?: AbortOptions,
  ): MaybeAsync<T> {
    const signal = options?.signal;
    return this.next((m) => Maybe.tapAsync(m, (v) => run(() => fn(v, signal), signal)));
  }

  /** Runs a side effect on None without altering the Maybe. */
  tapNone(
    fn: (signal?: AbortSignal) => void | PromiseLike<void>,
    options?: AbortOptions,
  ): MaybeAsync<T> {
    const signal = options?.signal;
    return this.next((m) => Maybe.tapNoneAsync(m, () => run(() => fn(signal), signal)));
  }

  /** Returns the Maybe if it has a value, otherwise the fallback from `fn` (lazy). */
  orElse(fn: (signal?: AbortSignal) => MaybeLike<T>, options?: AbortOptions): MaybeAsync<T> {
    const signal = options?.signal;
    return this.next((m) => Maybe.orAsync(m, () => run(() => fn(signal), signal)));
  }

  /** Converts to a {@link ResultAsync}. Same default error as {@link Maybe.toResult}. */
  toResult(error?: AppError): ResultAsync<T> {
    return ResultAsync.from(this._promise.then((m) => Maybe.toResult(m, error)));
  }

  // ─── TERMINAL ─────────────────────────────────────────────────────────────

  /** Exhaustive pattern match: extracts a value from either branch. */
  async match<U>(
    onSome: (value: T, signal?: AbortSignal) => U | PromiseLike<U>,
    onNone: (signal?: AbortSignal) => U | PromiseLike<U>,
    options?: AbortOptions,
  ): Promise<U> {
    const signal = options?.signal;
    const m = await this._promise;
    return run(() => (m.hasValue ? onSome(m.value, signal) : onNone(signal)), signal);
  }

  /** Resolves to the value, or to the result of `fn` (lazy) when None. */
  async getOrElse(
    fn: (signal?: AbortSignal) => T | PromiseLike<T>,
    options?: AbortOptions,
  ): Promise<T> {
    const m = await this._promise;
    return m.hasValue ? m.value : run(() => fn(options?.signal), options?.signal);
  }

  /** Resolves to the value, or to `defaultValue` when None. */
  async getOrDefault(defaultValue: T): Promise<T> {
    return Maybe.getOrDefault(await this._promise, defaultValue);
  }

  private next<U>(step: (maybe: Maybe<T>) => Promise<Maybe<U>>): MaybeAsync<U> {
    return new MaybeAsync(this._promise.then(step));
  }
}

/** Runs one callback under the caller's signal: rejects if already aborted, stops waiting on abort. */
async function run<R>(fn: () => R | PromiseLike<R>, signal: AbortSignal | undefined): Promise<R> {
  throwIfAborted(signal);
  return withAbort(Promise.resolve(fn()), signal);
}
