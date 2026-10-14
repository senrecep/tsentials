import type { AppError } from '../errors/app-error.js';
import { Err } from '../errors/app-error.js';
import type { ErrorMetadata } from '../errors/error-metadata.js';
import type { ErrorType } from '../errors/error-type.js';

/**
 * Mutable state shared by a root {@link RuleContext} and every chain / child context
 * created from it during one validation run. Not part of the public API.
 *
 * - `errors`  — every recorded error, in the order rules ran.
 * - `pending` — async rules that have started but not finished. A non-zero value when the
 *               configure step returns means an async rule was not awaited.
 * - `inflight` — promises of the async rules started in this run.
 * - `signal`  — the caller's abort signal for this run, if any.
 */
export interface ContextState {
  readonly errors: AppError[];
  pending: number;
  /** Every async rule promise started in this run (observed when one is left un-awaited). */
  readonly inflight: PromiseLike<unknown>[];
  readonly signal: AbortSignal | undefined;
}

export function createContextState(signal: AbortSignal | undefined): ContextState {
  return { errors: [], pending: 0, inflight: [], signal };
}

/**
 * Runs an async rule, counting it in `state.pending` while it runs and recording its
 * promise in `state.inflight`, so a run that ends with an un-awaited rule can mark those
 * promises handled before throwing (their later rejection would otherwise be unhandled).
 */
export function trackPending<R>(state: ContextState, work: () => Promise<R>): Promise<R> {
  state.pending++;
  const promise = (async () => {
    try {
      return await work();
    } finally {
      state.pending--;
    }
  })();
  state.inflight.push(promise);
  return promise;
}

/** A custom message (string) or a complete replacement error (AppError, used verbatim). */
export type ValidationMessage = string | AppError;

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Values the comparable validators accept. Dates compare by timestamp. */
export type Comparable = number | bigint | string | Date;

const numeric = (value: Comparable): number | bigint | string =>
  value instanceof Date ? value.getTime() : value;

const isNaNValue = (value: number | bigint | string): boolean =>
  typeof value === 'number' && Number.isNaN(value);

/**
 * Three-way comparison: NaN sorts before every number
 * and equals itself.
 */
export function compare(a: Comparable, b: Comparable): number {
  const x = numeric(a);
  const y = numeric(b);
  const xNaN = isNaNValue(x);
  const yNaN = isNaNValue(y);
  if (xNaN || yNaN) return xNaN && yNaN ? 0 : xNaN ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Equality used by `equal` / `notEqual`: Dates by timestamp, NaN equals NaN. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return compare(a, b) === 0;
  return Object.is(a, b) || a === b;
}

/** Renders a threshold / expected value inside a default message. */
export function display(value: unknown): string {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  return String(value);
}

/** Number of items in a string / array / Set / Map / iterable. */
export function countOf(value: Iterable<unknown>): number {
  if (typeof value === 'string' || Array.isArray(value)) return value.length;
  if (value instanceof Set || value instanceof Map) return value.size;
  let count = 0;
  for (const _ of value) count++;
  return count;
}

/** True when the iterable yields nothing (stops after the first item). */
export function isEmptyIterable(value: Iterable<unknown>): boolean {
  if (typeof value === 'string' || Array.isArray(value)) return value.length === 0;
  if (value instanceof Set || value instanceof Map) return value.size === 0;
  for (const _ of value) return false;
  return true;
}

export function assertNonNegative(name: 'min' | 'max', value: number): void {
  if (value < 0) throw new RangeError(`${name} (${value}) must not be negative.`);
}

type ErrorFactory = (code: string, description: string, metadata?: ErrorMetadata) => AppError;

const factories: Readonly<Record<ErrorType, ErrorFactory>> = {
  Failure: Err.failure,
  Unexpected: Err.unexpected,
  Validation: Err.validation,
  Conflict: Err.conflict,
  NotFound: Err.notFound,
  Unauthorized: Err.unauthorized,
  Forbidden: Err.forbidden,
  Unknown: Err.unknown,
};

/**
 * Re-creates `error` under a parent property path:
 * the code gets `prefix`, the quoted property name inside the description is qualified,
 * and type + metadata are preserved.
 */
export function prefixError(error: AppError, prefix: string): AppError {
  const factory = factories[error.type] ?? Err.validation;
  return factory(prefix + error.code, prefixDescription(error, prefix), error.metadata);
}

/**
 * A nested error code looks like "city.NotEmpty" — the part before the rule suffix is the
 * property name the nested validator quoted in its description ("'city' must not be empty.").
 * Prefix exactly that quoted occurrence so the message matches the fully-qualified code.
 * Messages that do not quote the property name (custom messages) are left untouched.
 */
function prefixDescription(error: AppError, prefix: string): string {
  const description = error.description;
  const lastDot = error.code.lastIndexOf('.');
  if (lastDot <= 0) return description;
  const quoted = `'${error.code.slice(0, lastDot)}'`;
  const idx = description.indexOf(quoted);
  if (idx < 0) return description;
  return description.slice(0, idx + 1) + prefix + description.slice(idx + 1);
}
