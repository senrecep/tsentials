import type { AppError } from '../errors/app-error.js';
import { ErrorMetadata } from '../errors/error-metadata.js';
import { IDEMPOTENCY_REPLAYED_HEADER } from '../idempotency/constants.js';
import { createError } from './status-mapper.js';

/** Metadata keys that {@link fetchResult} adds to the first error of a failed response. */
export const HttpErrorMetadataKeys = {
  /** The response status code (number). Always present on a failed response. */
  HttpStatus: 'httpStatus',
  /** `true` when the response carried `Idempotency-Replayed: true`. */
  IdempotencyReplayed: 'idempotencyReplayed',
  /** The `Retry-After` header in milliseconds (delta-seconds or HTTP-date). */
  RetryAfterMs: 'retryAfterMs',
  /** The top-level `code` field of a problem details body. */
  ProblemCode: 'problemCode',
} as const;

/**
 * Parses a `Retry-After` value: delta-seconds or an HTTP-date. Returns milliseconds (a date in
 * the past gives 0), or `undefined` when the value is neither.
 */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  // Every HTTP-date format starts with the day name; `Date.parse` alone would read '-1' as a year.
  if (!/^[A-Za-z]{3,9},?\s/.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * @internal Adds the response metadata to the first error. Metadata the problem body already
 * gave the error wins on a key collision.
 */
export function withResponseMetadata(
  errors: readonly AppError[],
  response: Response,
  body: unknown,
): AppError[] {
  const extra = new Map<string, unknown>([[HttpErrorMetadataKeys.HttpStatus, response.status]]);
  if (response.headers.get(IDEMPOTENCY_REPLAYED_HEADER)?.trim().toLowerCase() === 'true') {
    extra.set(HttpErrorMetadataKeys.IdempotencyReplayed, true);
  }
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
  if (retryAfterMs !== undefined) extra.set(HttpErrorMetadataKeys.RetryAfterMs, retryAfterMs);
  const code =
    typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
  if (typeof code === 'string') extra.set(HttpErrorMetadataKeys.ProblemCode, code);
  return errors.map((error, index) =>
    index === 0
      ? createError(
          error.type,
          error.code,
          error.description,
          ErrorMetadata.combine(error.metadata ?? ErrorMetadata.empty(), extra),
        )
      : error,
  );
}
