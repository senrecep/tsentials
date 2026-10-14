/**
 * Typed property paths: path extraction. `rules.for('address.city')` is checked against the model type at
 * compile time and becomes the `address.city` prefix of every error code at runtime.
 */

/** Values whose members are never traversed by {@link PropertyPath}. */
type Terminal =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | Date
  | RegExp
  | ((...args: never[]) => unknown)
  | Iterable<unknown>
  | PromiseLike<unknown>;

/** Depth countdown: keeps recursive models from exhausting the type checker. */
type Prev = [never, 0, 1, 2, 3, 4, 5];

/**
 * Every dotted property path of `T` up to five levels deep, e.g.
 * `'name' | 'address' | 'address.city'`. Collections, Dates, functions and primitives
 * are leaves: validate collection items with `forEach`.
 */
export type PropertyPath<T, D extends number = 5> = [D] extends [never]
  ? never
  : NonNullable<T> extends Terminal
    ? never
    : {
        [K in keyof NonNullable<T> & string]-?:
          | K
          | (NonNullable<NonNullable<T>[K]> extends Terminal
              ? never
              : `${K}.${PropertyPath<NonNullable<T>[K], Prev[D]>}`);
      }[keyof NonNullable<T> & string];

/** `undefined` when `T` may be null / undefined (a null intermediate segment yields `undefined`). */
type Nullish<T> = T extends null | undefined ? undefined : never;

/**
 * Type of the value found at `P` in `T`. A nullable intermediate segment adds `undefined`,
 * mirroring the runtime null tolerance of {@link getPath}.
 */
export type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof NonNullable<T>
    ? Nullish<T> | PathValue<NonNullable<T>[K], Rest>
    : never
  : P extends keyof NonNullable<T>
    ? Nullish<T> | NonNullable<T>[P]
    : never;

/** Paths of `T` whose value is a (possibly nullable) non-string iterable, `forEach` targets. */
export type CollectionPath<T> = {
  [P in PropertyPath<T>]: NonNullable<PathValue<T, P>> extends string
    ? never
    : NonNullable<PathValue<T, P>> extends Iterable<unknown>
      ? P
      : never;
}[PropertyPath<T>];

/** Element type of a (possibly nullable) iterable. */
export type ElementOf<V> = NonNullable<V> extends Iterable<infer E> ? E : never;

/**
 * Reads a dotted path from `model`. A null / undefined intermediate segment yields
 * `undefined` instead of throwing.
 */
export function getPath(model: unknown, path: string): unknown {
  let current: unknown = model;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
