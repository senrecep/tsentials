/**
 * Record<K, V> utilities — functional operations on plain objects.
 *
 * @example
 * import { Record as R } from 'tsentials/record';
 *
 * const users = { a: { name: 'Alice' }, b: { name: 'Bob' } };
 *
 * const names = R.map(users, u => u.name); // { a: 'Alice', b: 'Bob' }
 * const withCharlie = R.upsert(users, 'c', { name: 'Charlie' });
 */

// ─── Query ───────────────────────────────────────────────────────────────────

/**
 * Gets the keys of a record as a typed array.
 */
export function keys<K extends string>(record: Readonly<Record<K, unknown>>): ReadonlyArray<K> {
  return Object.keys(record) as Array<K>;
}

/**
 * Gets the values of a record.
 */
export function values<V>(record: Readonly<Record<string, V>>): ReadonlyArray<V> {
  return Object.values(record);
}

/**
 * Gets the entries of a record as [key, value] pairs.
 */
export function entries<K extends string, V>(
  record: Readonly<Record<K, V>>,
): ReadonlyArray<[K, V]> {
  return Object.entries(record) as Array<[K, V]>;
}

/**
 * Checks if a key exists in a record.
 */
export function has<K extends string>(record: Readonly<Record<K, unknown>>, key: string): boolean {
  return Object.hasOwn(record, key);
}

/**
 * Returns the number of entries in a record.
 */
export function size(record: Readonly<Record<string, unknown>>): number {
  return Object.keys(record).length;
}

/**
 * Checks if a record has no entries.
 */
export function isEmpty(record: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(record).length === 0;
}

// ─── Transformation ──────────────────────────────────────────────────────────

/**
 * Maps over the values of a record, preserving keys.
 */
export function map<K extends string, V, U>(
  record: Readonly<Record<K, V>>,
  f: (value: V, key: K) => U,
): Record<K, U> {
  const result = {} as Record<K, U>;
  for (const key of Object.keys(record) as Array<K>) {
    result[key] = f(record[key], key);
  }
  return result;
}

/**
 * Maps over the keys and values, optionally changing keys.
 */
export function mapWithKey<K extends string, V, L extends string>(
  record: Readonly<Record<K, V>>,
  f: (key: K, value: V) => [L, V],
): Record<L, V> {
  const result = {} as Record<L, V>;
  for (const key of Object.keys(record) as Array<K>) {
    const [newKey, newValue] = f(key, record[key]);
    result[newKey] = newValue;
  }
  return result;
}

/**
 * Filters a record by value predicate.
 */
export function filter<K extends string, V>(
  record: Readonly<Record<K, V>>,
  predicate: (value: V, key: K) => boolean,
): Partial<Record<K, V>> {
  const result = {} as Partial<Record<K, V>>;
  for (const key of Object.keys(record) as Array<K>) {
    if (predicate(record[key], key)) {
      result[key] = record[key];
    }
  }
  return result;
}

/**
 * Filters a record by value predicate, keeping only entries that match.
 */
export function filterMap<K extends string, V, U>(
  record: Readonly<Record<K, V>>,
  f: (value: V, key: K) => U | null | undefined,
): Partial<Record<K, U>> {
  const result = {} as Partial<Record<K, U>>;
  for (const key of Object.keys(record) as Array<K>) {
    const mapped = f(record[key], key);
    if (mapped != null) {
      result[key] = mapped;
    }
  }
  return result;
}

// ─── Modification ────────────────────────────────────────────────────────────

/**
 * Inserts or updates a key in a record.
 */
export function upsert<K extends string, V>(
  record: Readonly<Record<K, V>>,
  key: K,
  value: V,
): Record<K, V> {
  return { ...record, [key]: value };
}

/**
 * Removes a key from a record.
 */
export function remove<K extends string, L extends string, V>(
  record: Readonly<Record<K | L, V>>,
  key: L,
): Record<K, V> {
  const result = {} as Record<K, V>;
  for (const k of Object.keys(record) as Array<K | L>) {
    if (k !== key) {
      result[k as K] = record[k];
    }
  }
  return result;
}

/**
 * Picks a subset of keys from a record.
 */
export function pick<K extends string, L extends K, V>(
  record: Readonly<Record<K, V>>,
  ...keysToPick: ReadonlyArray<L>
): Record<L, V> {
  const result = {} as Record<L, V>;
  for (const key of keysToPick) {
    if (has(record as Readonly<Record<string, unknown>>, key)) {
      result[key] = record[key];
    }
  }
  return result;
}

/**
 * Omits a set of keys from a record.
 */
export function omit<K extends string, L extends K, V>(
  record: Readonly<Record<K, V>>,
  ...keysToOmit: ReadonlyArray<L>
): Record<Exclude<K, L>, V> {
  const result = {} as Record<Exclude<K, L>, V>;
  const omitSet = new Set(keysToOmit);
  for (const key of Object.keys(record) as Array<K>) {
    if (!omitSet.has(key as L)) {
      result[key as Exclude<K, L>] = record[key];
    }
  }
  return result;
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

/**
 * Reduces a record to a single value.
 */
export function reduce<K extends string, V, U>(
  record: Readonly<Record<K, V>>,
  initial: U,
  f: (acc: U, value: V, key: K) => U,
): U {
  let acc = initial;
  for (const key of Object.keys(record) as Array<K>) {
    acc = f(acc, record[key], key);
  }
  return acc;
}

/**
 * Partitions a record into two based on a predicate.
 */
export function partition<K extends string, V>(
  record: Readonly<Record<K, V>>,
  predicate: (value: V, key: K) => boolean,
): { pass: Partial<Record<K, V>>; fail: Partial<Record<K, V>> } {
  const pass = {} as Partial<Record<K, V>>;
  const fail = {} as Partial<Record<K, V>>;
  for (const key of Object.keys(record) as Array<K>) {
    if (predicate(record[key], key)) {
      pass[key] = record[key];
    } else {
      fail[key] = record[key];
    }
  }
  return { pass, fail };
}

// ─── Namespace ───────────────────────────────────────────────────────────────

export const Record = {
  keys,
  values,
  entries,
  has,
  size,
  isEmpty,
  map,
  mapWithKey,
  filter,
  filterMap,
  upsert,
  remove,
  pick,
  omit,
  reduce,
  partition,
} as const;
