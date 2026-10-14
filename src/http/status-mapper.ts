import type { AppError } from '../errors/app-error.js';
import { Err } from '../errors/app-error.js';
import { ErrorMetadata } from '../errors/error-metadata.js';
import { ErrorType } from '../errors/error-type.js';

/**
 * Maps an HTTP status code to an ErrorType.
 *
 * 400/411/413/414/415/416/417/422 → Validation, 401/407 → Unauthorized, 403 → Forbidden,
 * 404/410 → NotFound, 409/412/429 → Conflict, 408 → Unexpected, ≥500 → Unexpected,
 * anything else (other 4xx, 1xx–3xx) → Failure.
 */
export function httpStatusToErrorType(status: number): ErrorType {
  switch (status) {
    case 400:
    case 411:
    case 413:
    case 414:
    case 415:
    case 416:
    case 417:
    case 422:
      return ErrorType.Validation;
    case 401:
    case 407:
      return ErrorType.Unauthorized;
    case 403:
      return ErrorType.Forbidden;
    case 404:
    case 410:
      return ErrorType.NotFound;
    case 409:
    case 412:
    case 429:
      return ErrorType.Conflict;
    case 408:
      return ErrorType.Unexpected;
    default:
      return status >= 500 ? ErrorType.Unexpected : ErrorType.Failure;
  }
}

const createError = (
  type: ErrorType,
  code: string,
  description: string,
  metadata?: ErrorMetadata,
): AppError => {
  switch (type) {
    case ErrorType.Validation:
      return Err.validation(code, description, metadata);
    case ErrorType.Unauthorized:
      return Err.unauthorized(code, description, metadata);
    case ErrorType.Forbidden:
      return Err.forbidden(code, description, metadata);
    case ErrorType.NotFound:
      return Err.notFound(code, description, metadata);
    case ErrorType.Conflict:
      return Err.conflict(code, description, metadata);
    case ErrorType.Unexpected:
      return Err.unexpected(code, description, metadata);
    case ErrorType.Unknown:
      return Err.unknown(code, description, metadata);
    default:
      return Err.failure(code, description, metadata);
  }
};

/**
 * Maps HTTP status codes to AppError instances.
 * Code is `Http.{status}`; the type follows {@link httpStatusToErrorType}.
 *
 * @example
 * const error = httpStatusToError(404, 'User not found');
 * // AppError { code: 'Http.404', description: 'User not found', type: 'NotFound' }
 */
export function httpStatusToError(status: number, description?: string): AppError {
  return createError(
    httpStatusToErrorType(status),
    `Http.${status}`,
    description ?? `HTTP request failed with status ${status}.`,
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const errorTypes: readonly ErrorType[] = Object.values(ErrorType);

/** Accepts `type` as an ErrorType name or as its numeric ordinal (`numericType`). */
const toErrorType = (type: unknown, numericType: unknown, fallback: ErrorType): ErrorType => {
  if (typeof type === 'string' && errorTypes.includes(type as ErrorType)) return type as ErrorType;
  const ordinal = typeof type === 'number' ? type : numericType;
  if (typeof ordinal === 'number' && Number.isInteger(ordinal) && errorTypes[ordinal]) {
    return errorTypes[ordinal];
  }
  return fallback;
};

const problemDescription = (body: unknown): string | undefined => {
  if (!isRecord(body)) return undefined;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature tsconfig requires bracket notation
  if (typeof body['detail'] === 'string') return body['detail'];
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature tsconfig requires bracket notation
  if (typeof body['title'] === 'string') return body['title'];
  return undefined;
};

/**
 * Converts a failed response's status and parsed ProblemDetails (RFC 9457) body to AppErrors.
 *
 * When the body has an `errors` extension, one AppError is produced per entry:
 * - list `[{ code, description, type?, numericType?, metadata? }]` — `type` is used when it
 *   is a valid ErrorType (name or numeric ordinal), otherwise `Validation`; plain-string
 *   entries use the `Http.{status}` code and `Validation`;
 * - dictionary `{ key: string[] | string }` (the common validation-problem shape) — one error
 *   per message with `key` as the code and type `Validation`.
 *
 * Entries without a type are `Validation`: an untyped `errors` extension carries only
 * validation errors (field / model-state errors).
 *
 * If nothing can be parsed, returns the single status error from {@link httpStatusToError}
 * (description from `detail`, then `title`).
 */
export function problemDetailsToErrors(status: number, body: unknown): AppError[] {
  const untypedType = ErrorType.Validation;
  const fallback = (): AppError[] => [httpStatusToError(status, problemDescription(body))];
  if (!isRecord(body)) return fallback();

  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature tsconfig requires bracket notation
  const errors = body['errors'];
  const parsed: AppError[] = [];

  if (Array.isArray(errors)) {
    for (const item of errors) {
      if (typeof item === 'string') {
        parsed.push(createError(untypedType, `Http.${status}`, item));
        continue;
      }
      if (!isRecord(item)) continue;
      const { code, description, type, numericType, metadata } = item;
      if (typeof code !== 'string' || typeof description !== 'string') continue;
      parsed.push(
        createError(
          toErrorType(type, numericType, untypedType),
          code,
          description,
          isRecord(metadata) ? ErrorMetadata.fromRecord(metadata) : undefined,
        ),
      );
    }
  } else if (isRecord(errors)) {
    for (const [key, value] of Object.entries(errors)) {
      const messages = Array.isArray(value) ? value : [value];
      for (const message of messages) {
        if (typeof message === 'string') parsed.push(createError(untypedType, key, message));
      }
    }
  }

  return parsed.length > 0 ? parsed : fallback();
}

/**
 * Reads a ProblemDetails (RFC 9457) response body from a failed response.
 * Returns the error description from the ProblemDetails if available.
 */
export async function extractErrorDescription(response: Response): Promise<string | undefined> {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (
      !contentType.includes('application/problem+json') &&
      !contentType.includes('application/json')
    ) {
      return undefined;
    }
    return problemDescription(await response.json());
  } catch {
    return undefined;
  }
}
