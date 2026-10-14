import type { AppError } from '../errors/app-error.js';
import { Err } from '../errors/app-error.js';
import type { AbortOptions } from '../result/abort.js';
import { observe, throwIfAborted, withAbort } from '../result/abort.js';
import type { AsyncRule, Rule } from '../rules/rule.js';
import { CascadeMode } from './cascade-mode.js';
import type { AsyncValidator, SyncValidator } from './contracts.js';
import type { EnumLike } from './enum-support.js';
import {
  hasOnlyDefinedBits,
  invalidEnumMessage,
  isDefinedMember,
  notAllowedEnumMessage,
} from './enum-support.js';
import type { Comparable, ContextState, ValidationMessage } from './internal.js';
import {
  assertNonNegative,
  compare,
  countOf,
  display,
  isEmptyIterable,
  isThenable,
  prefixError,
  sameValue,
  trackPending,
} from './internal.js';

/** Options of the default-message {@link RuleChain.must} overload. */
export interface MustOptions {
  /**
   * Text describing the condition, used in the default message
   * `'<path>' did not satisfy the condition: <expression>.`
   * Defaults to the predicate's source (`predicate.toString()`) — the closest runtime equivalent of the
   * source expression, but minifiers rewrite it, so pass it explicitly when
   * the message matters.
   */
  readonly expression?: string;
}

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;

// Unbounded — only pass a known, finite set of string patterns.
const regexCache = new Map<string, RegExp>();

function regexFor(pattern: string | RegExp): RegExp {
  if (typeof pattern !== 'string') return pattern;
  let regex = regexCache.get(pattern);
  if (!regex) {
    regex = new RegExp(pattern);
    regexCache.set(pattern, regex);
  }
  return regex;
}

/** `RegExp.test` without the `lastIndex` state of `g` / `y` regexes. */
function isMatch(regex: RegExp, value: string): boolean {
  regex.lastIndex = 0;
  const matched = regex.test(value);
  regex.lastIndex = 0;
  return matched;
}

const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined;

/**
 * A fluent validation chain for one property value.
 *
 * Validators run **eagerly**: each call checks the value immediately and records an
 * {@link AppError} on the owning {@link RuleContext} when the check fails.
 *
 * The default cascade mode is {@link CascadeMode.Stop}: once a failure is recorded the
 * remaining calls on the chain are skipped. Call `cascade(CascadeMode.Continue)` after a
 * guard check to accumulate every remaining error instead.
 *
 * Built-in validators are restricted to the property types they make sense for through
 * `this` parameters — `maxLength` on a `number` chain is a compile error. Every built-in
 * accepts an optional `message`: a string replaces the default description, an
 * {@link AppError} replaces the whole error (used verbatim).
 *
 * Null handling: `null` and `undefined` are both "null". Apart from `notNull`, `notEmpty`
 * and `equal`, built-ins skip a null value — guard with `notNull` / `notEmpty` first.
 */
export class RuleChain<TProp> {
  /** The property value captured when the chain was created. */
  readonly value: TProp;

  /** The full property path, e.g. `name`, `address.city`, `items[0].name`. */
  readonly propertyName: string;

  readonly #state: ContextState;
  #hasError = false;
  #continueMode = false;

  /** @internal Chains are created by `RuleContext.for` / `RuleContext.self`. */
  constructor(state: ContextState, value: TProp, propertyName: string) {
    this.#state = state;
    this.value = value;
    this.propertyName = propertyName;
  }

  /**
   * True when an error has been recorded AND the chain is in Stop mode — later validators
   * are skipped. Always false in Continue mode, so every validator runs.
   */
  get hasFailed(): boolean {
    return this.#hasError && !this.#continueMode;
  }

  /**
   * Changes the cascade behaviour for the validators that follow.
   * A no-op when the chain has already failed: a guard that fired keeps the chain stopped,
   * so the guard error is the only one reported.
   */
  cascade(mode: CascadeMode): this {
    if (!this.#hasError) this.#continueMode = mode === CascadeMode.Continue;
    return this;
  }

  /**
   * Records `error` and marks the chain as failed. In Stop mode only the first error is
   * recorded; in Continue mode every call records. Use it in custom validators.
   */
  addError(error: AppError): this {
    if (!this.hasFailed) {
      this.#state.errors.push(error);
      this.#hasError = true;
    }
    return this;
  }

  #fail(rule: string, message: ValidationMessage | undefined, defaultMessage: () => string): void {
    this.addError(
      typeof message === 'object'
        ? message
        : Err.validation(`${this.propertyName}.${rule}`, message ?? defaultMessage()),
    );
  }

