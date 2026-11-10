import type { AppError } from './app-error.js';

/**
 * An `Error` that carries one or more AppError values, for code that has to throw
 * (a constructor, a callback, a deep call chain) but wants to keep its typed errors.
 * `Result.try`, `Result.tryAsync`, `Result.tryCatch`, `Result.tryCatchAsync` and the
 * mediator's `exceptionHandlingBehavior` turn it back into a failure with these errors as-is.
 *
 * The message defaults to the first error's description.
 *
 * @example
 * throw new DomainError(Err.conflict('Order.Shipped', 'Order is already shipped'));
 * Result.try(() => order.cancel()); // failure with Order.Shipped
 */
export class DomainError extends Error {
  /** The carried errors, in order. */
  readonly errors: readonly AppError[];

  constructor(errors: AppError | readonly AppError[], message?: string) {
    const list: readonly AppError[] = Array.isArray(errors)
      ? Object.freeze([...errors])
      : Object.freeze([errors as AppError]);
    super(message ?? list[0]?.description ?? 'A domain error has occurred.');
    this.name = 'DomainError';
    this.errors = list;
  }

  /** The first carried error, or `undefined` when none were given. */
  get error(): AppError | undefined {
    return this.errors[0];
  }
}
