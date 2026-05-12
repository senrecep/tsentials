import type { Maybe } from '../maybe/maybe.js';
import type { AppError } from '../errors/app-error.js';
import { Result } from './result.js';

/**
 * Converts a Maybe<T> to a Result<T>.
 *
 * @example
 * const result = maybeToResult(Maybe.from(user), Err.notFound('User.NotFound', '...'));
 */
export function maybeToResult<T>(maybe: Maybe<T>, noneError: AppError): Result<T> {
  return maybe.hasValue
    ? Result.success(maybe.value)
    : Result.failure(noneError);
}

/**
 * Converts a Result<T> to a Maybe<T>.
 * Failure becomes None; success becomes Some.
 *
 * @example
 * const maybe = resultToMaybe(Result.success(42));
 * // Maybe.some(42)
 */
export function resultToMaybe<T>(result: Result<T>): Maybe<T> {
  if (result.ok) {
    return { hasValue: true, value: result.value };
  }
  return { hasValue: false };
}
