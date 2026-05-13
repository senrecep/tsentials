/**
 * Predicate<T> — composable, type-safe boolean functions.
 *
 * @example
 * import { Predicate } from 'tsentials/predicate';
 *
 * const isAdult = Predicate.from((u: User) => u.age >= 18);
 * const isActive = Predicate.from((u: User) => u.isActive);
 *
 * const isValidUser = Predicate.and(isAdult, isActive);
 * isValidUser({ age: 20, isActive: true }); // true
 */

/**
 * A type-safe predicate: a function that refines a type.
 */
export interface Predicate<A> {
  readonly test: (value: A) => boolean;
}

/**
 * A refinement predicate: narrows the type on success.
 */
export interface Refinement<A, B extends A> {
  readonly test: (value: A) => value is B;
}

// ─── Constructors ────────────────────────────────────────────────────────────

/** Creates a Predicate from a plain boolean function. */
export function from<A>(f: (value: A) => boolean): Predicate<A> {
  return { test: f };
}

/** Creates a Refinement from a type guard. */
export function refinement<A, B extends A>(f: (value: A) => value is B): Refinement<A, B> {
  return { test: f };
}

// ─── Combinators ─────────────────────────────────────────────────────────────

/** Logical AND of two predicates. */
export function and<A>(p1: Predicate<A>, p2: Predicate<A>): Predicate<A> {
  return { test: (value) => p1.test(value) && p2.test(value) };
}

/** Logical OR of two predicates. */
export function or<A>(p1: Predicate<A>, p2: Predicate<A>): Predicate<A> {
  return { test: (value) => p1.test(value) || p2.test(value) };
}

/** Logical NOT of a predicate. */
export function not<A>(p: Predicate<A>): Predicate<A> {
  return { test: (value) => !p.test(value) };
}

/** Combines multiple predicates with AND. */
export function all<A>(...predicates: ReadonlyArray<Predicate<A>>): Predicate<A> {
  return { test: (value) => predicates.every((p) => p.test(value)) };
}

/** Combines multiple predicates with OR. */
export function any<A>(...predicates: ReadonlyArray<Predicate<A>>): Predicate<A> {
  return { test: (value) => predicates.some((p) => p.test(value)) };
}

// ─── Refinement combinators ──────────────────────────────────────────────────

/** AND of two refinements (narrows to intersection). */
export function andRefinement<A, B extends A, C extends A>(
  r1: Refinement<A, B>,
  r2: Refinement<A, C>,
): Refinement<A, B & C> {
  return { test: (value): value is B & C => r1.test(value) && r2.test(value) };
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Converts a Predicate to a Rule-compatible function. */
export function toRule<A>(p: Predicate<A>, error: unknown): (value: A) => unknown {
  return (value) => (p.test(value) ? undefined : error);
}

// ─── Namespace ───────────────────────────────────────────────────────────────

export const Predicate = {
  from,
  refinement,
  and,
  or,
  not,
  all,
  any,
  andRefinement,
  toRule,
} as const;
