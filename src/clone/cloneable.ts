const { toString: objectToString } = Object.prototype;

type Brand = (this: unknown) => unknown;

function getter(proto: object, key: string): Brand {
  return Object.getOwnPropertyDescriptor(proto, key)?.get as Brand;
}

/**
 * Brand checks: built-in methods/getters that throw a TypeError unless `this` really is
 * that built-in (internal slot check). Unlike `instanceof` or the
 * `Object.prototype.toString` tag they cannot be spoofed with `Symbol.toStringTag` or
 * `Object.create(Map.prototype)`, and they also recognise objects from another realm.
 */
const brands = {
  Date: Date.prototype.getTime as Brand,
  RegExp: getter(RegExp.prototype, 'source'),
  Map: getter(Map.prototype, 'size'),
  Set: getter(Set.prototype, 'size'),
  WeakMap: function (this: unknown) {
    return WeakMap.prototype.has.call(this as WeakMap<object, unknown>, {});
  } as Brand,
  WeakSet: function (this: unknown) {
    return WeakSet.prototype.has.call(this as WeakSet<object>, {});
  } as Brand,
  ArrayBuffer: getter(ArrayBuffer.prototype, 'byteLength'),
  SharedArrayBuffer:
    typeof SharedArrayBuffer === 'function'
      ? getter(SharedArrayBuffer.prototype, 'byteLength')
      : undefined,
  DataView: getter(DataView.prototype, 'byteLength'),
  Boolean: Boolean.prototype.valueOf as Brand,
  Number: Number.prototype.valueOf as Brand,
  String: String.prototype.valueOf as Brand,
  BigInt: typeof BigInt === 'function' ? (BigInt.prototype.valueOf as Brand) : undefined,
  URL: typeof URL === 'function' ? getter(URL.prototype, 'href') : undefined,
  URLSearchParams:
    typeof URLSearchParams === 'function'
      ? (URLSearchParams.prototype.toString as Brand)
      : undefined,
} as const;

/**
 * True when `value` really is the built-in `name`: it is a candidate (same-realm
 * `instanceof`, or a matching `toString` tag for cross-realm objects) AND passes the
 * unspoofable brand check.
 */
function is(value: object, tag: string, name: keyof typeof brands): boolean {
  const brand = brands[name];
  if (brand === undefined) return false;
  const Ctor = (globalThis as Record<string, unknown>)[name];
  const candidate = (typeof Ctor === 'function' && value instanceof Ctor) || tag === name;
  return candidate && passes(brand, value);
}

function passes(brand: Brand, value: object): boolean {
  try {
    brand.call(value);
    return true;
  } catch {
    return false;
  }
}

function instanceOfGlobal(value: object, name: string): boolean {
  const Ctor = (globalThis as Record<string, unknown>)[name];
  return typeof Ctor === 'function' && value instanceof Ctor;
}

function cloneBuffer(buffer: ArrayBufferLike, seen: WeakMap<object, unknown>): ArrayBufferLike {
  // Routed through `seen` so views over one buffer keep sharing a single cloned buffer
  if (seen.has(buffer)) return seen.get(buffer) as ArrayBufferLike;
  // Brand check (not instanceof) so a buffer from another realm is copied too; the copy is
  // always a same-realm ArrayBuffer. SharedArrayBuffer fails the check and stays shared.
  let cloned: ArrayBufferLike = buffer;
  if (passes(brands.ArrayBuffer, buffer)) {
    cloned = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(cloned).set(new Uint8Array(buffer));
  }
  seen.set(buffer, cloned);
  return cloned;
}

function cloneTypedArray(view: ArrayBufferView, buffer: ArrayBufferLike): ArrayBufferView {
  const Constructor = view.constructor as new (
    buffer: ArrayBufferLike,
    byteOffset?: number,
    length?: number,
  ) => ArrayBufferView;
  return new Constructor(
    buffer,
    view.byteOffset,
    (view as ArrayBufferView & { length: number }).length,
  );
}

