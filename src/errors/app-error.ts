import type { Result } from '../result/result.js';
import { ErrorMetadata } from './error-metadata.js';
import { ErrorType } from './error-type.js';
import { safeString } from './safe-string.js';

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

/**
 * JSON wire shape of an AppError (`code`, `description`, `type`, `numericType`,
 * `metadata`). Metadata is a plain record
 * (nested metadata maps converted recursively) and is omitted when absent.
 */
export interface AppErrorJson {
  readonly code: string;
  readonly description: string;
  readonly type: ErrorType;
  readonly numericType: number;
  readonly metadata?: Record<string, unknown>;
}

/** Overrides accepted by {@link Err.with}; pass `metadata: undefined` to drop the metadata. */
export interface AppErrorPatch {
  readonly code?: string;
  readonly description?: string;
  readonly type?: ErrorType;
  readonly metadata?: ErrorMetadata | undefined;
}

/** Numeric value of each ErrorType (stable wire ordinals). */
const numericTypes: Readonly<Record<ErrorType, number>> = {
  Failure: 0,
  Unexpected: 1,
  Validation: 2,
  Conflict: 3,
  NotFound: 4,
  Unauthorized: 5,
  Forbidden: 6,
  Unknown: 7,
};

const toJSON = (error: AppError): AppErrorJson => {
  const json: AppErrorJson = {
    code: error.code,
    description: error.description,
    type: error.type,
    numericType: numericTypes[error.type] ?? numericTypes.Unknown,
  };
  return error.metadata === undefined
    ? json
    : { ...json, metadata: ErrorMetadata.toRecord(error.metadata) };
};

function toJSONMethod(this: AppError): AppErrorJson {
  return toJSON(this);
}

const make = (
  code: string,
  description: string,
  type: ErrorType,
  metadata?: ErrorMetadata,
): AppError => {
  const error = { code, description, type, metadata };
  // Non-enumerable so structural comparisons (toEqual, spread) are unaffected,
  // while JSON.stringify(error) emits metadata as a record instead of `{}`.
  Object.defineProperty(error, 'toJSON', { value: toJSONMethod, enumerable: false });
  return Object.freeze(error);
};

const errorTypes = Object.keys(numericTypes) as ErrorType[];

/** @internal Plain non-array object check for the JSON revivers. */
export const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @internal Reads a key ignoring case: CSharpEssentials writes PascalCase with the default
 * System.Text.Json options and camelCase with its web options.
 */
export const readJsonKey = (record: Record<string, unknown>, key: string): unknown => {
  if (Object.hasOwn(record, key)) return record[key];
  const lower = key.toLowerCase();
  const match = Object.keys(record).find((k) => k.toLowerCase() === lower);
  return match === undefined ? undefined : record[match];
};

// Result is built inline (type-only import) so errors keeps no runtime dependency on result.
const decoded = <T>(value: T): Result<T> => Object.freeze({ ok: true, value }) as Result<T>;

const invalidJson = (code: string, path: string, expected: string): Result<never> =>
  Object.freeze({
    ok: false,
    errors: Object.freeze([
      make(
        code,
        `${path} must be ${expected}.`,
        ErrorType.Validation,
        ErrorMetadata.fromRecord({ path }),
      ),
    ]),
  });

const readType = (record: Record<string, unknown>): ErrorType | undefined => {
  const type = readJsonKey(record, 'type');
  const byName =
    typeof type === 'string'
      ? errorTypes.find((t) => t.toLowerCase() === type.toLowerCase())
      : undefined;
  if (byName !== undefined) return byName;
  // A numeric `type` (C# enum without a string converter) or the `numericType` field.
  const ordinal = typeof type === 'number' ? type : readJsonKey(record, 'numericType');
  return errorTypes.find((t) => numericTypes[t] === ordinal);
};

