/**
 * Immutable metadata map for carrying additional error context.
 */
export type ErrorMetadata = ReadonlyMap<string, unknown>;

export const ErrorMetadata = {
  empty(): ErrorMetadata {
    return new Map<string, unknown>();
  },

  fromRecord(record: Record<string, unknown>): ErrorMetadata {
    return new Map<string, unknown>(Object.entries(record));
  },

  fromException(error: unknown): ErrorMetadata {
    const err = error instanceof Error ? error : new Error(String(error));
    return new Map<string, unknown>([
      ['exceptionType', err.constructor.name],
      ['exceptionMessage', err.message],
      ['exceptionStack', err.stack ?? ''],
    ]);
  },

  combine(base: ErrorMetadata, additional?: ErrorMetadata): ErrorMetadata {
    if (additional === undefined) return base;
    return new Map<string, unknown>([...base, ...additional]);
  },

  toRecord(metadata: ErrorMetadata): Record<string, unknown> {
    return Object.fromEntries(metadata);
  },
} as const;
