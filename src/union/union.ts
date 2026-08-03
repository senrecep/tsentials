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
 * function toMessage(result: PaymentResult): string {
 *   return Union.match(result, {
 *     success: ({ transactionId }) => `Paid! Ref: ${transactionId}`,
 *     pending: ({ estimatedMs }) => `Pending for ${estimatedMs}ms`,
 *     failed: ({ error }) => `Failed: ${error.description}`,
 *   });
 * }
 */
export type Union<T extends Record<string, unknown>> = {
  [K in keyof T]: { readonly tag: K; readonly value: T[K] };
}[keyof T];

/**
 * Any tagged value — the shape every Union<T> member conforms to.
 * Used so utilities can infer directly from the union value itself
 * (inferring T back out of Union<T> is not possible for the compiler).
 */
type Tagged = { readonly tag: PropertyKey; readonly value: unknown };

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
  match<U extends Tagged, R>(
    union: U,
    handlers: { [K in U['tag']]: (value: Extract<U, { readonly tag: K }>['value']) => R },
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
  is<U extends Tagged, K extends U['tag']>(
    union: U,
    tag: K,
  ): union is Extract<U, { readonly tag: K }> {
    return union.tag === tag;
  },

  /**
   * Extracts the value for a specific tag, throws otherwise.
   */
  get<U extends Tagged, K extends U['tag']>(
    union: U,
    tag: K,
  ): Extract<U, { readonly tag: K }>['value'] {
    if (union.tag !== tag) {
      throw new Error(`Expected union tag '${String(tag)}' but got '${String(union.tag)}'.`);
    }
    return union.value as Extract<U, { readonly tag: K }>['value'];
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
  partition<U extends Tagged, K1 extends U['tag'], K2 extends U['tag']>(
    items: ReadonlyArray<U>,
    leftTag: K1,
    rightTag: K2,
  ): {
    lefts: Array<Extract<U, { readonly tag: K1 }>['value']>;
    rights: Array<Extract<U, { readonly tag: K2 }>['value']>;
  } {
    const lefts: Array<Extract<U, { readonly tag: K1 }>['value']> = [];
    const rights: Array<Extract<U, { readonly tag: K2 }>['value']> = [];
    for (const item of items) {
      if (item.tag === leftTag) lefts.push(item.value as Extract<U, { readonly tag: K1 }>['value']);
      else if (item.tag === rightTag)
        rights.push(item.value as Extract<U, { readonly tag: K2 }>['value']);
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
  groupBy<U extends Tagged>(
    items: ReadonlyArray<U>,
  ): { [K in U['tag']]?: Array<Extract<U, { readonly tag: K }>['value']> } {
    const result: Record<PropertyKey, Array<unknown>> = {};
    for (const item of items) {
      const key = item.tag;
      if (!result[key]) {
        result[key] = [];
      }
      result[key].push(item.value);
    }
    return result as { [K in U['tag']]?: Array<Extract<U, { readonly tag: K }>['value']> };
  },
} as const;
