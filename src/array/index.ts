/**
 * NonEmptyArray<T> — a type-safe array guaranteed to have at least one element.
 *
 * @example
 * import { NonEmptyArray, asNonEmptyArray, head } from 'tsentials/array';
 *
 * const items: NonEmptyArray<string> = ['a', 'b', 'c'];
 * const first = head(items); // 'a' — no Maybe, no null check needed
 *
 * // Safe conversion from plain array
 * const maybeNonEmpty = asNonEmptyArray([]);        // None
 * const definitelyNonEmpty = asNonEmptyArray([1]);  // Some([1])
 */

import { Maybe } from '../maybe/index.js';

/**
 * An array that is guaranteed to have at least one element.
 */
export type NonEmptyArray<T> = Array<T> & { readonly 0: T };

/**
 * A read-only non-empty array.
 */
export type ReadonlyNonEmptyArray<T> = ReadonlyArray<T> & { readonly 0: T };

// ─── Type guards ─────────────────────────────────────────────────────────────

/**
 * Checks whether an array is non-empty, narrowing the type.
 */
export function isNonEmpty<T>(as: ReadonlyArray<T>): as is NonEmptyArray<T> {
  return as.length > 0;
}

// ─── Constructors ────────────────────────────────────────────────────────────

/**
 * Prepends an element to an array, producing a NonEmptyArray.
 */
export function prepend<T>(head: T, tail: ReadonlyArray<T>): NonEmptyArray<T> {
  return [head, ...tail] as NonEmptyArray<T>;
}

/**
 * Appends an element to an array, producing a NonEmptyArray.
 */
export function append<T>(init: ReadonlyArray<T>, last: T): NonEmptyArray<T> {
  return [...init, last] as unknown as NonEmptyArray<T>;
}

// ─── Safe extraction ─────────────────────────────────────────────────────────

/**
 * Returns the first element — safe because NonEmptyArray guarantees existence.
 */
export function head<T>(as: NonEmptyArray<T>): T {
  return as[0] as T;
}

/**
 * Returns all elements except the first.
 */
export function tail<T>(as: NonEmptyArray<T>): Array<T> {
  return as.slice(1);
}

/**
 * Returns the last element — safe because NonEmptyArray guarantees existence.
 */
export function last<T>(as: NonEmptyArray<T>): T {
  return as[as.length - 1] as T;
}

/**
 * Returns all elements except the last.
 */
export function init<T>(as: NonEmptyArray<T>): Array<T> {
  return as.slice(0, -1);
}

// ─── Conversions ─────────────────────────────────────────────────────────────

/**
 * Converts a plain array to a Maybe<NonEmptyArray>.
 * Returns None if the array is empty.
 */
export function asNonEmptyArray<T>(as: ReadonlyArray<T>): Maybe<NonEmptyArray<T>> {
  return isNonEmpty(as) ? Maybe.some(as) : Maybe.none<NonEmptyArray<T>>();
}

/**
 * Converts a NonEmptyArray to a plain array (widening).
 */
export function toArray<T>(as: NonEmptyArray<T>): Array<T> {
  return as;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Maps over a NonEmptyArray, preserving the non-empty guarantee.
 */
export function map<T, U>(as: NonEmptyArray<T>, f: (value: T) => U): NonEmptyArray<U> {
  return (as as Array<T>).map(f) as NonEmptyArray<U>;
}

/**
 * Filters a NonEmptyArray. Result is a plain array because filtering may empty it.
 */
export function filter<T>(as: NonEmptyArray<T>, f: (value: T) => boolean): Array<T> {
  return (as as Array<T>).filter(f);
}

/**
 * Reverses a NonEmptyArray, preserving the non-empty guarantee.
 */
export function reverse<T>(as: NonEmptyArray<T>): NonEmptyArray<T> {
  return [...(as as Array<T>)].reverse() as NonEmptyArray<T>;
}

/**
 * Sorts a NonEmptyArray, preserving the non-empty guarantee.
 */
export function sort<T>(as: NonEmptyArray<T>, compare: (a: T, b: T) => number): NonEmptyArray<T> {
  return [...(as as Array<T>)].sort(compare) as NonEmptyArray<T>;
}

// ─── Namespace ───────────────────────────────────────────────────────────────

export const NonEmptyArray = {
  isNonEmpty,
  prepend,
  append,
  head,
  tail,
  last,
  init,
  asNonEmptyArray,
  toArray,
  map,
  filter,
  reverse,
  sort,
} as const;
