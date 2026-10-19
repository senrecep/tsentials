import { Err } from '../errors/app-error.js';
import { ErrorType } from '../errors/error-type.js';
import type { Result } from '../result/result.js';
import { Result as R } from '../result/result.js';
import { withResponseMetadata } from './response-metadata.js';
import { problemDetailsToErrors } from './status-mapper.js';

/**
 * RequestInit accepted by {@link fetchResult}, plus a request timeout.
 */
export type FetchResultInit = RequestInit & {
  /**
   * Timeout in milliseconds covering the whole request, including reading the body.
   * Defaults to 30000 (30 s). `0` or `Infinity` disables the timeout.
   * When it elapses the result is a failure with code `Http.Timeout` (type Unexpected).
   * A negative, NaN or too-large (> 2^31-1) value rejects with a RangeError (programmer error).
   */
  timeout?: number;
};

/** Default request timeout in milliseconds (30 seconds). */
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const HTTP_TIMEOUT_CODE = 'Http.Timeout';

const MAX_TIMEOUT_MS = 2_147_483_647; // setTimeout upper bound

/** NotFound description for an empty / `null` JSON body. */
const EMPTY_BODY_DESCRIPTION = 'Response body was empty or could not be deserialized.';

const isJsonContentType = (contentType: string): boolean =>
  contentType.includes('application/json') || contentType.includes('application/problem+json');

const isAbortError = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  ((e as { name?: unknown }).name === 'AbortError' ||
    (e as { name?: unknown }).name === 'TimeoutError');

/**
 * Converts a fetch Response to a Result<T>. A body that cannot be read or parsed is a failure;
 * an abort while reading (caller or timeout) propagates to `execute`.
 * With `allowEmptyBody`, an empty / `null` JSON body is a void success instead of NotFound.
 */
async function responseToResult<T>(
  response: Response,
  signal: AbortSignal,
  allowEmptyBody: boolean,
): Promise<Result<T>> {
  const isJson = isJsonContentType(response.headers.get('content-type') ?? '');

  if (!response.ok) {
    let body: unknown;
    if (isJson) {
      try {
        body = await response.json();
      } catch (e) {
        if (signal.aborted) throw e;
        body = undefined; // unreadable error body, fall back to the status error
      }
    }
    return R.failureFrom(
      withResponseMetadata(problemDetailsToErrors(response.status, body), response, body),
    );
  }

  // 204 No Content / 205 Reset Content never carry a body, and a non-JSON body is not
  // deserialized: both are void-style successes.
  if (response.status === 204 || response.status === 205 || !isJson) {
    return R.success(undefined as unknown as T);
  }

  // The server declared JSON, so a value is expected: an empty body or a literal `null`
  // is a NotFound failure (unless `allowEmptyBody`). A body that cannot be read or parsed is
  // an Unexpected failure that carries the response metadata: the server answered, so a
  // retry classifier must not treat it as a missing response.
  let value: unknown;
  try {
    const text = await response.text();
    value = text.trim() === '' ? null : JSON.parse(text);
  } catch (e) {
    if (signal.aborted) throw e;
    return R.failureFrom(
      withResponseMetadata([Err.fromException(e, ErrorType.Unexpected)], response, undefined),
    );
  }
  if (value === null) {
    return allowEmptyBody
      ? R.success(undefined as unknown as T)
      : R.failure(Err.notFound(undefined, EMPTY_BODY_DESCRIPTION));
  }
  return R.success(value as T);
}

/**
 * Runs a fetch with these cancellation rules:
 * - caller `signal` aborted → the returned promise rejects with the abort reason (not a Result);
 * - timeout elapsed → failure `Http.Timeout` (Unexpected);
 * - any other error (network, body parse, abort from another source) → Unexpected failure
 *   whose code is the thrown value's constructor name.
 *
 * `build` runs inside the guarded block so header/serialization errors become failures too.
 */
