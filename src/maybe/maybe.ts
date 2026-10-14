import type { Eq } from '../eq/index.js';
import type { AppError } from '../errors/app-error.js';
import { Err } from '../errors/app-error.js';
import { type AbortOptions, isAbortError, rethrowIfAborted, withAbort } from '../result/abort.js';
import { Result, type VoidResult } from '../result/result.js';

/**
 * Maybe<T> represents an optional value — either Some(value) or None.
 *
 * Design note: While TypeScript's `T | undefined` covers many use cases,
 * an explicit Maybe<T> type provides:
 * - Explicit intent (vs accidental undefined)
 * - Composable map/bind/match pipeline
 * - Bridge to Result<T> for error-path handling
 *
 * Uses a discriminated union for zero-cost type narrowing.
 *
 * A Some never holds `null` or `undefined`: every factory and transformation that would
 * produce one (`some`, `map`, `mapIf`, `bind`, ...) yields None instead, so `value` is typed
 * `NonNullable<T>`.
 */
export type Maybe<T> =
  | { readonly hasValue: true; readonly value: NonNullable<T> }
  | { readonly hasValue: false };

/**
 * Factory and utility namespace for Maybe<T> operations.
 *
 * @example
 * const user = Maybe.from(getUserById(42));
 * const name = Maybe.map(user, u => u.name);
 * const result = Maybe.match(name, n => `Hello ${n}`, () => 'Hello, stranger');
 */