  /** Appends every error, bypassing the cascade guard, then marks the chain failed. */
  #propagate(errors: readonly AppError[], prefix?: string): void {
    for (const error of errors) {
      this.#state.errors.push(prefix === undefined ? error : prefixError(error, prefix));
    }
    this.#hasError = true;
  }

  #track<R>(work: () => Promise<R>): Promise<R> {
    return trackPending(this.#state, work);
  }

  // ─── CUSTOM PREDICATES ──────────────────────────────────────────────────────

  /**
   * Validates the value with a synchronous predicate (`true` = valid).
   *
   * - `must(pred)` → `<path>.Must`, `'<path>' did not satisfy the condition: <expression>.`
   * - `must(pred, code, message)` → the given code and message, used as-is (no path prefix).
   *
   * Throws a TypeError when the predicate returns a promise — use {@link mustAsync}.
   */
  must(predicate: (value: TProp) => boolean, options?: MustOptions): this;
  must(predicate: (value: TProp) => boolean, errorCode: string, errorMessage: string): this;
  must(
    predicate: (value: TProp) => boolean,
    codeOrOptions?: string | MustOptions,
    errorMessage?: string,
  ): this {
    if (this.hasFailed) return this;
    const passed: unknown = predicate(this.value);
    if (isThenable(passed)) {
      observe(passed);
      throw new TypeError('must() received an async predicate; use mustAsync() instead.');
    }
    if (passed) return this;
    if (typeof codeOrOptions === 'string') {
      return this.addError(Err.validation(codeOrOptions, errorMessage));
    }
    const expression = codeOrOptions?.expression ?? predicate.toString();
    return this.addError(
      Err.validation(
        `${this.propertyName}.Must`,
        `'${this.propertyName}' did not satisfy the condition: ${expression}.`,
      ),
    );
  }

  /**
   * Validates the value with an asynchronous predicate (`true` = valid). Await it, then
   * keep chaining on the resolved chain: `(await chain.mustAsync(...)).maxLength(5)`.
   *
   * The predicate receives the abort signal (`options.signal`, else the validation run's
   * signal). When that signal aborts, the returned promise rejects with its reason — an
   * abort is never turned into a validation error. A predicate that throws rejects too.
   */
  mustAsync(
    predicate: (value: TProp, signal: AbortSignal | undefined) => PromiseLike<boolean> | boolean,
    errorCode: string,
    errorMessage: string,
    options?: AbortOptions,
  ): Promise<this> {
    if (this.hasFailed) return Promise.resolve(this);
    const signal = options?.signal ?? this.#state.signal;
    return this.#track(async () => {
      throwIfAborted(signal);
      const passed = await withAbort(
        Promise.resolve().then(() => predicate(this.value, signal)),
        signal,
      );
      if (!passed) this.addError(Err.validation(errorCode, errorMessage));
      return this;
    });
  }

  // ─── RULE ENGINE INTEGRATION ────────────────────────────────────────────────

  /**
   * Evaluates a {@link Rule} against the value. On failure every error of the rule is
   * recorded as-is (codes are not prefixed) and the chain is marked failed.
   */
  satisfies(rule: Rule<TProp>): this {
    if (this.hasFailed) return this;
    const result: unknown = rule(this.value);
    if (isThenable(result)) {
      observe(result);
      throw new TypeError('satisfies() received an async rule; use satisfiesAsync() instead.');
    }
    const outcome = result as ReturnType<Rule<TProp>>;
    if (!outcome.ok) this.#propagate(outcome.errors);
    return this;
  }

  /** Async variant of {@link satisfies}; rejects with the signal's reason when it aborts. */
  satisfiesAsync(rule: AsyncRule<TProp> | Rule<TProp>, options?: AbortOptions): Promise<this> {
    if (this.hasFailed) return Promise.resolve(this);
    const signal = options?.signal ?? this.#state.signal;
    return this.#track(async () => {
      throwIfAborted(signal);
      const result = await withAbort(
        Promise.resolve().then(() => (rule as AsyncRule<TProp>)(this.value, signal)),
        signal,
      );
      if (!result.ok) this.#propagate(result.errors);
      return this;
    });
  }

  // ─── NESTED VALIDATORS ──────────────────────────────────────────────────────

  /**
   * Runs a nested validator on the value (skipped when the chain failed or the value is
   * null). Each nested error is re-created under this path: code `<path>.<code>`, the quoted
   * property name in the description qualified the same way, type and metadata preserved.
   * The chain is marked failed afterwards.
   */
  setValidator(validator: SyncValidator<NonNullable<TProp>>): this {
    if (this.hasFailed || isNullish(this.value)) return this;
    const result = validator.validate(this.value as NonNullable<TProp>);
    if (!result.ok) this.#propagate(result.errors, `${this.propertyName}.`);
    return this;
  }

  /** Async variant of {@link setValidator}; forwards the signal. */
  setValidatorAsync(
    validator: AsyncValidator<NonNullable<TProp>>,
    options?: AbortOptions,
  ): Promise<this> {
    if (this.hasFailed || isNullish(this.value)) return Promise.resolve(this);
    const signal = options?.signal ?? this.#state.signal;
    return this.#track(async () => {
      const result = await validator.validateAsync(
        this.value as NonNullable<TProp>,
        signal === undefined ? undefined : { signal },
      );
      if (!result.ok) this.#propagate(result.errors, `${this.propertyName}.`);
      return this;
    });
  }

  // ─── PRESENCE ───────────────────────────────────────────────────────────────

  /** Fails when the value is null or undefined → `<path>.NotNull`. */
  notNull(message?: ValidationMessage): this {
    if (!this.hasFailed && isNullish(this.value)) {
      this.#fail('NotNull', message, () => `'${this.propertyName}' must not be null.`);
    }
    return this;
  }

  /** Fails when the value is NOT null or undefined → `<path>.Null`. */
  null(message?: ValidationMessage): this {
    if (!this.hasFailed && !isNullish(this.value)) {
      this.#fail('Null', message, () => `'${this.propertyName}' must be null.`);
    }
    return this;
  }

  /**
   * Fails when the value is null, a whitespace-only string, or an empty collection
   * (array, Set, Map, any iterable) → `<path>.NotEmpty`.
   */
  notEmpty<S extends string | Iterable<unknown> | null | undefined>(
    this: RuleChain<S>,
    message?: ValidationMessage,
  ): RuleChain<S> {
    if (this.hasFailed) return this;
    const value = this.value;
    const empty = isNullish(value)
      ? true
      : typeof value === 'string'
        ? value.trim() === ''
        : isEmptyIterable(value);
    if (empty) this.#fail('NotEmpty', message, () => `'${this.propertyName}' must not be empty.`);
    return this;
  }

  // ─── STRING LENGTH ──────────────────────────────────────────────────────────

  /** Fails when the string is longer than `max` UTF-16 units → `<path>.MaxLength`. */
  maxLength<S extends string | null | undefined>(
    this: RuleChain<S>,
    max: number,
    message?: ValidationMessage,
  ): RuleChain<S> {
    assertNonNegative('max', max);
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && value.length > max) {
      this.#fail(
        'MaxLength',
        message,
        () =>
          `'${this.propertyName}' must be ${max} characters or fewer. You entered ${value.length} characters.`,
      );
    }
    return this;
  }

  /** Fails when the string is shorter than `min` UTF-16 units → `<path>.MinLength`. */
  minLength<S extends string | null | undefined>(
    this: RuleChain<S>,
    min: number,
    message?: ValidationMessage,
  ): RuleChain<S> {
    assertNonNegative('min', min);
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && value.length < min) {
      this.#fail(
        'MinLength',
        message,
        () =>
          `'${this.propertyName}' must be at least ${min} characters. You entered ${value.length} characters.`,
      );
    }
    return this;
  }

  /** Fails when the string length is outside `[min, max]` → `<path>.Length`. */
  length<S extends string | null | undefined>(
    this: RuleChain<S>,
    min: number,
    max: number,
    message?: ValidationMessage,
  ): RuleChain<S> {
    assertNonNegative('min', min);
    if (min > max) throw new RangeError(`min (${min}) must not be greater than max (${max}).`);
    const value = this.value;
    if (this.hasFailed || isNullish(value)) return this;
    const len = value.length;
    if (len < min || len > max) {
      this.#fail(
        'Length',
        message,
        () =>
          `'${this.propertyName}' must be between ${min} and ${max} characters. You entered ${len} characters.`,
      );
    }
    return this;
  }

  // ─── STRING FORMAT ──────────────────────────────────────────────────────────

  /** Fails when the string is not `local@domain.tld` shaped → `<path>.EmailAddress`. */
  emailAddress<S extends string | null | undefined>(
    this: RuleChain<S>,
    message?: ValidationMessage,
  ): RuleChain<S> {
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && !isMatch(EMAIL_REGEX, value)) {
      this.#fail(
        'EmailAddress',
        message,
        () => `'${this.propertyName}' is not a valid email address.`,
      );
    }
    return this;
  }

  /**
   * Fails when the string does not match `pattern` (searched, not anchored — add `^…$`
   * yourself) → `<path>.Matches`. String patterns are compiled once and cached.
   */
  matches<S extends string | null | undefined>(
    this: RuleChain<S>,
    pattern: string | RegExp,
    message?: ValidationMessage,
  ): RuleChain<S> {
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && !isMatch(regexFor(pattern), value)) {
      this.#fail('Matches', message, () => `'${this.propertyName}' is not in the correct format.`);
    }
    return this;
  }

  // ─── STRING CONTENT ─────────────────────────────────────────────────────────

  /** Fails when the string does not contain `substring` (ordinal) → `<path>.Contains`. */
  contains<S extends string | null | undefined>(
    this: RuleChain<S>,
    substring: string,
    message?: ValidationMessage,
  ): RuleChain<S> {
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && !value.includes(substring)) {
      this.#fail('Contains', message, () => `'${this.propertyName}' must contain '${substring}'.`);
    }
    return this;
  }

  /** Fails when the string does not start with `prefix` (ordinal) → `<path>.StartsWith`. */
  startsWith<S extends string | null | undefined>(
    this: RuleChain<S>,
    prefix: string,
    message?: ValidationMessage,
  ): RuleChain<S> {
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && !value.startsWith(prefix)) {
      this.#fail(
        'StartsWith',
        message,
        () => `'${this.propertyName}' must start with '${prefix}'.`,
      );
    }
    return this;
  }

  /** Fails when the string does not end with `suffix` (ordinal) → `<path>.EndsWith`. */
  endsWith<S extends string | null | undefined>(
    this: RuleChain<S>,
    suffix: string,
    message?: ValidationMessage,
  ): RuleChain<S> {
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && !value.endsWith(suffix)) {
      this.#fail('EndsWith', message, () => `'${this.propertyName}' must end with '${suffix}'.`);
    }
    return this;
  }

  // ─── EQUALITY ───────────────────────────────────────────────────────────────

  /**
   * Fails when the value is not equal to `expected` → `<path>.Equal`.
   *
   * Strings compare ordinally and null equals null; the message quotes the expected value
   * (`must be equal to 'x'.`). Other values compare with `===` (Dates by timestamp, NaN
   * equals NaN) and a null value fails against a non-null expected value (`must be equal to 5.`).
   * Null vs null follows the string rule (equal), since TypeScript cannot tell the overloads apart.
   */
  equal(expected: TProp, message?: ValidationMessage): this {
    if (this.hasFailed) return this;
    const value: unknown = this.value;
    if (
      typeof expected === 'string' ||
      typeof value === 'string' ||
      (isNullish(value) && isNullish(expected))
    ) {
      const equal = isNullish(value) ? isNullish(expected) : value === expected;
      if (!equal) {
        this.#fail(
          'Equal',
          message,
          () => `'${this.propertyName}' must be equal to '${expected ?? ''}'.`,
        );
      }
      return this;
    }
    if (isNullish(value) || !sameValue(value, expected)) {
      this.#fail(
        'Equal',
        message,
        () =>
          `'${this.propertyName}' must be equal to ${isNullish(expected) ? '' : display(expected)}.`,
      );
    }
    return this;
  }

  /**
   * Fails when the value equals `forbidden` → `<path>.NotEqual`. Same comparison and
   * quoting rules as {@link equal}; a null value only fails against a null string.
   */
  notEqual(forbidden: TProp, message?: ValidationMessage): this {
    if (this.hasFailed) return this;
    const value: unknown = this.value;
    if (
      typeof forbidden === 'string' ||
      typeof value === 'string' ||
      (isNullish(value) && isNullish(forbidden))
    ) {
      const equal = isNullish(value) ? isNullish(forbidden) : value === forbidden;
      if (equal) {
        this.#fail(
          'NotEqual',
          message,
          () => `'${this.propertyName}' must not be equal to '${forbidden ?? ''}'.`,
        );
      }
      return this;
    }
    if (!isNullish(value) && sameValue(value, forbidden)) {
      this.#fail(
        'NotEqual',
        message,
        () =>
          // Reached only when the value equals `forbidden` and is not nullish, so neither is.
          `'${this.propertyName}' must not be equal to ${display(forbidden)}.`,
      );
    }
    return this;
  }

  // ─── COMPARABLE (number, bigint, string, Date) ──────────────────────────────

  /** Fails when the value is not greater than `threshold` → `<path>.GreaterThan`. */
  greaterThan<V extends Comparable | null | undefined>(
    this: RuleChain<V>,
    threshold: NonNullable<V>,
    message?: ValidationMessage,
  ): RuleChain<V> {
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && compare(value, threshold) <= 0) {
      this.#fail(
        'GreaterThan',
        message,
        () => `'${this.propertyName}' must be greater than ${display(threshold)}.`,
      );
    }
    return this;
  }

  /** Fails when the value is less than `threshold` → `<path>.GreaterThanOrEqualTo`. */
  greaterThanOrEqualTo<V extends Comparable | null | undefined>(
    this: RuleChain<V>,
    threshold: NonNullable<V>,
    message?: ValidationMessage,
  ): RuleChain<V> {
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && compare(value, threshold) < 0) {
      this.#fail(
        'GreaterThanOrEqualTo',
        message,
        () => `'${this.propertyName}' must be greater than or equal to ${display(threshold)}.`,
      );
    }
    return this;
  }

  /** Fails when the value is not less than `threshold` → `<path>.LessThan`. */
  lessThan<V extends Comparable | null | undefined>(
    this: RuleChain<V>,
    threshold: NonNullable<V>,
    message?: ValidationMessage,
  ): RuleChain<V> {
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && compare(value, threshold) >= 0) {
      this.#fail(
        'LessThan',
        message,
        () => `'${this.propertyName}' must be less than ${display(threshold)}.`,
      );
    }
    return this;
  }

  /** Fails when the value is greater than `threshold` → `<path>.LessThanOrEqualTo`. */
  lessThanOrEqualTo<V extends Comparable | null | undefined>(
    this: RuleChain<V>,
    threshold: NonNullable<V>,
    message?: ValidationMessage,
  ): RuleChain<V> {
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && compare(value, threshold) > 0) {
      this.#fail(
        'LessThanOrEqualTo',
        message,
        () => `'${this.propertyName}' must be less than or equal to ${display(threshold)}.`,
      );
    }
    return this;
  }

  /**
   * Fails when the value is outside `[min, max]` → `<path>.InclusiveBetween`.
   * Throws a RangeError when `min > max`.
   */
  inclusiveBetween<V extends Comparable | null | undefined>(
    this: RuleChain<V>,
    min: NonNullable<V>,
    max: NonNullable<V>,
    message?: ValidationMessage,
  ): RuleChain<V> {
    if (compare(min, max) > 0) {
      throw new RangeError(`min (${display(min)}) must not be greater than max (${display(max)}).`);
    }
    const value = this.value;
    if (
      !this.hasFailed &&
      !isNullish(value) &&
      (compare(value, min) < 0 || compare(value, max) > 0)
    ) {
      this.#fail(
        'InclusiveBetween',
        message,
        () =>
          `'${this.propertyName}' must be between ${display(min)} and ${display(max)} (inclusive).`,
      );
    }
    return this;
  }

  /**
   * Fails when the value is outside `(min, max)` → `<path>.ExclusiveBetween`.
   * Throws a RangeError when `min >= max`.
   */
  exclusiveBetween<V extends Comparable | null | undefined>(
    this: RuleChain<V>,
    min: NonNullable<V>,
    max: NonNullable<V>,
    message?: ValidationMessage,
  ): RuleChain<V> {
    if (compare(min, max) >= 0) {
      throw new RangeError(
        `min (${display(min)}) must be less than max (${display(max)}) for an exclusive range.`,
      );
    }
    const value = this.value;
    if (
      !this.hasFailed &&
      !isNullish(value) &&
      (compare(value, min) <= 0 || compare(value, max) >= 0)
    ) {
      this.#fail(
        'ExclusiveBetween',
        message,
        () =>
          `'${this.propertyName}' must be between ${display(min)} and ${display(max)} (exclusive).`,
      );
    }
    return this;
  }

  // ─── COLLECTION COUNT ───────────────────────────────────────────────────────

  /** Fails when the collection has fewer than `min` items → `<path>.MinCount`. */
  minCount<C extends Iterable<unknown> | null | undefined>(
    this: RuleChain<C>,
    min: number,
    message?: ValidationMessage,
  ): RuleChain<C> {
    assertNonNegative('min', min);
    const value = this.value;
    if (this.hasFailed || isNullish(value)) return this;
    const count = countOf(value);
    if (count < min) {
      this.#fail(
        'MinCount',
        message,
        () => `'${this.propertyName}' must contain at least ${min} item(s). It contains ${count}.`,
      );
    }
    return this;
  }

  /** Fails when the collection has more than `max` items → `<path>.MaxCount`. */
  maxCount<C extends Iterable<unknown> | null | undefined>(
    this: RuleChain<C>,
    max: number,
    message?: ValidationMessage,
  ): RuleChain<C> {
    assertNonNegative('max', max);
    const value = this.value;
    if (this.hasFailed || isNullish(value)) return this;
    const count = countOf(value);
    if (count > max) {
      this.#fail(
        'MaxCount',
        message,
        () => `'${this.propertyName}' must contain at most ${max} item(s). It contains ${count}.`,
      );
    }
    return this;
  }

  /** Fails when the item count is outside `[min, max]` → `<path>.CountBetween`. */
  countBetween<C extends Iterable<unknown> | null | undefined>(
    this: RuleChain<C>,
    min: number,
    max: number,
    message?: ValidationMessage,
  ): RuleChain<C> {
    assertNonNegative('min', min);
    if (min > max) throw new RangeError(`min (${min}) must not be greater than max (${max}).`);
    const value = this.value;
    if (this.hasFailed || isNullish(value)) return this;
    const count = countOf(value);
    if (count < min || count > max) {
      this.#fail(
        'CountBetween',
        message,
        () =>
          `'${this.propertyName}' must contain between ${min} and ${max} item(s). It contains ${count}.`,
      );
    }
    return this;
  }

  // ─── ENUMS ──────────────────────────────────────────────────────────────────

  /**
   * Fails when the value is not a declared member of `enumObject` → `<path>.IsDefinedEnum`,
   * `'<value>' is not a valid <enumName>. Allowed values: <members>.` Null is skipped.
   * `enumName` stands in for the type name, which TypeScript does not keep at runtime.
   * Flag combinations are not members — use {@link hasOnlyDefinedFlags} for flag enums.
   */
  isDefinedEnum<V extends string | number | null | undefined>(
    this: RuleChain<V>,
    enumObject: EnumLike,
    enumName: string,
    message?: ValidationMessage,
  ): RuleChain<V> {
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && !isDefinedMember(enumObject, value)) {
      this.#fail('IsDefinedEnum', message, () => invalidEnumMessage(enumObject, enumName, value));
    }
    return this;
  }

  /**
   * Fails when the value is not one of `allowed` → `<path>.IsOneOf`, listing only the
   * allowed members. Null is skipped.
   */
  isOneOf<V extends string | number | null | undefined>(
    this: RuleChain<V>,
    enumObject: EnumLike,
    enumName: string,
    allowed: readonly NonNullable<V>[],
    message?: ValidationMessage,
  ): RuleChain<V> {
    if (!Array.isArray(allowed)) throw new TypeError('allowed must be an array.');
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && !allowed.includes(value as NonNullable<V>)) {
      this.#fail('IsOneOf', message, () =>
        notAllowedEnumMessage(enumObject, enumName, value, allowed as readonly (string | number)[]),
      );
    }
    return this;
  }

  /**
   * Fails when the value sets a bit that no declared member covers
   * → `<path>.HasOnlyDefinedFlags`. Null is skipped.
   */
  hasOnlyDefinedFlags<V extends string | number | null | undefined>(
    this: RuleChain<V>,
    enumObject: EnumLike,
    enumName: string,
    message?: ValidationMessage,
  ): RuleChain<V> {
    const value = this.value;
    if (!this.hasFailed && !isNullish(value) && !hasOnlyDefinedBits(enumObject, value)) {
      this.#fail('HasOnlyDefinedFlags', message, () =>
        invalidEnumMessage(enumObject, enumName, value),
      );
    }
    return this;
  }
}
