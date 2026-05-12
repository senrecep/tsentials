import { Maybe } from './maybe.js';

/**
 * Returns the first element of an array as Maybe<T>, or None if empty.
 */
export function tryFirst<T>(arr: readonly T[]): Maybe<T> {
  // biome-ignore lint/style/noNonNullAssertion: arr[0] is defined because arr.length > 0 is checked
  return arr.length > 0 ? Maybe.some(arr[0]!) : Maybe.none<T>();
}

/**
 * Returns the last element as Maybe<T>, or None if empty.
 */
export function tryLast<T>(arr: readonly T[]): Maybe<T> {
  // biome-ignore lint/style/noNonNullAssertion: arr[arr.length - 1] is defined because arr.length > 0 is checked
  return arr.length > 0 ? Maybe.some(arr[arr.length - 1]!) : Maybe.none<T>();
}

/**
 * Returns the first element matching the predicate as Maybe<T>, or None.
 */
export function tryFind<T>(arr: readonly T[], predicate: (value: T) => boolean): Maybe<T> {
  const found = arr.find(predicate);
  return found !== undefined ? Maybe.some(found) : Maybe.none<T>();
}

/**
 * Extracts all Some values from an array of Maybe<T>, discarding None values.
 *
 * @example
 * const users = choose([Maybe.some(user1), Maybe.none(), Maybe.some(user2)]);
 * // [user1, user2]
 */
export function choose<T>(maybes: readonly Maybe<T>[]): T[] {
  const result: T[] = [];
  for (const m of maybes) {
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