export const Maybe = {
  /**
   * Creates a Maybe with a value (Some). `null` and `undefined` become None, so a Some
   * always carries a real value.
   *
   * @example
   * Maybe.some(1)     // Some(1)
   * Maybe.some(null)  // None
   */
  some<T>(value: T): Maybe<T> {
    if (value == null) return Maybe.none<T>();
    return Object.freeze({ hasValue: true, value }) as Maybe<T>;
  },

  /**
   * Creates an empty Maybe (None).
   */
  none<T>(): Maybe<T> {
    return Object.freeze({ hasValue: false }) as Maybe<T>;
  },

  /**
   * Creates a Maybe from a nullable value.
   * Null and undefined both become None.
   */
  from<T>(value: T | null | undefined): Maybe<T> {
    return value != null ? Maybe.some(value) : Maybe.none<T>();
  },

  /**
   * Creates a Maybe from a factory function, catching thrown errors as None.
   */
  fromTry<T>(fn: () => T | null | undefined): Maybe<T> {
    try {
      return Maybe.from(fn());
    } catch (e) {
      // An abort is never swallowed; it propagates to the caller.
      if (isAbortError(e)) throw e;
      return Maybe.none<T>();
    }
  },

  /**
   * Async version of Maybe.fromTry: awaits `fn` and turns null/undefined or a rejection into None.
   *
   * With `{ signal }`: `fn` receives the signal, and when the caller's signal is aborted the
   * abort PROPAGATES (the promise rejects with it) instead of becoming None — even if `fn`
   * ignores the signal. Any other error, including an abort-like error while the caller's
   * signal is not aborted, becomes None (same rule as `Result.tryAsync`).
   *
   * @example
   * const user = await Maybe.fromTryAsync((signal) => repo.find(id, { signal }), { signal });
   */
  async fromTryAsync<T>(
    fn: (signal?: AbortSignal) => PromiseLike<T | null | undefined>,
    options?: AbortOptions,
  ): Promise<Maybe<T>> {
    const signal = options?.signal;
    try {
      return Maybe.from(await withAbort(fn(signal), signal));
    } catch (e) {
      rethrowIfAborted(e, signal);
      return Maybe.none<T>();
    }
  },

  /**
   * Returns true if the Maybe has a value.
   * Type guard that narrows to `{ hasValue: true; value: NonNullable<T> }`.
   */
  isSome<T>(maybe: Maybe<T>): maybe is { hasValue: true; value: NonNullable<T> } {
    return maybe.hasValue;
  },

  /**
   * Returns true if the Maybe has no value.
   */
  isNone<T>(maybe: Maybe<T>): maybe is { hasValue: false } {
    return !maybe.hasValue;
  },

  /**
   * Transforms the value inside a Maybe if it has one. A `null`/`undefined` result is None.
   */
  map<T, U>(maybe: Maybe<T>, fn: (value: T) => U): Maybe<U> {
    return maybe.hasValue ? Maybe.some(fn(maybe.value)) : Maybe.none<U>();
  },

  /**
   * Chains a Maybe-returning function (monadic bind / flatMap). A hand-built Some holding
   * `null`/`undefined` is returned as None.
   */
  bind<T, U>(maybe: Maybe<T>, fn: (value: T) => Maybe<U>): Maybe<U> {
    return maybe.hasValue ? normalize(fn(maybe.value)) : Maybe.none<U>();
  },

  /**
   * Executes a function for its side effect if the Maybe has a value.
   */
  tap<T>(maybe: Maybe<T>, fn: (value: T) => void): Maybe<T> {
    if (maybe.hasValue) fn(maybe.value);
    return maybe;
  },

  /**
   * Exhaustive pattern match over a Maybe.
   */
  match<T, U>(maybe: Maybe<T>, onSome: (value: T) => U, onNone: () => U): U {
    return maybe.hasValue ? onSome(maybe.value) : onNone();
  },

  /**
   * Returns the value or a fallback if None.
   */
  getOrDefault<T>(maybe: Maybe<T>, defaultValue: T): T {
    return maybe.hasValue ? maybe.value : defaultValue;
  },

  /**
   * Returns the value or throws if None.
   */
  getOrThrow<T>(maybe: Maybe<T>, message = 'Maybe has no value.'): T {
    if (!maybe.hasValue) throw new Error(message);
    return maybe.value;
  },

  /**
   * Returns the value or undefined (native TypeScript idiom).
   */
  getOrUndefined<T>(maybe: Maybe<T>): T | undefined {
    return maybe.hasValue ? maybe.value : undefined;
  },

  /**
   * Filters a Maybe based on a predicate — becomes None if predicate fails.
   */
  filter<T>(maybe: Maybe<T>, predicate: (value: T) => boolean): Maybe<T> {
    if (!maybe.hasValue) return maybe;
    return predicate(maybe.value) ? maybe : Maybe.none<T>();
  },

  /**
   * Returns the value, or calls the factory function if None.
   * Lazy alternative to getOrDefault — factory is only invoked when needed.
   */
  getOrElse<T>(maybe: Maybe<T>, fn: () => T): T {
    return maybe.hasValue ? maybe.value : fn();
  },

  /**
   * Deconstructs a Maybe into a tuple [hasValue, value | undefined].
   */
  deconstruct<T>(
    maybe: Maybe<T>,
  ): [hasValue: true, value: T] | [hasValue: false, value: undefined] {
    return maybe.hasValue ? [true, maybe.value] : [false, undefined];
  },

  /**
   * Atomically extracts the value from a Maybe.
   * Returns a tuple with hasValue flag and optional value.
   *
   * @example
   * const [hasValue, value] = Maybe.tryGet(maybe);
   * if (hasValue) console.log(value);
   */
  tryGet<T>(maybe: Maybe<T>): [hasValue: true, value: T] | [hasValue: false, value: undefined] {
    return maybe.hasValue ? [true, maybe.value] : [false, undefined];
  },

  /**
   * Void-only pattern match — runs side effects without returning a value.
   * Complement of `match` for cases where you only need side effects.
   *
   * @example
   * Maybe.switch(maybe,
   *   user => console.log(`Found ${user.name}`),
   *   () => console.log('User not found'),
   * );
   */
  switch<T>(maybe: Maybe<T>, onSome: (value: T) => void, onNone: () => void): void {
    if (maybe.hasValue) onSome(maybe.value);
    else onNone();
  },

  /**
   * Flattens a nested Maybe<Maybe<T>> into Maybe<T>.
   * If the outer Maybe is None, returns None.
   * If the outer Maybe is Some, returns the inner Maybe.
   */
  flatten<T>(maybe: Maybe<Maybe<T>> | null | undefined): Maybe<T> {
    return maybe?.hasValue ? maybe.value : Maybe.none<T>();
  },

  /**
   * Turns a nullable Maybe into a Maybe: null/undefined becomes None
   * (e.g. an optional `Maybe<T>` property).
   *
   * @example
   * Maybe.fromNullable(dto.points) // dto.points?: Maybe<number>
   */
  fromNullable<T>(maybe: Maybe<T> | null | undefined): Maybe<T> {
    return maybe ?? Maybe.none<T>();
  },

  /**
   * Converts a Maybe into an array.
   * Some → [value], None → []
   */
  toArray<T>(maybe: Maybe<T>): T[] {
    return maybe.hasValue ? [maybe.value] : [];
  },

  /**
   * Returns the value or throws using a custom error factory.
   * Allows throwing domain-specific errors instead of generic Error.
   *
   * @example
   * Maybe.getOrThrow(maybe, () => new DomainError('User.NotFound'));
   */
  getOrThrowFactory<T>(maybe: Maybe<T>, factory: () => Error): T {
    if (!maybe.hasValue) throw factory();
    return maybe.value;
  },

  // ─── ASYNC PIPELINE ──────────────────────────────────────────────────────────

  /**
   * Async version of Maybe.map. A `null`/`undefined` result is None.
   */
  async mapAsync<T, U>(maybe: Maybe<T>, fn: (value: T) => Promise<U>): Promise<Maybe<U>> {
    return maybe.hasValue ? Maybe.some(await fn(maybe.value)) : Maybe.none<U>();
  },

  /**
   * Async version of Maybe.bind.
   */
  async bindAsync<T, U>(maybe: Maybe<T>, fn: (value: T) => Promise<Maybe<U>>): Promise<Maybe<U>> {
    return maybe.hasValue ? normalize(await fn(maybe.value)) : Maybe.none<U>();
  },

  /**
   * Async version of Maybe.tap.
   * Runs an async side effect without altering the Maybe.
   */
  async tapAsync<T>(maybe: Maybe<T>, fn: (value: T) => Promise<void>): Promise<Maybe<T>> {
    if (maybe.hasValue) await fn(maybe.value);
    return maybe;
  },

  /**
   * Async version of Maybe.match.
   */
  async matchAsync<T, U>(
    maybe: Maybe<T>,
    onSome: (value: T) => Promise<U>,
    onNone: () => Promise<U>,
  ): Promise<U> {
    return maybe.hasValue ? onSome(maybe.value) : onNone();
  },

  /**
   * Async version of Maybe.filter.
   * Becomes None if the async predicate returns false.
   */
  async filterAsync<T>(
    maybe: Maybe<T>,
    predicate: (value: T) => Promise<boolean>,
  ): Promise<Maybe<T>> {
    if (!maybe.hasValue) return maybe;
    return (await predicate(maybe.value)) ? maybe : Maybe.none<T>();
  },

  // ─── FALLBACK / CONDITIONAL ──────────────────────────────────────────────────

  /**
   * Returns the Maybe if it has a value, otherwise returns the fallback Maybe.
   */
  or<T>(maybe: Maybe<T>, fallback: Maybe<T>): Maybe<T> {
    return maybe.hasValue ? maybe : fallback;
  },

  /**
   * Returns the Maybe if it has a value, otherwise calls the factory and returns its result.
   * Factory is only invoked when needed (lazy).
   */
  orElse<T>(maybe: Maybe<T>, fn: () => Maybe<T>): Maybe<T> {
    return maybe.hasValue ? maybe : fn();
  },

  /**
   * Async version of Maybe.orElse.
   * Factory is only invoked when the Maybe is None.
   */
  async orAsync<T>(maybe: Maybe<T>, fn: () => Promise<Maybe<T>>): Promise<Maybe<T>> {
    return maybe.hasValue ? maybe : fn();
  },

  /**
   * Executes a side-effect function when the Maybe is None.
   * Complement of `tap` which runs on Some.
   */
  tapNone<T>(maybe: Maybe<T>, fn: () => void): Maybe<T> {
    if (!maybe.hasValue) fn();
    return maybe;
  },

  /**
   * Transforms the value only if the condition is true; otherwise passes the Maybe through unchanged.
   * Condition can be a boolean or a predicate over the value. A `null`/`undefined` result is None.
   */
  mapIf<T>(
    maybe: Maybe<T>,
    condition: boolean | ((value: T) => boolean),
    fn: (value: T) => T,
  ): Maybe<T> {
    if (!maybe.hasValue) return maybe;
    const cond = typeof condition === 'function' ? condition(maybe.value) : condition;
    return cond ? Maybe.some(fn(maybe.value)) : maybe;
  },

  /**
   * Binds (flatMaps) only if the condition is true; otherwise passes the Maybe through unchanged.
   * Condition can be a boolean or a predicate over the value.
   */
  bindIf<T>(
    maybe: Maybe<T>,
    condition: boolean | ((value: T) => boolean),
    fn: (value: T) => Maybe<T>,
  ): Maybe<T> {
    if (!maybe.hasValue) return maybe;
    const cond = typeof condition === 'function' ? condition(maybe.value) : condition;
    return cond ? normalize(fn(maybe.value)) : maybe;
  },

  // ─── EQUALITY / FORMATTING ───────────────────────────────────────────────────

  /**
   * Compares two Maybes: None equals None, Some(a) equals Some(b) when `eq.equals(a, b)`
   * (default: strict `===`), Some never equals None.
   *
   * @example
   * Maybe.equals(Maybe.some(1), Maybe.some(1))                  // true
   * Maybe.equals(Maybe.some(u1), Maybe.some(u2), eqUserById)    // custom Eq
   */
  equals<T>(first: Maybe<T>, second: Maybe<T>, eq?: Eq<T>): boolean {
    if (!first.hasValue || !second.hasValue) return first.hasValue === second.hasValue;
    return eq ? eq.equals(first.value, second.value) : first.value === second.value;
  },

  /**
   * Strict comparison of a Maybe with a plain value:
   * a null/undefined value equals None only; a non-null value never equals None,
   * and equals Some(x) when `eq.equals(x, value)` (default: strict `===`).
   *
   * @example
   * Maybe.equalsValue(Maybe.none<number>(), 0)     // false
   * Maybe.equalsValue(Maybe.none<number>(), null)  // true
   */
  equalsValue<T>(maybe: Maybe<T>, value: T | null | undefined, eq?: Eq<T>): boolean {
    if (value == null) return !maybe.hasValue;
    if (!maybe.hasValue) return false;
    return eq ? eq.equals(maybe.value, value) : maybe.value === value;
  },

  /**
   * Formats a Maybe as `Some(value)` or `None`. The value is formatted with `String(value)`;
   * a nested Maybe is formatted recursively (`Some(Some(1))`, `Some(None)`).
   * Named `format` (like `EnumDefinition.format`) because an own `toString` on the namespace
   * would replace `Object.prototype.toString` and break `String(Maybe)` / `${Maybe}`.
   */
  format<T>(maybe: Maybe<T>): string {
    if (!maybe.hasValue) return 'None';
    const value: unknown = maybe.value;
    return `Some(${isMaybe(value) ? Maybe.format(value) : String(value)})`;
  },

  // ─── RESULT BRIDGE ───────────────────────────────────────────────────────────

  /**
   * Converts a Maybe into a Result: Some(v) → success(v), None → failure(error).
   * Default error: `NotFound` `Maybe.Result` — "The 'Maybe' has no value.".
   * `maybeToResult` (from `tsentials/result`) is an alias of this function.
   */
  toResult<T>(maybe: Maybe<T>, error?: AppError): Result<T> {
    return maybe.hasValue
      ? Result.success(maybe.value)
      : Result.failure<T>(error ?? noValueError());
  },

  /**
   * Converts a Maybe into a void Result: Some → ok, None → failure(error).
   * Default error is the same as {@link Maybe.toResult}.
   */
  toUnitResult<T>(maybe: Maybe<T>, error?: AppError): VoidResult {
    return maybe.hasValue ? Result.ok() : Result.failure(error ?? noValueError());
  },

  // ─── COLLECTIONS ─────────────────────────────────────────────────────────────

  /**
   * All-or-nothing: Some(values[]) when every Maybe has a value, otherwise None
   * (stops at the first None).
   */
  sequence<T>(maybes: Iterable<Maybe<T>>): Maybe<T[]> {
    const values: T[] = [];
    for (const m of maybes) {
      if (!m.hasValue) return Maybe.none<T[]>();
      values.push(m.value);
    }
    return Maybe.some(values);
  },

  /**
   * Maps each item with `fn` and sequences the results. `fn` is not called
   * after the first None.
   */
  traverse<A, B>(items: Iterable<A>, fn: (item: A) => Maybe<B>): Maybe<B[]> {
    const values: B[] = [];
    for (const item of items) {
      const m = fn(item);
      if (!m.hasValue) return Maybe.none<B[]>();
      values.push(m.value);
    }
    return Maybe.some(values);
  },

  /**
   * Splits Maybes into the present values (in order) and the number of Nones.
   */
  partition<T>(maybes: Iterable<Maybe<T>>): { values: T[]; noneCount: number } {
    const values: T[] = [];
    let noneCount = 0;
    for (const m of maybes) {
      if (m.hasValue) values.push(m.value);
      else noneCount++;
    }
    return { values, noneCount };
  },
} as const;

/** Turns a hand-built Some holding `null`/`undefined` into None. */
function normalize<T>(maybe: Maybe<T>): Maybe<T> {
  return maybe.hasValue && maybe.value == null ? Maybe.none<T>() : maybe;
}

/** Structural check for a Maybe value (used to format nested Maybes). */
function isMaybe(value: unknown): value is Maybe<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const hasValue = (value as { hasValue?: unknown }).hasValue;
  return hasValue === false || (hasValue === true && 'value' in value);
}

function noValueError(): AppError {
  return Err.notFound('Maybe.Result', "The 'Maybe' has no value.");
}
