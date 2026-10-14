import { safeString } from './safe-string.js';

/**
 * Immutable metadata map for carrying additional error context.
 */
export type ErrorMetadata = ReadonlyMap<string, unknown>;

const exceptionDetails = (err: Error, seen = new Set<Error>()): Map<string, unknown> => {
  seen.add(err);
  const meta = new Map<string, unknown>([
    ['exceptionType', err.constructor.name],
    ['exceptionStackTrace', err.stack ?? ''],
    ['exceptionMessage', err.message],
  ]);
  // Nested map for `error.cause`; the `seen` guard stops cyclic `cause` chains.
  if (err.cause instanceof Error && !seen.has(err.cause)) {
    meta.set('innerException', exceptionDetails(err.cause, seen));
  }
  return meta;
};

const toPlain = (value: unknown): unknown =>
  value instanceof Map
    ? Object.fromEntries([...value].map(([k, v]) => [String(k), toPlain(v)]))
    : value;

export const ErrorMetadata = {
  empty(): ErrorMetadata {
    return new Map<string, unknown>();
  },

  fromRecord(record: Record<string, unknown>): ErrorMetadata {
    return new Map<string, unknown>(Object.entries(record));
  },

  /**
   * Captures exception details: `exceptionType`, `exceptionStackTrace`, `exceptionMessage`
   * and, when `error.cause` is an Error, a nested `innerException` metadata map (recursive).
   */
  fromException(error: unknown): ErrorMetadata {
    return exceptionDetails(error instanceof Error ? error : new Error(safeString(error)));
  },

  /**
   * Merges two metadata maps into a new map. On key collision the value from `base`
   * is kept (first wins), so `additional` can only add keys. Inputs are not mutated.
   */
  combine(base: ErrorMetadata, additional?: ErrorMetadata): ErrorMetadata {
    if (additional === undefined) return base;
    const merged = new Map<string, unknown>(base);
    for (const [key, value] of additional) {
      if (!merged.has(key)) merged.set(key, value);
    }
    return merged;
  },

  /**
   * Converts metadata to a plain record. Nested metadata maps (e.g. `innerException`)
   * are converted recursively so the result is JSON-serializable.
   */
  toRecord(metadata: ErrorMetadata): Record<string, unknown> {
    return toPlain(metadata) as Record<string, unknown>;
  },
} as const;
