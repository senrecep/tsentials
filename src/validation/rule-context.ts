import type { AppError } from '../errors/app-error.js';
import { Err } from '../errors/app-error.js';
import type { AbortOptions } from '../result/abort.js';
import { observe, throwIfAborted, withAbort } from '../result/abort.js';
import type { AsyncRule, Rule } from '../rules/rule.js';
import type { ContextState } from './internal.js';
import { isThenable, trackPending } from './internal.js';
import type { CollectionPath, ElementOf, PathValue, PropertyPath } from './property-path.js';
import { getPath } from './property-path.js';
import { RuleChain } from './rule-chain.js';

/**
 * Collects validation errors for one model and creates {@link RuleChain}s for its
 * properties. A context lives for a single validation run, never store it.
 *
 * Inside `forEach` an item context prefixes every property name with the collection path
 * and index (`items[0].name`), and nested `forEach` calls compose (`orders[0].items[1].sku`).
 */
export class RuleContext<T> {
  /** The model (or collection item) this context validates. */
  readonly model: T;

  readonly #state: ContextState;
  readonly #prefix: string;

  /** @internal Contexts are created by {@link Validator}; item contexts by `forEach`. */
  constructor(model: T, state: ContextState, prefix = '') {
    this.model = model;
    this.#state = state;
    this.#prefix = prefix;
  }

  /** The abort signal of the current validation run (`undefined` for sync runs without one). */
  get signal(): AbortSignal | undefined {
    return this.#state.signal;
  }

