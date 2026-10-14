import type { AbortOptions } from '../result/abort.js';
import { observe, throwIfAborted, withAbort } from '../result/abort.js';
import type { VoidResult } from '../result/result.js';
import { Result } from '../result/result.js';
import type { AsyncRule, Rule } from '../rules/rule.js';
import type { AsyncValidator, SyncValidator } from './contracts.js';
import type { ContextState } from './internal.js';
import { createContextState, isThenable } from './internal.js';
import { RuleContext } from './rule-context.js';

/** Synchronous rule definition: `(rules, model) => { rules.for('name').notEmpty(); }`. */
export type Configure<T> = (rules: RuleContext<T>, model: T) => void;

/**
 * Asynchronous rule definition. Await every async rule (`mustAsync`, `forEachAsync`,
 * `setValidatorAsync`, `satisfiesAsync`) before the returned promise settles.
 */
export type AsyncConfigure<T> = (
  rules: RuleContext<T>,
  model: T,
  signal: AbortSignal | undefined,
) => void | PromiseLike<void>;

function assertInstance(instance: unknown): void {
  if (instance === null || instance === undefined) {
    throw new TypeError('instance must not be null or undefined.');
  }
}

function assertFunction(value: unknown, name: string): void {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function.`);
}

function assertSettled(state: ContextState): void {
  if (state.pending > 0) {
    for (const promise of state.inflight) observe(promise);
    throw new TypeError(
      'An async rule was not awaited. Await mustAsync / forEachAsync / setValidatorAsync / ' +
        'satisfiesAsync inside the configure callback.',
    );
  }
}

function build<T>(instance: T, state: ContextState): Result<T> {
  return state.errors.length > 0 ? Result.failureFrom<T>(state.errors) : Result.success(instance);
}

function runSync<T>(instance: T, configure: Configure<T>): Result<T> {
  const state = createContextState(undefined);
  const outcome: unknown = configure(new RuleContext(instance, state), instance);
  if (isThenable(outcome)) {
    observe(outcome);
    throw new TypeError('configure returned a promise; use validateAsync() instead.');
  }
  assertSettled(state);
  return build(instance, state);
}

async function runAsync<T>(
  instance: T,
  configure: AsyncConfigure<T>,
  signal: AbortSignal | undefined,
): Promise<Result<T>> {
  throwIfAborted(signal);
  const state = createContextState(signal);
  await withAbort(
    Promise.resolve().then(() => configure(new RuleContext(instance, state), instance, signal)),
    signal,
  );
  assertSettled(state);
  return build(instance, state);
}

const toVoid = <T>(result: Result<T>): VoidResult =>
  result.ok ? Result.ok() : Result.failureFrom<void>(result.errors);

/**
 * Base class for reusable validators.
 *
 * Subclasses implement {@link configure}; it may be sync or async. Use {@link validate} for
 * sync rule sets and {@link validateAsync} when any rule is async or a signal is needed.
 * A success carries the validated instance; a failure carries every recorded error in
 * the order the rules ran.
 *
 * @example
 * class UserValidator extends Validator<User> {
 *   protected configure(rules: RuleContext<User>) {
 *     rules.for('name').notEmpty().maxLength(50);
 *     rules.for('email').notEmpty().emailAddress();
 *   }
 * }
 * new UserValidator().validate(user);                  // Result<User>
 *
 * // Inline
 * Validator.validate(user, (rules) => { rules.for('name').notEmpty(); });
 */
export abstract class Validator<T> implements SyncValidator<T>, AsyncValidator<T> {
  /** Declares the rules. `signal` is the caller's abort signal (`undefined` for `validate`). */
  protected abstract configure(
    rules: RuleContext<T>,
    model: T,
    signal: AbortSignal | undefined,
  ): void | PromiseLike<void>;

  /**
   * Validates synchronously. Throws a TypeError when `configure` returns a promise or leaves
   * an async rule un-awaited, use {@link validateAsync} for async rule sets.
   */
  validate(instance: T): Result<T> {
    assertInstance(instance);
    return runSync(instance, (rules, model) => this.configure(rules, model, undefined));
  }

  /**
   * Validates asynchronously. When `options.signal` aborts the promise rejects with the
   * signal's reason, an abort never becomes a validation error.
   */
  async validateAsync(instance: T, options?: AbortOptions): Promise<Result<T>> {
    assertInstance(instance);
    return runAsync(
      instance,
      (rules, model, signal) => this.configure(rules, model, signal),
      options?.signal,
    );
  }

  /** This validator as a {@link Rule} for {@link RuleEngine} composition. */
  toRule(): Rule<T> {
    return (model) => toVoid(this.validate(model));
  }

  /** This validator as an {@link AsyncRule}; the rule's signal argument wins over `options`. */
  toAsyncRule(options?: AbortOptions): AsyncRule<T> {
    return async (model, signal) =>
      toVoid(await this.validateAsync(model, { signal: signal ?? options?.signal }));
  }

  /**
   * Runs another validator's rules on the same context (composition).
   * Errors land in this run; await the result when `other` is async.
   */
  protected include(
    other: Validator<T>,
    rules: RuleContext<T>,
    model: T,
    signal?: AbortSignal,
  ): void | PromiseLike<void> {
    return other.configure(rules, model, signal);
  }

  // ─── STATIC (inline) API ────────────────────────────────────────────────────

  /**
   * Validates `instance` with inline sync rules.
   *
   * @example
   * Validator.validate(user, (rules) => {
   *   rules.for('name').notEmpty().maxLength(50);
   * });
   */
  static validate<U>(instance: U, configure: Configure<U>): Result<U> {
    assertInstance(instance);
    assertFunction(configure, 'configure');
    return runSync(instance, configure);
  }

  /** Validates `instance` with inline (possibly async) rules; see {@link Validator.validateAsync}. */
  static async validateAsync<U>(
    instance: U,
    configure: AsyncConfigure<U>,
    options?: AbortOptions,
  ): Promise<Result<U>> {
    assertInstance(instance);
    assertFunction(configure, 'configure');
    return runAsync(instance, configure, options?.signal);
  }

  /**
   * Validates the value of a successful result; a failure passes through unchanged
   *. Railway step for `Result.then` pipelines.
   */
  static validateWith<U>(result: Result<U>, validator: SyncValidator<U> | Configure<U>): Result<U> {
    if (validator === null || validator === undefined) {
      throw new TypeError('validator must not be null or undefined.');
    }
    if (!result.ok) return result;
    return typeof validator === 'function'
      ? Validator.validate(result.value, validator)
      : validator.validate(result.value);
  }

  /**
   * Async {@link Validator.validateWith}. Accepts a result or a promise of one; awaiting the
   * promise and the validation both honour `options.signal`.
   */
  static async validateWithAsync<U>(
    result: Result<U> | PromiseLike<Result<U>>,
    validator: AsyncValidator<U> | AsyncConfigure<U>,
    options?: AbortOptions,
  ): Promise<Result<U>> {
    if (validator === null || validator === undefined) {
      throw new TypeError('validator must not be null or undefined.');
    }
    const signal = options?.signal;
    const resolved = isThenable(result) ? await withAbort(result, signal) : result;
    if (!resolved.ok) return resolved;
    return typeof validator === 'function'
      ? Validator.validateAsync(resolved.value, validator, options)
      : validator.validateAsync(resolved.value, options);
  }

  /** Inline sync rules as a {@link Rule} for {@link RuleEngine} composition. */
  static toRule<U>(configure: Configure<U>): Rule<U> {
    assertFunction(configure, 'configure');
    return (model) => toVoid(Validator.validate(model, configure));
  }

  /** Inline async rules as an {@link AsyncRule}; the rule's signal argument wins over `options`. */
  static toAsyncRule<U>(configure: AsyncConfigure<U>, options?: AbortOptions): AsyncRule<U> {
    assertFunction(configure, 'configure');
    return async (model, signal) =>
      toVoid(
        await Validator.validateAsync(model, configure, { signal: signal ?? options?.signal }),
      );
  }
}
