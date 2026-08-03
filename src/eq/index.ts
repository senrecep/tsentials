/**
 * Eq<T> — type-safe structural equality.
 *
 * Provides a composable way to define and reuse equality checks.
 * Unlike reference equality (`===`), Eq instances can compare deep structure.
 *
 * @example
 * import { Eq, struct, contramap } from 'tsentials/eq';
 *
 * interface User {
 *   readonly id: number;
 *   readonly name: string;
 * }
 *
 * const eqUser: Eq<User> = struct({
 *   id: Eq.number,
 *   name: Eq.string,
 * });
 *
 * eqUser.equals({ id: 1, name: 'A' }, { id: 1, name: 'A' }); // true
 *
 * // Compare users by id only
 * const eqById = contramap(Eq.number, (u: User) => u.id);
 */

/**
 * Equality type class.
 */
export interface Eq<A> {
  readonly equals: (first: A, second: A) => boolean;
}

// ─── Primitive instances ─────────────────────────────────────────────────────

/** Strict reference equality for any type. */
export const strict: Eq<unknown> = {
  equals: (first, second) => first === second,
};

/** String equality. */
export const string: Eq<string> = strict as Eq<string>;

/** Number equality. */
export const number: Eq<number> = strict as Eq<number>;

/** Boolean equality. */
export const boolean: Eq<boolean> = strict as Eq<boolean>;

/** Date equality (compares timestamps). */
export const date: Eq<Date> = {
  equals: (first, second) => first.getTime() === second.getTime(),
};

// ─── Combinators ─────────────────────────────────────────────────────────────

/**
 * Derives an Eq<B> from an Eq<A> using a projection function.
 *
 * @example
 * const eqByName = contramap(Eq.string, (user: User) => user.name);
 */
export function contramap<A, B>(eqA: Eq<A>, f: (b: B) => A): Eq<B> {
  return {
    equals: (first, second) => eqA.equals(f(first), f(second)),
  };
}

/**
 * Combines multiple Eq instances into one for an object/struct.
 *
 * @example
 * const eqPoint = struct({ x: Eq.number, y: Eq.number });
 */
export function struct<A extends object>(eqs: { [K in keyof A]: Eq<A[K]> }): Eq<A> {
  return {
    equals: (first, second) => {
      for (const key of Object.keys(eqs)) {
        const k = key as keyof A;
        if (!eqs[k].equals(first[k] as A[keyof A], second[k] as A[keyof A])) {
          return false;
        }
      }
      return true;
    },
  };
}

/**
 * Eq for arrays when an Eq for the element type is known.
 *
 * @example
 * const eqNumberArray = getArrayEq(Eq.number);
 */
export function getArrayEq<A>(eqA: Eq<A>): Eq<ReadonlyArray<A>> {
  return {
    equals: (first, second) => {
      if (first.length !== second.length) return false;
      for (let i = 0; i < first.length; i++) {
        if (!eqA.equals(first[i] as A, second[i] as A)) return false;
      }
      return true;
    },
  };
}

// ─── Namespace ───────────────────────────────────────────────────────────────

export const Eq = {
  strict,
  string,
  number,
  boolean,
  date,
  contramap,
  struct,
  getArrayEq,
} as const;