/** @internal Validates one AppError JSON value; `path` names it in failure descriptions. */
export const decodeAppError = (json: unknown, path: string): Result<AppError> => {
  const fail = (field: string, expected: string) =>
    invalidJson('AppError.InvalidJson', field ? `${path}.${field}` : path, expected);
  if (!isJsonRecord(json)) return fail('', 'an object');
  const code = readJsonKey(json, 'code');
  if (typeof code !== 'string') return fail('code', 'a string');
  const description = readJsonKey(json, 'description');
  if (typeof description !== 'string') return fail('description', 'a string');
  const type = readType(json);
  if (type === undefined)
    return fail('type', `an ErrorType name (${errorTypes.join(', ')}) or ordinal`);
  const metadata = readJsonKey(json, 'metadata');
  if (metadata === undefined || metadata === null) return decoded(make(code, description, type));
  if (!isJsonRecord(metadata)) return fail('metadata', 'an object, null or absent');
  return decoded(make(code, description, type, ErrorMetadata.fromRecord(metadata)));
};

// Pairs already under comparison; a revisited pair is assumed equal so cyclic metadata terminates.
type Seen = Map<object, Set<object>>;

const isErrCreated = (value: unknown): value is AppError =>
  typeof value === 'object' &&
  value !== null &&
  (value as { toJSON?: unknown }).toJSON === toJSONMethod;

const sameErrors = (a: AppError, b: AppError, seen: Seen): boolean =>
  a.code === b.code &&
  a.description === b.description &&
  a.type === b.type &&
  sameMetadata(a.metadata, b.metadata, seen);

// Nested metadata maps and Err-created errors compare by value; other values use Object.is.
const sameValue = (a: unknown, b: unknown, seen: Seen): boolean => {
  if (Object.is(a, b)) return true;
  if (a instanceof Map && b instanceof Map) return sameMetadata(a, b, seen);
  return isErrCreated(a) && isErrCreated(b) && sameErrors(a, b, seen);
};

const sameMetadata = (
  a: ErrorMetadata | undefined,
  b: ErrorMetadata | undefined,
  seen: Seen,
): boolean => {
  if (a === undefined || b === undefined) return a === b;
  if (a === b) return true;
  if (a.size !== b.size) return false;
  const pairs = seen.get(a) ?? new Set<object>();
  if (pairs.has(b)) return true;
  seen.set(a, pairs.add(b));
  for (const [key, value] of a) {
    if (!b.has(key) || !sameValue(value, b.get(key), seen)) return false;
  }
  return true;
};

/** Code and description overrides for {@link Err.fromException}. */
export interface ExceptionErrorOverride {
  readonly code?: string | undefined;
  readonly description?: string | undefined;
}

/**
 * Factory namespace for creating AppError instances.
 * Without arguments each factory uses the bare type name as code (`Failure`, `Validation`,
 * `NotFound`, `Unknown`, ...) and a generic description.
 *
 * @example
 * const err = Err.validation('User.Email', 'Email is invalid');
 * const notFound = Err.notFound('User.NotFound', 'User with id 42 not found');
 */
