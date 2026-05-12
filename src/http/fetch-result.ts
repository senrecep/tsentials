import { Err } from '../errors/app-error.js';
import type { Result } from '../result/result.js';
import { Result as R } from '../result/result.js';
import { extractErrorDescription, httpStatusToError } from './status-mapper.js';

/**
 * Converts a fetch Response to a Result<T>.
 * Shared internal helper for all HTTP methods.
 */
async function responseToResult<T>(response: Response): Promise<Result<T>> {
  if (!response.ok) {
    const description = await extractErrorDescription(response);
    return R.failure(httpStatusToError(response.status, description));
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (
    !contentType.includes('application/json') &&
    !contentType.includes('application/problem+json')
  ) {
    // No body (e.g. 204 No Content) or non-JSON — treat as void success
    return R.success(undefined as unknown as T);
  }

  return R.tryAsync(() => response.json() as Promise<T>);
}

/**
 * fetch()-based HTTP client that returns Result<T> instead of throwing.
 *
 * All methods catch both network errors (TypeError) and HTTP error responses.
 *
 * @example
 * const result = await fetchResult.get<User>('/api/users/42');
 * if (result.ok) console.log(result.value.name);
 * else console.error(result.errors[0].description);
 */
export const fetchResult = {
  /**
   * GET — returns Result<T> with deserialized JSON body on success.
   */
  async get<T>(url: string | URL, init?: RequestInit): Promise<Result<T>> {
    return R.tryAsync(
      async () => {
        const response = await fetch(url, { ...init, method: 'GET' });
        return responseToResult<T>(response);
      },
      (e) => Err.fromException(e),
    ).then((r) => (r.ok ? r.value : r)) as Promise<Result<T>>;
  },

  /**
   * POST with JSON body — returns Result<T>.
   */
  async post<T>(url: string | URL, body: unknown, init?: RequestInit): Promise<Result<T>> {
    return R.tryAsync(
      async () => {
        const response = await fetch(url, {
          ...init,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...init?.headers,
          },
          body: JSON.stringify(body),
        });
        return responseToResult<T>(response);
      },
      (e) => Err.fromException(e),
    ).then((r) => (r.ok ? r.value : r)) as Promise<Result<T>>;
  },

  /**
   * PUT with JSON body — returns Result<T>.
   */
  async put<T>(url: string | URL, body: unknown, init?: RequestInit): Promise<Result<T>> {
    return R.tryAsync(
      async () => {
        const response = await fetch(url, {
          ...init,
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...init?.headers,
          },
          body: JSON.stringify(body),
        });
        return responseToResult<T>(response);
      },
      (e) => Err.fromException(e),
    ).then((r) => (r.ok ? r.value : r)) as Promise<Result<T>>;
  },

  /**
   * PATCH with JSON body — returns Result<T>.
   */
  async patch<T>(url: string | URL, body: unknown, init?: RequestInit): Promise<Result<T>> {
    return R.tryAsync(
      async () => {
        const response = await fetch(url, {
          ...init,
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...init?.headers,
          },
          body: JSON.stringify(body),
        });
        return responseToResult<T>(response);
      },
      (e) => Err.fromException(e),
    ).then((r) => (r.ok ? r.value : r)) as Promise<Result<T>>;
  },

  /**
   * DELETE — returns Result<void>.
   */
  async delete(url: string | URL, init?: RequestInit): Promise<Result<void>> {
    return R.tryAsync(
      async () => {
        const response = await fetch(url, { ...init, method: 'DELETE' });
        if (!response.ok) {
          const description = await extractErrorDescription(response);
          throw { __resultError: httpStatusToError(response.status, description) };
        }
      },
      (e) => {
        if (e !== null && typeof e === 'object' && '__resultError' in e) {
          return (e as { __resultError: ReturnType<typeof httpStatusToError> }).__resultError;
        }
        return Err.fromException(e);
      },
    );
  },
} as const;