  /**
   * Starts a chain for a property.
   *
   * - `for('address.city')`: a typed dotted path of the model, read immediately. A null /
   *   undefined intermediate segment yields `undefined` (guards like `notEmpty` then fire).
   * - `for(value, 'name')`: a pre-computed value with an explicit property name; computed or renamed properties use this form.
   *
   * Either form is prefixed inside `forEach` (`items[0].name`).
   */
  for<P extends PropertyPath<T>>(path: P): RuleChain<PathValue<T, P>>;
  for<V>(value: V, propertyName: string): RuleChain<V>;
  for(pathOrValue: unknown, propertyName?: string): RuleChain<unknown> {
    if (propertyName === undefined) {
      const path = pathOrValue as string;
      return new RuleChain(this.#state, getPath(this.model, path), this.#prefix + path);
    }
    return new RuleChain(this.#state, pathOrValue, this.#prefix + propertyName);
  }

  /**
   * Starts a chain for the collection item itself, named after the item's indexed path
   * (`tags[0]`): use it inside `forEach` over primitive collections. Throws a TypeError on
   * a root context, which has no item path.
   */
  self(): RuleChain<T> {
    if (this.#prefix === '') {
      throw new TypeError('self() is only available on forEach item contexts.');
    }
    return new RuleChain(this.#state, this.model, this.#prefix.slice(0, -1));
  }

  /**
   * Runs `configure` for every item of a collection with an item context prefixed by
   * `<path>[<index>].`. A null / undefined collection (or null intermediate segment)
   * produces no errors.
   *
   * - `forEach('items', (rules, item) => ...)`: a typed collection path of the model.
   * - `forEach(collection, 'items', (rules, item) => ...)`: explicit collection and name.
   *
   * Throws a TypeError when `configure` returns a promise, use {@link forEachAsync}.
   */
  forEach<P extends CollectionPath<T>>(
    path: P,
    configure: (
      rules: RuleContext<ElementOf<PathValue<T, P>>>,
      item: ElementOf<PathValue<T, P>>,
    ) => void,
  ): void;
  forEach<E>(
    collection: Iterable<E> | null | undefined,
    collectionName: string,
    configure: (rules: RuleContext<E>, item: E) => void,
  ): void;
  forEach(pathOrCollection: unknown, nameOrConfigure: unknown, maybeConfigure?: unknown): void {
    type ItemCallback = (rules: RuleContext<unknown>, item: unknown) => void;
    const [collection, name, configure] = this.#resolveCollection(
      pathOrCollection,
      nameOrConfigure as string | ItemCallback,
      maybeConfigure as ItemCallback | undefined,
    );
    if (collection === null || collection === undefined) return;
    const base = this.#prefix + name;
    let index = 0;
    for (const item of collection) {
      const outcome: unknown = configure(
        new RuleContext(item, this.#state, `${base}[${index}].`),
        item,
      );
      if (isThenable(outcome)) {
        observe(outcome);
        throw new TypeError('forEach() received an async callback; use forEachAsync() instead.');
      }
      index++;
    }
  }

  /**
   * Async variant of {@link forEach}: items are processed one after another and the abort
   * signal (`options.signal`, else the run's signal) is checked before each item, an abort
   * rejects with the signal's reason. The callback receives that signal.
   */
  forEachAsync<P extends CollectionPath<T>>(
    path: P,
    configure: (
      rules: RuleContext<ElementOf<PathValue<T, P>>>,
      item: ElementOf<PathValue<T, P>>,
      signal: AbortSignal | undefined,
    ) => void | PromiseLike<void>,
    options?: AbortOptions,
  ): Promise<void>;
  forEachAsync<E>(
    collection: Iterable<E> | null | undefined,
    collectionName: string,
    configure: (
      rules: RuleContext<E>,
      item: E,
      signal: AbortSignal | undefined,
    ) => void | PromiseLike<void>,
    options?: AbortOptions,
  ): Promise<void>;
  forEachAsync(
    pathOrCollection: unknown,
    nameOrConfigure: unknown,
    configureOrOptions?: unknown,
    maybeOptions?: AbortOptions,
  ): Promise<void> {
    type ItemCallback = (
      rules: RuleContext<unknown>,
      item: unknown,
      signal: AbortSignal | undefined,
    ) => void | PromiseLike<void>;
    const explicit = typeof nameOrConfigure === 'string';
    const options = (explicit ? maybeOptions : configureOrOptions) as AbortOptions | undefined;
    let resolved: [Iterable<unknown> | null | undefined, string, ItemCallback];
    try {
      resolved = this.#resolveCollection(
        pathOrCollection,
        nameOrConfigure as string | ItemCallback,
        configureOrOptions as ItemCallback | undefined,
      );
    } catch (error) {
      return Promise.reject(error);
    }
    const [collection, name, configure] = resolved;
    if (collection === null || collection === undefined) return Promise.resolve();
    const signal = options?.signal ?? this.#state.signal;
    const base = this.#prefix + name;
    return trackPending(this.#state, async () => {
      let index = 0;
      for (const item of collection) {
        throwIfAborted(signal);
        await withAbort(
          Promise.resolve().then(() =>
            configure(new RuleContext(item, this.#state, `${base}[${index}].`), item, signal),
          ),
          signal,
        );
        index++;
      }
    });
  }

  #resolveCollection<F>(
    pathOrCollection: unknown,
    nameOrConfigure: string | F,
    maybeConfigure: F | undefined,
  ): [Iterable<unknown> | null | undefined, string, F] {
    if (typeof nameOrConfigure === 'string') {
      if (maybeConfigure === undefined) throw new TypeError('configure must be a function.');
      return [
        pathOrCollection as Iterable<unknown> | null | undefined,
        nameOrConfigure,
        maybeConfigure,
      ];
    }
    const path = pathOrCollection as string;
    return [
      getPath(this.model, path) as Iterable<unknown> | null | undefined,
      path,
      nameOrConfigure,
    ];
  }

  /**
   * Adds a model-level error (cross-field checks). The code is used as-is, it is NOT
   * prefixed inside `forEach`.
   */
  addFailure(error: AppError): this;
  addFailure(code: string, description: string): this;
  addFailure(errorOrCode: AppError | string, description?: string): this {
    this.#state.errors.push(
      typeof errorOrCode === 'string' ? Err.validation(errorOrCode, description) : errorOrCode,
    );
    return this;
  }

  /**
   * Evaluates a {@link Rule} against the whole model (RuleEngine integration). Every error
   * of a failing rule is added as-is.
   */
  satisfies(rule: Rule<T>): this {
    const result: unknown = rule(this.model);
    if (isThenable(result)) {
      observe(result);
      throw new TypeError('satisfies() received an async rule; use satisfiesAsync() instead.');
    }
    const outcome = result as ReturnType<Rule<T>>;
    if (!outcome.ok) this.#state.errors.push(...outcome.errors);
    return this;
  }

  /** Async variant of {@link satisfies}; rejects with the signal's reason when it aborts. */
  satisfiesAsync(rule: AsyncRule<T> | Rule<T>, options?: AbortOptions): Promise<this> {
    const signal = options?.signal ?? this.#state.signal;
    return trackPending(this.#state, async () => {
      throwIfAborted(signal);
      const result = await withAbort(
        Promise.resolve().then(() => (rule as AsyncRule<T>)(this.model, signal)),
        signal,
      );
      if (!result.ok) this.#state.errors.push(...result.errors);
      return this;
    });
  }
}
