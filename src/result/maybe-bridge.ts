import type { AppError } from '../errors/app-error.js';
import { Maybe } from '../maybe/maybe.js';
import type { Result } from './result.js';

/**
 * Converts a Maybe<T> to a Result<T>: Some becomes success, None becomes a failure with
 * `noneError`. Alias of {@link Maybe.toResult}.
 *
 * @example
 * const result = maybeToResult(Maybe.from(user), Err.notFound('User.NotFound', '...'));
 */
export function maybeToResult<T>(maybe: Maybe<T>, noneError: AppError): Result<T> {
  return Maybe.toResult(maybe, noneError);
}

/**
 * Converts a Result<T> to a Maybe<T>.
 * Failure becomes None; success becomes Some, except that a `null`/`undefined` success
 * value (including a void success) becomes None.
 *
 * @example
 * const maybe = resultToMaybe(Result.success(42));
 * // Maybe.some(42)
 */
export function resultToMaybe<T>(result: Result<T>): Maybe<T> {
  if (result.ok) {
    return Maybe.some(result.value);
  }
  return Maybe.none<T>();
}
