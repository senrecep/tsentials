import { ErrorMetadata } from './error-metadata.js';
import { ErrorType } from './error-type.js';

/**
 * Represents a structured, immutable application error value.
 *
 * Named AppError to avoid collision with the native JavaScript Error class.
 *
 * Design notes:
 * - `Object.freeze` provides runtime immutability
 * - Factory functions instead of implicit operators
 * - `Err` namespace instead of static class methods on `Error`
 */
export interface AppError {
  readonly code: string;
  readonly description: string;
  readonly type: ErrorType;
  readonly metadata?: ErrorMetadata | undefined;
}

const make = (
  code: string,
  description: string,
  type: ErrorType,
  metadata?: ErrorMetadata,
): AppError => Object.freeze({ code, description, type, metadata });

/**
 * Factory namespace for creating AppError instances.
 * Static factory methods for creating AppError instances.
 *
 * @example
 * const err = Err.validation('User.Email', 'Email is invalid');
 * const notFound = Err.notFound('User.NotFound', 'User with id 42 not found');
 */
export const Err = {
  failure(
    code = 'General.Failure',
    description = 'A failure has occurred.',
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.Failure, metadata);
  },

  unexpected(
    code = 'General.Unexpected',
    description = 'An unexpected error has occurred.',
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.Unexpected, metadata);
  },

  validation(
    code = 'General.Validation',
    description = 'A validation error has occurred.',
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.Validation, metadata);
  },

  conflict(
    code = 'General.Conflict',
    description = 'A conflict error has occurred.',
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.Conflict, metadata);
  },

  notFound(
    code = 'General.NotFound',
    description = "A 'Not Found' error has occurred.",
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.NotFound, metadata);
  },

  unauthorized(
    code = 'General.Unauthorized',
    description = "An 'Unauthorized' error has occurred.",
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.Unauthorized, metadata);
  },

  forbidden(
    code = 'General.Forbidden',
    description = "A 'Forbidden' error has occurred.",
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.Forbidden, metadata);
  },

  fromException(
    error: unknown,
    type: ErrorType = ErrorType.Unexpected,
    code?: string,
    metadata?: ErrorMetadata,
  ): AppError {
    const err = error instanceof Error ? error : new Error(String(error));
    const exceptionMeta = ErrorMetadata.fromException(err);
    return make(
      code ?? err.constructor.name,
      err.message,
      type,
      ErrorMetadata.combine(exceptionMeta, metadata),
    );
  },

  /**
   * Combines multiple errors into an array.
   */
  combine(...errors: AppError[]): AppError[] {
    return errors;
  },

  /**
   * Checks structural equality between two AppError instances.
   */
  equals(a: AppError, b: AppError): boolean {
    return a.code === b.code && a.description === b.description && a.type === b.type;
  },
} as const;