async function execute<T>(
  url: string | URL,
  init: FetchResultInit | undefined,
  build: () => RequestInit,
  allowEmptyBody = false,
): Promise<Result<T>> {
  const { timeout = DEFAULT_HTTP_TIMEOUT_MS, signal: callerSignal, ...rest } = init ?? {};
  if (
    Number.isNaN(timeout) ||
    timeout < 0 ||
    (Number.isFinite(timeout) && timeout > MAX_TIMEOUT_MS)
  ) {
    throw new RangeError(
      `timeout must be between 0 and ${MAX_TIMEOUT_MS} ms, or Infinity (got ${timeout}).`,
    );
  }
  callerSignal?.throwIfAborted();

  const controller = new AbortController();
  const onCallerAbort = (): void => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

  let timedOut = false;
  const timer =
    timeout > 0 && Number.isFinite(timeout)
      ? setTimeout(() => {
          timedOut = true;
          controller.abort(
            new DOMException(
              `The request was canceled due to the configured timeout of ${timeout} ms elapsing.`,
              'TimeoutError',
            ),
          );
        }, timeout)
      : undefined;

  let response: Response | undefined;
  try {
    response = await fetch(url, { ...rest, ...build(), signal: controller.signal });
    return await responseToResult<T>(response, controller.signal, allowEmptyBody);
  } catch (e) {
    if (callerSignal?.aborted && (e === callerSignal.reason || isAbortError(e))) throw e;
    const error = timedOut
      ? Err.fromException(e, ErrorType.Unexpected, HTTP_TIMEOUT_CODE)
      : Err.fromException(e, ErrorType.Unexpected);
    // A timeout while reading the body still has a response: keep its status so a retry
    // classifier does not mistake it for a missing response.
    return response === undefined
      ? R.failure(error)
      : R.failureFrom(withResponseMetadata([error], response, undefined));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

const jsonInit = (method: string, body: unknown, init: RequestInit | undefined): RequestInit => {
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type')) headers.set('Content-Type', 'application/json');
  return { method, headers, body: JSON.stringify(body) };
};

/**
 * fetch()-based HTTP client that returns Result<T> instead of throwing.
 *
 * - Network errors, body parse errors and HTTP error responses become failures
 *   (status mapping: {@link httpStatusToErrorType}; ProblemDetails `errors` are parsed).
 * - The first error of a failed response carries the metadata `httpStatus`, and when present
 *   `idempotencyReplayed`, `retryAfterMs` and `problemCode` (see `HttpErrorMetadataKeys`).
 * - 2xx bodies: 204/205 and non-JSON content types are void successes (`undefined`); a JSON
 *   content type with an empty body or a literal `null` is a NotFound failure
 *   (code `NotFound`, "Response body was empty or could not be deserialized."), except for
 *   {@link fetchResult.delete}, where it is a void success.
 * - Default timeout 30 s (`init.timeout`), failure code `Http.Timeout`.
 * - Aborting the caller's `init.signal` rejects the promise with the abort reason
 *   (cancellation is not converted to an error Result).
 *
 * @example
 * const result = await fetchResult.get<User>('/api/users/42', { signal, timeout: 5_000 });
 * if (result.ok) console.log(result.value.name);
 * else console.error(result.errors[0].description);
 */
export const fetchResult = {
  /**
   * GET: returns Result<T> with deserialized JSON body on success.
   */
  async get<T>(url: string | URL, init?: FetchResultInit): Promise<Result<T>> {
    return execute<T>(url, init, () => ({ method: 'GET' }));
  },

  /**
   * POST with JSON body: returns Result<T>. Headers may be any HeadersInit
   * (record, `Headers` instance or tuple array); `Content-Type: application/json`
   * is added unless already present.
   */
  async post<T>(url: string | URL, body: unknown, init?: FetchResultInit): Promise<Result<T>> {
    return execute<T>(url, init, () => jsonInit('POST', body, init));
  },

  /**
   * PUT with JSON body: returns Result<T>. See {@link fetchResult.post} for header handling.
   */
  async put<T>(url: string | URL, body: unknown, init?: FetchResultInit): Promise<Result<T>> {
    return execute<T>(url, init, () => jsonInit('PUT', body, init));
  },

  /**
   * PATCH with JSON body: returns Result<T>. See {@link fetchResult.post} for header handling.
   */
  async patch<T>(url: string | URL, body: unknown, init?: FetchResultInit): Promise<Result<T>> {
    return execute<T>(url, init, () => jsonInit('PATCH', body, init));
  },

  /**
   * DELETE: returns Result<T>. Any 2xx is a success: an empty or `null` JSON body gives
   * `undefined` (not NotFound), while a non-empty JSON body is parsed and returned, for APIs
   * that answer DELETE with a body. Malformed JSON is still a failure.
   */
  async delete<T = void>(url: string | URL, init?: FetchResultInit): Promise<Result<T>> {
    return execute<T>(url, init, () => ({ method: 'DELETE' }), true);
  },

  /**
   * Sends `init` as-is (including any body already set on it), returns Result<T>.
   * Use for non-JSON payloads; for JSON bodies prefer post/put/patch, which serialize
   * the body for you.
   */
  async send<T>(url: string | URL, init: FetchResultInit): Promise<Result<T>> {
    return execute<T>(url, init, () => ({}));
  },
} as const;
