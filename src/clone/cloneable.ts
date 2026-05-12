/**
 * Generic interface for objects that can produce deep copies of themselves.
 *
 * The covariant return type provides type-safe cloning.
 *
 * Note: For plain data objects, prefer the native `structuredClone()`.
 * Use ICloneable<T> when clone behavior needs custom logic (e.g., resetting
 * mutable internal state, excluding specific fields, or transforming values).
 *
 * @example
 * class UserAggregate implements Cloneable<UserAggregate> {
 *   constructor(public readonly id: string, private _events: DomainEvent[]) {}
 *   clone(): UserAggregate {
 *     return new UserAggregate(this.id, []); // excludes domain events
 *   }
 * }
 */
export interface Cloneable<T> {
  clone(): T;
}

/**
 * Deep-clones an array of cloneable items.
 *
 * @example
 * const cloned = cloneArray(entities);
 */
export function cloneArray<T extends Cloneable<T>>(items: readonly T[]): T[] {
  return items.map(item => item.clone());
}

/**
 * Deep-clones any value using the native structuredClone API.
 * Use this for plain data objects when custom clone logic is not needed.
 *
 * @example
 * const copy = deepClone({ user: { id: 1, name: 'Alice' } });
 */
export function deepClone<T>(value: T): T {
  return structuredClone(value);
}
