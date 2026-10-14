import type { AbortOptions } from '../result/abort.js';
import type { Result } from '../result/result.js';

/** Anything that validates a `T` synchronously (e.g. a {@link Validator} subclass). */
export interface SyncValidator<T> {
  validate(instance: T): Result<T>;
}

/**
 * Anything that validates a `T` asynchronously.
 * Every {@link Validator} subclass implements it.
 */
export interface AsyncValidator<T> {
  validateAsync(instance: T, options?: AbortOptions): Promise<Result<T>>;
}