export const Err = {
  failure(
    code = 'Failure',
    description = 'A failure has occurred.',
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.Failure, metadata);
  },

  unexpected(
    code = 'Unexpected',
    description = 'An unexpected error has occurred.',
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.Unexpected, metadata);
  },

  validation(
    code = 'Validation',
    description = 'A validation error has occurred.',
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.Validation, metadata);
  },

  conflict(
    code = 'Conflict',
    description = 'A conflict error has occurred.',
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.Conflict, metadata);
  },

  notFound(
    code = 'NotFound',
    description = "A 'Not Found' error has occurred.",
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.NotFound, metadata);
  },

  unauthorized(
    code = 'Unauthorized',
    description = "An 'Unauthorized' error has occurred.",
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.Unauthorized, metadata);
  },

  forbidden(
    code = 'Forbidden',
    description = "A 'Forbidden' error has occurred.",
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.Forbidden, metadata);
  },

  /**
   * Creates an error of type `Unknown`.
   */
  unknown(
    code = 'Unknown',
    description = 'An unknown error has occurred.',
    metadata?: ErrorMetadata,
  ): AppError {
    return make(code, description, ErrorType.Unknown, metadata);
  },

  /**
   * Creates an error from a thrown value. Defaults to `ErrorType.Failure`.
   * Code defaults to the exception's constructor name; description is its message; metadata
   * holds the exception details (see `ErrorMetadata.fromException`), on key collision the
   * exception details win over the supplied `metadata`.
   * Pass `{ code, description }` instead of a code string to also replace the description.
   *
   * @example
   * Err.fromException(e, ErrorType.Unexpected, { code: 'Db.Down', description: 'Database is unreachable' });
   */
  fromException(
    error: unknown,
    type: ErrorType = ErrorType.Failure,
    code?: string | ExceptionErrorOverride,
    metadata?: ErrorMetadata,
  ): AppError {
    const err = error instanceof Error ? error : new Error(safeString(error));
    const exceptionMeta = ErrorMetadata.fromException(err);
    const override: ExceptionErrorOverride =
      typeof code === 'object' && code !== null ? code : { code };
    return make(
      override.code ?? err.constructor.name,
      override.description ?? err.message,
      type,
      ErrorMetadata.combine(exceptionMeta, metadata),
    );
  },

  /**
   * Combines errors and error arrays into a single new flat array, preserving order.
   *
   * @example
   * Err.combine(e1, [e2, e3], e4) // [e1, e2, e3, e4]
   */
  combine(...errors: ReadonlyArray<AppError | readonly AppError[]>): AppError[] {
    return errors.flatMap((e): readonly AppError[] => (Array.isArray(e) ? e : [e as AppError]));
  },

  /**
   * Checks equality between two AppError values: code, description and type must match,
   * and metadata must be both absent or have the same keys with equal values
   * (absent metadata never equals present metadata, even if empty). Nested metadata maps
   * and nested errors created by `Err` are compared by value, recursively and cycle-safe;
   * any other value is compared with `Object.is`.
   */
  equals(a: AppError, b: AppError): boolean {
    return sameErrors(a, b, new Map());
  },

  /**
   * Converts an error to its JSON wire shape (see {@link AppErrorJson}).
   * Errors created through `Err` also expose this as a non-enumerable `toJSON()`,
   * so `JSON.stringify(error)` works directly.
   */
  toJSON(error: AppError): AppErrorJson {
    return toJSON(error);
  },

  /**
   * Validates a parsed JSON value and revives it as a frozen AppError. Accepts the
   * {@link AppErrorJson} shape and the CSharpEssentials `Error` shape: keys in any case,
   * `type` as a name (any case) or ordinal, falling back to `numericType`, and `metadata`
   * as a plain object, `null` or absent. A bad shape is a Validation failure with code
   * `AppError.InvalidJson` and the offending `path` in its metadata. Nested metadata
   * records (such as `innerException`) stay plain objects, not maps.
   *
   * @example
   * Err.fromJSON(JSON.parse(JSON.stringify(err))); // Result<AppError>
   */
  fromJSON(json: unknown): Result<AppError> {
    return decodeAppError(json, 'error');
  },

  /**
   * Returns a new frozen AppError with the given fields replaced. Unlike `{ ...error }`,
   * the copy keeps `toJSON` and stays frozen. Pass `metadata: undefined` to drop it.
   *
   * @example
   * Err.with(err, { code: `Api.${err.code}` });
   */
  with(error: AppError, patch: AppErrorPatch): AppError {
    return make(
      patch.code ?? error.code,
      patch.description ?? error.description,
      patch.type ?? error.type,
      'metadata' in patch ? patch.metadata : error.metadata,
    );
  },
} as const;

/**
 * Maps an ErrorType to the HTTP status code a server should respond with:
 * Validation→400, Unauthorized→401, Forbidden→403, NotFound→404, Conflict→409,
 * Failure/Unexpected/Unknown→500.
 */
export function errorTypeToHttpStatus(type: ErrorType): number {
  switch (type) {
    case ErrorType.Validation:
      return 400;
    case ErrorType.Unauthorized:
      return 401;
    case ErrorType.Forbidden:
      return 403;
    case ErrorType.NotFound:
      return 404;
    case ErrorType.Conflict:
      return 409;
    default:
      return 500;
  }
}
