/**
 * Maybe<T> represents an optional value — either Some(value) or None.
 *
 * TypeScript adaptation of CSharpEssentials.Maybe.Maybe<T> (readonly partial struct).
 *
 * Design note: While TypeScript's `T | undefined` covers many use cases,
 * an explicit Maybe<T> type provides:
 * - Explicit intent (vs accidental undefined)
 * - Composable map/bind/match pipeline
 * - Bridge to Result<T> for error-path handling
 *
 * Uses a discriminated union for zero-cost type narrowing.
 */
export type Maybe<T> =
  | { readonly hasValue: true; readonly value: T }
  | { readonly hasValue: false };

/**
 * Factory and utility namespace for Maybe<T> operations.
 * Mirrors the static methods and module extensions of C#'s Maybe<T>.
 *
 * @example
 * const user = Maybe.from(getUserById(42));
 * const name = Maybe.map(user, u => u.name);
 * const result = Maybe.match(name, n => `Hello ${n}`, () => 'Hello, stranger');
 */
export const Maybe = {
  /**
   * Creates a Maybe with a value (Some).
   * Equivalent to C#'s `Maybe<T>.From(value)` when value is non-null.
   */
  some<T>(value: T): Maybe<T> {
    return Object.freeze({ hasValue: true, value }) as Maybe<T>;
  },

  /**
   * Creates an empty Maybe (None).
   * Equivalent to C#'s `Maybe<T>.None`.
   */
  none<T>(): Maybe<T> {
    return Object.freeze({ hasValue: false }) as Maybe<T>;
  },

  /**
   * Creates a Maybe from a nullable value.
   * Equivalent to C#'s `Maybe<T>.From(T? value)`.
   * Null and undefined both become None.
   */
  from<T>(value: T | null | undefined): Maybe<T> {
    return value != null ? Maybe.some(value) : Maybe.none<T>();
  },

  /**
   * Creates a Maybe from a factory function, catching thrown errors as None.
   * Equivalent to C#'s `Maybe<T>.From(Func<T?> func)`.
   */
  fromTry<T>(fn: () => T | null | undefined): Maybe<T> {
    try {
      return Maybe.from(fn());
    } catch {
      return Maybe.none<T>();
    }
  },

  /**
   * Returns true if the Maybe has a value.
   * Type guard that narrows to `{ hasValue: true; value: T }`.
   */
  isSome<T>(maybe: Maybe<T>): maybe is { hasValue: true; value: T } {
    return maybe.hasValue;
  },

  /**
   * Returns true if the Maybe has no value.
   */
  isNone<T>(maybe: Maybe<T>): maybe is { hasValue: false } {
    return !maybe.hasValue;
  },

  /**
   * Transforms the value inside a Maybe if it has one.
   * Equivalent to C#'s `Maybe<T>.Map<TResult>`.
   */
  map<T, U>(maybe: Maybe<T>, fn: (value: T) => U): Maybe<U> {
    return maybe.hasValue ? Maybe.some(fn(maybe.value)) : Maybe.none<U>();
  },

  /**
   * Chains a Maybe-returning function (monadic bind / flatMap).
   * Equivalent to C#'s `Maybe<T>.Bind<TResult>`.
   */
  bind<T, U>(maybe: Maybe<T>, fn: (value: T) => Maybe<U>): Maybe<U> {
    return maybe.hasValue ? fn(maybe.value) : Maybe.none<U>();
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
   * Equivalent to C#'s `Match<TResult>(Func<T, TResult> some, Func<TResult> none)`.
   */
  match<T, U>(maybe: Maybe<T>, onSome: (value: T) => U, onNone: () => U): U {
    return maybe.hasValue ? onSome(maybe.value) : onNone();
  },

  /**
   * Returns the value or a fallback if None.
   * Equivalent to C#'s `GetValueOrDefault(T defaultValue)`.
   */
  getOrDefault<T>(maybe: Maybe<T>, defaultValue: T): T {
    return maybe.hasValue ? maybe.value : defaultValue;
  },

  /**
   * Returns the value or throws if None.
   * Equivalent to C#'s `GetValueOrThrow(string? message)`.
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
   * Equivalent to C#'s `GetValueOrDefault(Func<T> factory)`.
   */
  getOrElse<T>(maybe: Maybe<T>, fn: () => T): T {
    return maybe.hasValue ? maybe.value : fn();
  },

  /**
   * Deconstructs a Maybe into a tuple [hasValue, value | undefined].
   * Equivalent to C#'s `Deconstruct(out bool hasValue, out T? value)`.
   */
  deconstruct<T>(maybe: Maybe<T>): [hasValue: true, value: T] | [hasValue: false, value: undefined] {
    return maybe.hasValue ? [true, maybe.value] : [false, undefined];
  },

  // ─── ASYNC PIPELINE ──────────────────────────────────────────────────────────

  /**
   * Async version of Maybe.map.
   * Equivalent to C#'s Task<Maybe<T>> Map extension.
   */
  async mapAsync<T, U>(maybe: Maybe<T>, fn: (value: T) => Promise<U>): Promise<Maybe<U>> {
    return maybe.hasValue ? Maybe.some(await fn(maybe.value)) : Maybe.none<U>();
  },

  /**
   * Async version of Maybe.bind.
   * Equivalent to C#'s Task<Maybe<T>> Bind extension.
   */
  async bindAsync<T, U>(maybe: Maybe<T>, fn: (value: T) => Promise<Maybe<U>>): Promise<Maybe<U>> {
    return maybe.hasValue ? fn(maybe.value) : Maybe.none<U>();
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
   * Equivalent to C#'s Task<Maybe<T>> Match extension.
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
  async filterAsync<T>(maybe: Maybe<T>, predicate: (value: T) => Promise<boolean>): Promise<Maybe<T>> {
    if (!maybe.hasValue) return maybe;
    return (await predicate(maybe.value)) ? maybe : Maybe.none<T>();
  },

  // ─── FALLBACK / CONDITIONAL ──────────────────────────────────────────────────

  /**
   * Returns the Maybe if it has a value, otherwise returns the fallback Maybe.
   * Equivalent to C#'s `Maybe<T>.Or(Maybe<T> fallback)`.
   */
  or<T>(maybe: Maybe<T>, fallback: Maybe<T>): Maybe<T> {
    return maybe.hasValue ? maybe : fallback;
  },

  /**
   * Returns the Maybe if it has a value, otherwise calls the factory and returns its result.
   * Factory is only invoked when needed (lazy).
   * Equivalent to C#'s `Maybe<T>.Or(Func<Maybe<T>> fallback)`.
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
   * Condition can be a boolean or a predicate over the value.
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
    return cond ? fn(maybe.value) : maybe;
  },
} as const;
