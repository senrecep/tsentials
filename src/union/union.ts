/**
 * Generic discriminated union utility type.
 *
 * IMPORTANT: TypeScript has NATIVE discriminated unions — this utility is for
 * when you need a programmatic, tag-based union over a record of types.
 * For most use cases, prefer native TypeScript union types directly:
 *
 *   type Shape = { kind: 'circle'; radius: number } | { kind: 'rect'; w: number; h: number };
 *
 * Use Union<T> when you want a uniform API for tag dispatch with exhaustiveness checking.
 *
 * @example
 * type PaymentResult = Union<{
 *   success: { transactionId: string };
 *   pending: { estimatedMs: number };
 *   failed: { error: AppError };
 * }>;
 *
 * const result: PaymentResult = { tag: 'success', value: { transactionId: 'txn_123' } };
 *
 * const message = Union.match(result, {
 *   success: ({ transactionId }) => `Paid! Ref: ${transactionId}`,
 *   pending: ({ estimatedMs }) => `Pending for ${estimatedMs}ms`,
 *   failed: ({ error }) => `Failed: ${error.description}`,
 * });
 */
export type Union<T extends Record<string, unknown>> = {
  [K in keyof T]: { readonly tag: K; readonly value: T[K] };
}[keyof T];

/**
 * Utilities for working with Union<T> values.
 */
export const Union = {
  /**
   * Creates a tagged union value.
   */
  of<T extends Record<string, unknown>, K extends keyof T>(tag: K, value: T[K]): Union<T> {
    return Object.freeze({ tag, value }) as Union<T>;
  },

  /**
   * Exhaustive pattern match over a Union<T>.
   * TypeScript ensures all cases are handled at compile time.
   *
   */
  match<T extends Record<string, unknown>, R>(
    union: Union<T>,
    handlers: { [K in keyof T]: (value: T[K]) => R },
  ): R {
    const handler = (handlers as Record<string | symbol, (value: unknown) => R>)[
      union.tag as string | symbol
    ];
    if (handler === undefined) throw new Error(`Unhandled union tag: ${String(union.tag)}`);
    return handler(union.value);
  },

  /**
   * Type guard — checks if the union has a specific tag.
   */
  is<T extends Record<string, unknown>, K extends keyof T>(
    union: Union<T>,
    tag: K,
  ): union is { tag: K; value: T[K] } {
    return union.tag === tag;
  },

  /**
   * Extracts the value for a specific tag, throws otherwise.
   */
  get<T extends Record<string, unknown>, K extends keyof T>(union: Union<T>, tag: K): T[K] {
    if (union.tag !== tag) {
      throw new Error(`Expected union tag '${String(tag)}' but got '${String(union.tag)}'.`);
    }
    return union.value as T[K];
  },
} as const;
