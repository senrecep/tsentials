/**
 * Ord<T> — type-safe total ordering.
 *
 * Provides composable comparison logic for sorting, min/max, and ordered collections.
 *
 * @example
 * import { Ord, sortBy, min, max, contramap } from 'tsentials/ord';
 *
 * interface User {
 *   readonly age: number;
 *   readonly name: string;
 * }
 *
 * const byAge = contramap(Ord.number, (u: User) => u.age);
 * const sorted = sortBy(users, byAge);
 *
 * const youngest = min(byAge, userA, userB);
 */

import { type Eq, strict } from '../eq/index.js';

/**
 * Ordering result: -1 (less), 0 (equal), or 1 (greater).
 */
export type Ordering = -1 | 0 | 1;

/**
 * Ordering type class. Extends Eq with a compare operation.
 */
export interface Ord<A> extends Eq<A> {
  readonly compare: (first: A, second: A) => Ordering;
}

// ─── Primitive instances ─────────────────────────────────────────────────────

/** Number ordering (ascending). */
export const number: Ord<number> = {
  equals: (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b)),
  compare: (first, second): Ordering => {
    if (Number.isNaN(first) && Number.isNaN(second)) return 0;
    if (Number.isNaN(first)) return 1; // NaN sorts last
    if (Number.isNaN(second)) return -1;
    return first < second ? -1 : first > second ? 1 : 0;
  },
};

/** String ordering (lexicographic). */
export const string: Ord<string> = {
  equals: strict.equals,
  compare: (first, second) => (first < second ? -1 : first > second ? 1 : 0),
};

/** Boolean ordering (false < true). */
export const boolean: Ord<boolean> = {
  equals: strict.equals,
  compare: (first, second) => (first === second ? 0 : first ? 1 : -1),
};

/** Date ordering (chronological). */
export const date: Ord<Date> = {
  equals: (first, second) => first.getTime() === second.getTime(),
  compare: (first, second) => {
    const a = first.getTime();
    const b = second.getTime();
    return a < b ? -1 : a > b ? 1 : 0;
  },
};

// ─── Combinators ─────────────────────────────────────────────────────────────

/**
 * Reverses an ordering (descending).
 *
 * @example
 * const desc = reverse(Ord.number);
 * desc.compare(1, 2); // 1 (1 is "greater" in descending order)
 */
export function reverse<A>(ord: Ord<A>): Ord<A> {
  return {
    equals: ord.equals,
    compare: (first, second) => -ord.compare(first, second) as Ordering,
  };
}

/**
 * Derives an Ord<B> from an Ord<A> using a projection function.
 *
 * @example
 * const byAge = contramap(Ord.number, (u: User) => u.age);
 */
export function contramap<A, B>(ordA: Ord<A>, f: (b: B) => A): Ord<B> {
  return {
    equals: (first, second) => ordA.equals(f(first), f(second)),
    compare: (first, second) => ordA.compare(f(first), f(second)),
  };
}

/**
 * Combines multiple Ord instances into one for an object/struct.
 * Compares fields in order, short-circuiting on first difference.
 *
 * @example
 * const byNameThenAge = struct({
 *   name: Ord.string,
 *   age: Ord.number,
 * });
 */
export function struct<A extends Record<string, unknown>>(
  ords: { [K in keyof A]: Ord<A[K]> },
): Ord<A> {
  const keys = Object.keys(ords) as Array<keyof A>;
  return {
    equals: (first, second) => {
      for (const key of keys) {
        if (!ords[key].equals(first[key], second[key])) return false;
      }
      return true;
    },
    compare: (first, second) => {
      for (const key of keys) {
        const cmp = ords[key].compare(first[key], second[key]);
        if (cmp !== 0) return cmp;
      }
      return 0;
    },
  };
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Sorts an array using an Ord instance.
 *
 * @example
 * const sorted = sortBy(users, byAge);
 */
export function sortBy<A>(as: ReadonlyArray<A>, ord: Ord<A>): Array<A> {
  return [...as].sort((a, b) => ord.compare(a, b));
}

/**
 * Returns the lesser of two values according to the Ord.
 */
export function min<A>(ord: Ord<A>, first: A, second: A): A {
  return ord.compare(first, second) <= 0 ? first : second;
}

/**
 * Returns the greater of two values according to the Ord.
 */
export function max<A>(ord: Ord<A>, first: A, second: A): A {
  return ord.compare(first, second) >= 0 ? first : second;
}

/**
 * Clamps a value between a minimum and maximum.
 */
export function clamp<A>(ord: Ord<A>, lower: A, upper: A, value: A): A {
  if (ord.compare(lower, upper) > 0) {
    throw new Error('clamp: lower must be less than or equal to upper');
  }
  return ord.compare(value, lower) < 0 ? lower : ord.compare(value, upper) > 0 ? upper : value;
}

/**
 * Checks whether a value is between a minimum and maximum (inclusive).
 */
export function between<A>(ord: Ord<A>, lower: A, upper: A, value: A): boolean {
  return ord.compare(value, lower) >= 0 && ord.compare(value, upper) <= 0;
}

// ─── Namespace ───────────────────────────────────────────────────────────────

export const Ord = {
  number,
  string,
  boolean,
  date,
  reverse,
  contramap,
  struct,
  sortBy,
  min,
  max,
  clamp,
  between,
} as const;
