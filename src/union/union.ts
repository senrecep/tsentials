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

  /**
   * Partitions a Union array into two groups by their tags.
   * Items with tags other than leftTag or rightTag are discarded.
   *
   * @example
   * type Shape = Union<{ circle: { r: number }; rect: { w: number; h: number } }>;
   * const shapes: Shape[] = [
   *   { tag: 'circle', value: { r: 5 } },
   *   { tag: 'rect', value: { w: 3, h: 4 } },
   * ];
   * const { lefts, rights } = Union.partition(shapes, 'circle', 'rect');
   * // lefts: Array<{ r: number }>
   * // rights: Array<{ w: number; h: number }>
   */
  partition<T extends Record<string, unknown>, K1 extends keyof T, K2 extends keyof T>(
    items: ReadonlyArray<Union<T>>,
    leftTag: K1,
    rightTag: K2,
  ): { lefts: Array<T[K1]>; rights: Array<T[K2]> } {
    const lefts: Array<T[K1]> = [];
    const rights: Array<T[K2]> = [];
    for (const item of items) {
      if (item.tag === leftTag) lefts.push(item.value as T[K1]);
      else if (item.tag === rightTag) rights.push(item.value as T[K2]);
    }
    return { lefts, rights };
  },

  /**
   * Groups a Union array by tag into a partial record.
   * Each key in the result contains values for that tag.
   *
   * @example
   * const groups = Union.groupBy(shapes);
   * groups.circle // Array<{ r: number }>
   * groups.rect   // Array<{ w: number; h: number }>
   */
  groupBy<T extends Record<string, unknown>>(
    items: ReadonlyArray<Union<T>>,
  ): { [K in keyof T]?: Array<T[K]> } {
    const result: { [K in keyof T]?: Array<T[K]> } = {};
    for (const item of items) {
      const key = item.tag as keyof T;
      if (!result[key]) {
        result[key] = [] as Array<T[typeof key]>;
      }
      (result[key] as Array<T[typeof key]>).push(item.value as T[typeof key]);
    }
    return result;
  },
} as const;
