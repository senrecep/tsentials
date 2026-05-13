/**
 * These<E, A> — a value that can be a success, a failure, or both.
 *
 * Unlike Result<T> (which is either success or failure) or Either<E, A>
 * (which is left or right), These allows for "partial success": a value
 * together with one or more warnings/errors.
 *
 * Ideal for validation, parsing, and batch operations where you want
 * to collect as much information as possible.
 *
 * @example
 * import { These, Result } from 'tsentials/these';
 *
 * const parseAge = (raw: string): These<AppError, number> => {
 *   const age = Number(raw);
 *   if (Number.isNaN(age)) return These.left(Err.validation('Age.NaN', 'Not a number'));
 *   if (age < 0) return These.both(Err.validation('Age.Negative', 'Negative age'), 0);
 *   return These.right(age);
 * };
 */

import type { AppError } from '../errors/app-error.js';
import { Result } from '../result/result.js';

/**
 * Represents a value that can be:
 * - Left: only errors
 * - Right: only a value
 * - Both: a value AND errors (partial success)
 */
export type These<E, A> =
  | { readonly _tag: 'Left'; readonly left: E }
  | { readonly _tag: 'Right'; readonly right: A }
  | { readonly _tag: 'Both'; readonly left: E; readonly right: A };

// ─── Constructors ────────────────────────────────────────────────────────────

/** Creates a Left (failure only). */
export function left<E, A = never>(error: E): These<E, A> {
  return { _tag: 'Left', left: error };
}

/** Creates a Right (success only). */
export function right<E = never, A = never>(value: A): These<E, A> {
  return { _tag: 'Right', right: value };
}

/** Creates a Both (value with errors/warnings). */
export function both<E, A>(error: E, value: A): These<E, A> {
  return { _tag: 'Both', left: error, right: value };
}

// ─── Type guards ─────────────────────────────────────────────────────────────

/** Checks if the These is a Left. */
export function isLeft<E, A>(these: These<E, A>): boolean {
  return these._tag === 'Left';
}

/** Checks if the These is a Right. */
export function isRight<E, A>(these: These<E, A>): boolean {
  return these._tag === 'Right';
}

/** Checks if the These is a Both. */
export function isBoth<E, A>(these: These<E, A>): boolean {
  return these._tag === 'Both';
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Maps over the success value.
 */
export function map<E, A, B>(these: These<E, A>, f: (value: A) => B): These<E, B> {
  switch (these._tag) {
    case 'Left':
      return these;
    case 'Both':
      return both(these.left, f(these.right));
    case 'Right':
      return right(f(these.right));
  }
}

/**
 * Maps over the error value.
 */
export function mapLeft<E, A, F>(these: These<E, A>, f: (error: E) => F): These<F, A> {
  switch (these._tag) {
    case 'Right':
      return these;
    case 'Left':
      return left(f(these.left));
    case 'Both':
      return both(f(these.left), these.right);
  }
}

/**
 * Chains a These-returning function (monadic bind).
 */
export function flatMap<E, A, B>(these: These<E, A>, f: (value: A) => These<E, B>): These<E, B> {
  switch (these._tag) {
    case 'Left':
      return these;
    case 'Both': {
      const next = f(these.right);
      switch (next._tag) {
        case 'Left':
          return both(these.left, next.left as unknown as B);
        case 'Both':
          return both(these.left, next.right);
        case 'Right':
          return both(these.left, next.right);
      }
      break;
    }
    case 'Right':
      return f(these.right);
  }
}

/**
 * Runs a side effect on the success value.
 */
export function tap<E, A>(these: These<E, A>, f: (value: A) => void): These<E, A> {
  if (these._tag !== 'Left') f(these.right);
  return these;
}

/**
 * Runs a side effect on the error value.
 */
export function tapLeft<E, A>(these: These<E, A>, f: (error: E) => void): These<E, A> {
  if (these._tag !== 'Right') f(these.left);
  return these;
}

// ─── Extraction ──────────────────────────────────────────────────────────────

/**
 * Pattern match with exhaustive handlers.
 */
export function match<E, A, B>(
  these: These<E, A>,
  onLeft: (error: E) => B,
  onRight: (value: A) => B,
  onBoth: (error: E, value: A) => B,
): B {
  switch (these._tag) {
    case 'Left':
      return onLeft(these.left);
    case 'Right':
      return onRight(these.right);
    case 'Both':
      return onBoth(these.left, these.right);
  }
}

/**
 * Gets the success value, or undefined if Left.
 */
export function getRight<E, A>(these: These<E, A>): A | undefined {
  return these._tag !== 'Left' ? these.right : undefined;
}

/**
 * Gets the error value, or undefined if Right.
 */
export function getLeft<E, A>(these: These<E, A>): E | undefined {
  return these._tag !== 'Right' ? these.left : undefined;
}

// ─── Conversions ─────────────────────────────────────────────────────────────

/**
 * Converts a These<AppError[], T> to a Result<T>.
 * - Right → success
 * - Left → failure
 * - Both → failure (errors take priority)
 */
export function toResult<A>(these: These<readonly AppError[], A>): Result<A> {
  switch (these._tag) {
    case 'Right':
      return Result.success(these.right);
    case 'Both':
      return Result.failureFrom(these.left);
    case 'Left':
      return Result.failureFrom(these.left);
  }
}

/**
 * Converts a These<AppError[], T> to a Result<T> preserving partial success.
 * - Right → success
 * - Left → failure
 * - Both → success (value is kept, but errors are discarded — use with care)
 */
export function toResultLenient<A>(these: These<readonly AppError[], A>): Result<A> {
  switch (these._tag) {
    case 'Right':
      return Result.success(these.right);
    case 'Both':
      return Result.success(these.right);
    case 'Left':
      return Result.failureFrom(these.left);
  }
}

/**
 * Converts a Result<T> to a These<readonly AppError[], T>.
 */
export function fromResult<A>(result: Result<A>): These<readonly AppError[], A> {
  if (result.ok) return right(result.value);
  return left(result.errors);
}

// ─── Collection utilities ────────────────────────────────────────────────────

/**
 * Partitions an array of These into successes, failures, and partials.
 */
export function partition<E, A>(
  theses: ReadonlyArray<These<E, A>>,
): {
  lefts: Array<E>;
  rights: Array<A>;
  boths: Array<{ error: E; value: A }>;
} {
  const lefts: Array<E> = [];
  const rights: Array<A> = [];
  const boths: Array<{ error: E; value: A }> = [];

  for (const t of theses) {
    switch (t._tag) {
      case 'Left':
        lefts.push(t.left);
        break;
      case 'Right':
        rights.push(t.right);
        break;
      case 'Both':
        boths.push({ error: t.left, value: t.right });
        break;
    }
  }

  return { lefts, rights, boths };
}

// ─── Namespace ───────────────────────────────────────────────────────────────

export const These = {
  left,
  right,
  both,
  isLeft,
  isRight,
  isBoth,
  map,
  mapLeft,
  flatMap,
  tap,
  tapLeft,
  match,
  getRight,
  getLeft,
  toResult,
  toResultLenient,
  fromResult,
  partition,
} as const;
