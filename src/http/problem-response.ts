import type { AppError } from '../errors/app-error.js';
import { errorTypeToHttpStatus } from '../errors/app-error.js';
import { ErrorType } from '../errors/error-type.js';
import type { Result } from '../result/result.js';

/** Options of {@link toProblemDetails}. */
export interface ProblemDetailsOptions {
  /** Replaces the status of the primary error. */
  readonly status?: number | undefined;
  /**
   * Replaces the title. Default: the title of the primary error's type, or none when `status`
   * differs from that type's status.
   */
  readonly title?: string | undefined;
  /** Maps the status to `type`; return `undefined` to leave it out. Default: {@link rfc9110TypeUri}. */
  readonly typeUri?: ((status: number) => string | undefined) | undefined;
  /** Extra members, written after `detail` and before `errorCodes` and `errors`. */
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
}

/** Options of {@link toProblemResponse} and {@link resultToResponse}. */
export interface ProblemResponseOptions extends ProblemDetailsOptions {
  /** Headers added to the problem response. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

/** A problem body (RFC 9457) as CSharpEssentials.AspNetCore writes it. */
export interface ProblemDetails {
  readonly type?: string;
  readonly title?: string;
  readonly status: number;
  readonly detail: string;
  /** Codes of every error, distinct, in order. */
  readonly errorCodes: readonly string[];
  /** The `Validation` errors; left out when there are none. */
  readonly errors?: readonly { readonly code: string; readonly description: string }[];
  readonly [extension: string]: unknown;
}

const titles: Readonly<Record<ErrorType, string>> = {
  [ErrorType.Failure]: 'Server Failure',
  [ErrorType.Unexpected]: 'Unexpected Error',
  [ErrorType.Validation]: 'Validation Error',
  [ErrorType.Conflict]: 'Conflict',
  [ErrorType.NotFound]: 'Not Found',
  [ErrorType.Unauthorized]: 'Unauthorized',
  [ErrorType.Forbidden]: 'Forbidden',
  [ErrorType.Unknown]: 'Unknown Error',
};

/**
 * The RFC 9110 section link of a client or server error status, as ASP.NET Core writes it;
 * `undefined` for a status without a section (418 included).
 */
export function rfc9110TypeUri(status: number): string | undefined {
  let section: string | undefined;
  if (status >= 400 && status <= 417) section = `15.5.${status - 399}`;
  else if (status === 421 || status === 422) section = `15.5.${status - 401}`;
  else if (status === 426) section = '15.5.22';
  else if (status >= 500 && status <= 505) section = `15.6.${status - 499}`;
  return section === undefined
    ? undefined
    : `https://tools.ietf.org/html/rfc9110#section-${section}`;
}

/**
 * Builds a problem body (RFC 9457) from errors, as CSharpEssentials.AspNetCore does. The primary
 * error is the one with the highest status ({@link errorTypeToHttpStatus}; the first wins a tie):
 * it gives `status`, `title` and `detail`. `errorCodes` lists every code once, in order, and
 * `errors` lists the `Validation` errors as `{ code, description }`. The body reads back with
 * `problemDetailsToErrors`.
 *
 * @throws {TypeError} when `errors` is empty.
 */
export function toProblemDetails(
  errors: readonly AppError[],
  options: ProblemDetailsOptions = {},
): ProblemDetails {
  const [first, ...rest] = errors;
  if (first === undefined) throw new TypeError('toProblemDetails: at least one error is required');
  const primary = rest.reduce(
    (best, e) => (errorTypeToHttpStatus(e.type) > errorTypeToHttpStatus(best.type) ? e : best),
    first,
  );
  const typeStatus = errorTypeToHttpStatus(primary.type);
  const status = options.status ?? typeStatus;
  const title = options.title ?? (status === typeStatus ? titles[primary.type] : undefined);
  const type = (options.typeUri ?? rfc9110TypeUri)(status);
  const validation = errors
    .filter((e) => e.type === ErrorType.Validation)
    .map(({ code, description }) => ({ code, description }));
  return {
    ...(type === undefined ? {} : { type }),
    ...(title === undefined ? {} : { title }),
    status,
    detail: primary.description,
    ...options.extensions,
    errorCodes: [...new Set(errors.map((e) => e.code))],
    ...(validation.length === 0 ? {} : { errors: validation }),
  };
}

/** {@link toProblemDetails} as a `Response` with `content-type: application/problem+json`. */
export function toProblemResponse(
  errors: readonly AppError[],
  options: ProblemResponseOptions = {},
): Response {
  const body = toProblemDetails(errors, options);
  return new Response(JSON.stringify(body), {
    status: body.status,
    headers: { 'content-type': 'application/problem+json', ...options.headers },
  });
}

/**
 * A success becomes 200 with the value as JSON, or 204 when the value is `undefined`
 * (`Result.ok()`); a failure becomes {@link toProblemResponse}.
 */
export function resultToResponse<T>(
  result: Result<T>,
  options: ProblemResponseOptions = {},
): Response {
  if (!result.ok) return toProblemResponse(result.errors, options);
  return result.value === undefined
    ? new Response(null, { status: 204 })
    : Response.json(result.value);
}
