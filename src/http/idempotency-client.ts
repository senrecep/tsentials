import type { AppError } from '../errors/app-error.js';
import { ErrorType } from '../errors/error-type.js';
import { IDEMPOTENCY_KEY_HEADER, IdempotencyErrorCodes } from '../idempotency/constants.js';
import { isValidIdempotencyKey } from '../idempotency/keys.js';
import { HttpErrorMetadataKeys } from './response-metadata.js';

/** Options for the client-side idempotency key helpers. */
export interface IdempotencyKeyOptions {
  /**
   * Creates the key when none is given. Defaults to `crypto.randomUUID()`. It is called at most
   * once per `withIdempotencyKey` / `idempotencyKey` call, and its result is validated like an
   * explicit key.
   */
  readonly idempotencyKeyGenerator?: (() => string) | undefined;
}

/** @internal Checks a key given by the caller, or generates one (a random UUID by default). */
export function idempotencyKeyOrNew(
  key: string | undefined,
  options?: IdempotencyKeyOptions,
): string {
  const value =
    key ?? (options?.idempotencyKeyGenerator ?? (() => globalThis.crypto.randomUUID()))();
  if (!isValidIdempotencyKey(value)) {
    throw new TypeError('idempotency key must be 1-255 printable ASCII characters without " or \\');
  }
  return value;
}

/**
 * Returns a copy of `init` with an `Idempotency-Key` header (replacing any earlier one). The key
 * defaults to a random UUID, or to what `options.idempotencyKeyGenerator` returns. Reuse the
 * returned init for every retry of the same logical operation; a new operation needs a new key.
 *
 * ```ts
 * const init = withIdempotencyKey({ method: 'POST', body });
 * await policy.execute((signal) => fetchResult.send(url, { ...init, signal }));
 * ```
 *
 * @throws TypeError when the key, given or generated, is not a valid idempotency key.
 */
export function withIdempotencyKey<I extends RequestInit>(
  init: I,
  key?: string,
  options?: IdempotencyKeyOptions,
): I {
  const headers = new Headers(init.headers);
  headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKeyOrNew(key, options));
  return { ...init, headers };
}

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 503, 504]);

/**
 * Retry classifier for an HTTP call, for `shouldRetry` of `withRetry` or `retryIfFailed`:
 *
 * 1. POST or PATCH without an idempotency key → never retried (the server may have run it).
 * 2. A replayed response (`Idempotency-Replayed: true`) → not retried, it will not change.
 * 3. No response (network error, timeout: no `httpStatus` metadata, type Unexpected) → retried.
 *    A response whose body cannot be read, parsed or finished before the timeout carries
 *    `httpStatus`, so rules 4 to 7 apply to it.
 * 4. 409 `Idempotency.InFlight` → retried (after `Retry-After`).
 * 5. 409 `Idempotency.ResultUnavailable`, or any other 409 → not retried.
 * 6. 408, 429, 503, 504 → retried.
 * 7. Anything else, 500 and 502 included → not retried.
 *
 * ```ts
 * const init = withIdempotencyKey({ method: 'POST', body });
 * ResiliencePolicy.create()
 *   .withRetry({ shouldRetry: idempotentRetryClassifier('POST', true) })
 *   .execute((signal) => fetchResult.send(url, { ...init, signal }));
 * ```
 */
export function idempotentRetryClassifier(
  method: string,
  hasIdempotencyKey: boolean,
): (error: AppError) => boolean {
  const upper = method.toUpperCase();
  const unsafe = (upper === 'POST' || upper === 'PATCH') && !hasIdempotencyKey;
  return (error) => {
    if (unsafe) return false;
    const metadata = error.metadata;
    if (metadata?.get(HttpErrorMetadataKeys.IdempotencyReplayed) === true) return false;
    const status = metadata?.get(HttpErrorMetadataKeys.HttpStatus);
    if (typeof status !== 'number') return error.type === ErrorType.Unexpected;
    if (status === 409) {
      return (
        metadata?.get(HttpErrorMetadataKeys.ProblemCode) === IdempotencyErrorCodes.InFlight ||
        error.code === IdempotencyErrorCodes.InFlight
      );
    }
    return RETRYABLE_STATUSES.has(status);
  };
}
