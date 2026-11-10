import { Maybe } from './maybe.js';

/**
 * Returns the first element (or the first element matching `predicate`) of any iterable as Maybe<T>.
 * None when nothing is found or when the found element is `null`/`undefined`
 * (the search does not continue past it).
 *
 * @example
 * tryFirst([1, 2, 3])                 // Some(1)
 * tryFirst([1, 2, 3], (n) => n > 1)   // Some(2)
 * tryFirst([])                        // None
 */
export function tryFirst<T>(items: Iterable<T>, predicate?: (value: T) => boolean): Maybe<T> {
  for (const value of items) {
    if (predicate === undefined || predicate(value)) return Maybe.from(value);
  }
  return Maybe.none<T>();
}

/**
 * Returns the last element (or the last element matching `predicate`) as Maybe<T>.
 * None when nothing is found or when the found element is `null`/`undefined`.
 * An array is searched from the end; any other iterable is read to the end.
 *
 * @example
 * tryLast([1, 2, 3])                  // Some(3)
 * tryLast([1, 2, 3], (n) => n < 3)    // Some(2)
 */
export function tryLast<T>(items: Iterable<T>, predicate?: (value: T) => boolean): Maybe<T> {
  if (!Array.isArray(items)) {
    let last = Maybe.none<T>();
    for (const value of items) {
      if (predicate === undefined || predicate(value)) last = Maybe.from(value);
    }
    return last;
  }
  const arr: readonly T[] = items;
  if (predicate === undefined) {
    return arr.length > 0 ? Maybe.from(arr[arr.length - 1]) : Maybe.none<T>();
  }
  for (let i = arr.length - 1; i >= 0; i--) {
    // biome-ignore lint/style/noNonNullAssertion: i is within bounds
    const value = arr[i]!;
    if (predicate(value)) return Maybe.from(value);
  }
  return Maybe.none<T>();
}

/**
 * Looks a value up as Maybe<T>:
 * - `tryFind(array, predicate)`: the first element matching the predicate;
 * - `tryFind(map, key)`: the value stored under `key` in a `Map`;
 * - `tryFind(record, key)`: the own property `key` of a plain object.
 *
 * None when nothing is found or when the found value is `null`/`undefined`.
 *
 * @example
 * tryFind([1, 2, 3], (n) => n > 1)          // Some(2)
 * tryFind(new Map([['a', 1]]), 'a')         // Some(1)
 * tryFind({ a: 1 } as Record<string, number>, 'b')  // None
 */
export function tryFind<T>(arr: readonly T[], predicate: (value: T) => boolean): Maybe<T>;
export function tryFind<K, V>(map: ReadonlyMap<K, V>, key: K): Maybe<V>;
export function tryFind<R extends object, K extends keyof R>(record: R, key: K): Maybe<R[K]>;
export function tryFind(source: unknown, keyOrPredicate: unknown): Maybe<unknown> {
  if (Array.isArray(source)) {
    return tryFirst(source, keyOrPredicate as (value: unknown) => boolean);
  }
  if (source instanceof Map) {
    return source.has(keyOrPredicate) ? Maybe.from(source.get(keyOrPredicate)) : Maybe.none();
  }
  const record = source as Record<PropertyKey, unknown>;
  const key = keyOrPredicate as PropertyKey;
  return Object.hasOwn(record, key) ? Maybe.from(record[key]) : Maybe.none();
}

/**
 * Extracts all Some values from an iterable of Maybe<T>, discarding None values.
 * With a `selector`, each element is mapped to a Maybe first and only the Some values are kept.
 *
 * @example
 * choose([Maybe.some(user1), Maybe.none(), Maybe.some(user2)]);  // [user1, user2]
 * choose(users, (u) => Maybe.from(u.email));  // emails of the users that have one
 */
export function choose<T>(maybes: Iterable<Maybe<T>>): T[];
export function choose<T, U>(items: Iterable<T>, selector: (item: T) => Maybe<U>): U[];
export function choose(
  items: Iterable<unknown>,
  selector?: (item: unknown) => Maybe<unknown>,
): unknown[] {
  const result: unknown[] = [];
  for (const item of items) {
    const m = selector === undefined ? (item as Maybe<unknown>) : selector(item);
    if (m.hasValue) result.push(m.value);
  }
  return result;
}

/**
 * Converts a nullable value to Maybe<T>.
 * Ergonomic shorthand for Maybe.from().
 */
export function asMaybe<T>(value: T | null | undefined): Maybe<T> {
  return Maybe.from(value);
}