function cloneError(original: Error, seen: WeakMap<object, unknown>): Error {
  // Skip the constructor: subclasses may have different signatures or side effects.
  const cloned = Object.create(Object.getPrototypeOf(original)) as Error;
  seen.set(original, cloned);
  for (const key of Object.getOwnPropertyNames(original)) {
    const descriptor = Object.getOwnPropertyDescriptor(original, key);
    if (descriptor === undefined) continue;
    if (key === 'stack') {
      // V8 exposes `stack` through an internal accessor; copy the string as plain data
      Object.defineProperty(cloned, key, {
        value: original.stack,
        writable: true,
        enumerable: false,
        configurable: true,
      });
      continue;
    }
    if ('value' in descriptor) descriptor.value = recursiveClone(descriptor.value, seen);
    Object.defineProperty(cloned, key, descriptor);
  }
  return cloned;
}

function isArrayIndex(key: string): boolean {
  const n = Number(key);
  return Number.isInteger(n) && n >= 0 && n < 2 ** 32 - 1 && String(n) === key;
}

function recursiveClone<T>(value: T, seen: WeakMap<object, unknown>): T {
  // Primitives (immutable)
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'symbol') {
      // Symbols cannot be cloned: gracefully degrade to undefined
      return undefined as unknown as T;
    }
    if (typeof value === 'function') {
      // Functions are immutable references: return as-is
      return value;
    }
    return value;
  }

  // Circular reference guard
  if (seen.has(value as object)) {
    return seen.get(value as object) as T;
  }

  const object = value as object;
  const tag = objectToString.call(object).slice(8, -1);

  // Arrays and ArrayBuffer views first: Array.isArray / ArrayBuffer.isView are
  // unspoofable and cross-realm.
  if (Array.isArray(object)) {
    const original = object as unknown[];
    const cloned = new Array(original.length) as unknown[];
    seen.set(object, cloned);
    for (let i = 0; i < original.length; i++) {
      if (i in original) {
        cloned[i] = recursiveClone(original[i], seen);
      }
    }
    // Non-index own enumerable properties (e.g. regex match `index`/`groups`)
    for (const key of Object.keys(original)) {
      if (!isArrayIndex(key)) {
        (cloned as unknown as Record<string, unknown>)[key] = recursiveClone(
          (original as unknown as Record<string, unknown>)[key],
          seen,
        );
      }
    }
    return cloned as unknown as T;
  }

  if (ArrayBuffer.isView(object)) {
    if (passes(brands.DataView, object)) {
      const original = object as DataView;
      const buffer = cloneBuffer(original.buffer, seen);
      const cloned = new DataView(buffer, original.byteOffset, original.byteLength) as unknown as T;
      seen.set(object, cloned);
      return cloned;
    }
    const buffer = cloneBuffer(object.buffer, seen);
    const cloned = cloneTypedArray(object, buffer) as unknown as T;
    seen.set(object, cloned);
    return cloned;
  }

  if (is(object, tag, 'Date')) {
    const cloned = new Date((object as Date).getTime()) as unknown as T;
    seen.set(object, cloned);
    return cloned;
  }
  if (is(object, tag, 'RegExp')) {
    const original = object as RegExp;
    const cloned = new RegExp(original.source, original.flags) as unknown as T;
    seen.set(object, cloned);
    return cloned;
  }
  if (is(object, tag, 'Map')) {
    const cloned = new Map<unknown, unknown>();
    seen.set(object, cloned);
    for (const [k, v] of Map.prototype.entries.call(object as Map<unknown, unknown>)) {
      cloned.set(recursiveClone(k, seen), recursiveClone(v, seen));
    }
    return cloned as unknown as T;
  }
  if (is(object, tag, 'Set')) {
    const cloned = new Set<unknown>();
    seen.set(object, cloned);
    for (const v of Set.prototype.values.call(object as Set<unknown>)) {
      cloned.add(recursiveClone(v, seen));
    }
    return cloned as unknown as T;
  }
  if (is(object, tag, 'WeakMap')) {
    // WeakMap is non-iterable, return an empty instance of the same type
    const cloned = new WeakMap();
    seen.set(object, cloned);
    return cloned as unknown as T;
  }
  if (is(object, tag, 'WeakSet')) {
    // WeakSet is non-iterable, return an empty instance of the same type
    const cloned = new WeakSet();
    seen.set(object, cloned);
    return cloned as unknown as T;
  }
  if (is(object, tag, 'ArrayBuffer')) {
    const cloned = cloneBuffer(object as ArrayBuffer, seen) as unknown as T;
    seen.set(object, cloned);
    return cloned;
  }
  if (is(object, tag, 'SharedArrayBuffer')) {
    // SharedArrayBuffer is intentionally shared memory, return the same reference
    seen.set(object, object);
    return value;
  }
  for (const name of ['Boolean', 'Number', 'String', 'BigInt'] as const) {
    if (is(object, tag, name)) {
      // Primitive wrapper objects (Object(true), Object(1), Object('s'), Object(1n))
      const cloned = Object(brands[name]?.call(object)) as unknown as T;
      seen.set(object, cloned);
      return cloned;
    }
  }
  if (is(object, tag, 'URL')) {
    const cloned = new URL((object as URL).href) as unknown as T;
    seen.set(object, cloned);
    return cloned;
  }
  if (is(object, tag, 'URLSearchParams')) {
    const cloned = new URLSearchParams(
      URLSearchParams.prototype.toString.call(object as URLSearchParams),
    ) as unknown as T;
    seen.set(object, cloned);
    return cloned;
  }
  if (instanceOfGlobal(object, 'Blob') || instanceOfGlobal(object, 'Promise')) {
    // Immutable / identity-bound host objects (Blob, File, Promise), returned by reference
    seen.set(object, object);
    return value;
  }

  if (object instanceof Error) {
    return cloneError(object, seen) as unknown as T;
  }

  // Plain objects: Object.keys naturally skips symbol keys
  const original = object as Record<string | number | symbol, unknown>;
  const cloned: Record<string | number | symbol, unknown> = {};
  seen.set(object, cloned);
  for (const key of Object.keys(original)) {
    if (key === '__proto__') continue; // explicit guard against prototype pollution
    Object.defineProperty(cloned, key, {
      value: recursiveClone(original[key], seen),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return cloned as unknown as T;
}

/**
 * Generic interface for objects that can produce deep copies of themselves.
 *
 * The covariant return type provides type-safe cloning.
 *
 * Use Cloneable<T> when clone behavior needs custom logic (e.g., resetting
 * mutable internal state, excluding specific fields, or transforming values).
 * For plain data, use `deepClone()`.
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
  return items.map((item) => item.clone());
}

/**
 * Deep-clones any value with a built-in recursive implementation. It never
 * delegates to the native `structuredClone`, so the result is identical on every
 * runtime (Node, browsers, React Native/Hermes) and for every input shape.
 *
 * Supported:
 * - Primitives, null, undefined
 * - Plain objects and arrays (including non-index array properties)
 * - Date, RegExp, URL, URLSearchParams
 * - Map, Set
 * - ArrayBuffer, DataView, TypedArrays (views over one buffer keep sharing one cloned buffer)
 * - Error and subclasses, AggregateError (prototype, name, stack, cause, own props preserved)
 * - BigInt (primitive and wrapper), Boolean/Number/String wrappers
 * - Circular and shared references
 *
 * Intentional differences from `structuredClone`:
 * - Error subclasses keep their prototype/`name` and custom properties
 * - Functions, Blob, File, Promise and SharedArrayBuffer are returned by reference
 * - `Symbol` values become `undefined`; WeakMap/WeakSet become empty instances
 * - Class instances become plain objects (prototype is not preserved, like native)
 * - A `__proto__` own key (e.g. from JSON.parse) is dropped
 *
 * Throws RangeError on extremely deep nesting (recursive traversal).
 *
 * @example
 * const copy = deepClone({ user: { id: 1, name: 'Alice' } });
 */
export function deepClone<T>(value: T): T {
  return recursiveClone(value, new WeakMap());
}
