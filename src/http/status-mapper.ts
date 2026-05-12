import { Err } from '../errors/app-error.js';
import type { AppError } from '../errors/app-error.js';

/**
 * Maps HTTP status codes to AppError instances.
 * Adapted from CSharpEssentials.Http.HttpStatusCodeMapper.
 *
 * @example
 * const error = httpStatusToError(404, 'User not found');
 * // AppError { code: 'Http.404', description: 'User not found', type: 'NotFound' }
 */
export function httpStatusToError(status: number, description?: string): AppError {
  const code = `Http.${status}`;
  const msg = description ?? `HTTP request failed with status ${status}.`;

  if (status === 400) return Err.validation(code, msg);
  if (status === 401) return Err.unauthorized(code, msg);
  if (status === 403) return Err.forbidden(code, msg);
  if (status === 404) return Err.notFound(code, msg);
  if (status === 409) return Err.conflict(code, msg);
  if (status === 410) return Err.notFound(code, msg);
  if (status === 422) return Err.validation(code, msg);
  if (status === 429) return Err.conflict(code, msg);
  if (status >= 500) return Err.unexpected(code, msg);

  return Err.failure(code, msg);
}

/**
 * Reads a ProblemDetails (RFC 9457) response body from a failed response.
 * Returns the error description from the ProblemDetails if available.
 */
export async function extractErrorDescription(
  response: Response,
): Promise<string | undefined> {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/problem+json') && !contentType.includes('application/json')) {
      return undefined;
    }
    const body = await response.json() as Record<string, unknown>;
    if (typeof body['detail'] === 'string') return body['detail'];
    if (typeof body['title'] === 'string') return body['title'];
    return undefined;
  } catch {
    return undefined;
  }
}
