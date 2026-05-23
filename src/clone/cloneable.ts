const { toString: objectToString } = Object.prototype;

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  const type = typeof value;
  if (type !== 'object') return type;
  return objectToString.call(value).slice(8, -1);
}

function cloneArrayBuffer(buffer: ArrayBufferLike): ArrayBufferLike {
  if (buffer instanceof ArrayBuffer) {
    return buffer.slice(0);
  }
  return buffer;
}

function cloneTypedArray(view: ArrayBufferView, buffer: ArrayBufferLike): ArrayBufferView {
  if (view instanceof DataView) {
    return new DataView(buffer, view.byteOffset, view.byteLength);
  }
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

function recursiveClone<T>(value: T, seen: WeakMap<object, unknown>): T {
  // Primitives (immutable)
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'symbol') {
      // Symbols cannot be cloned — gracefully degrade to undefined
      return undefined as unknown as T;
    }
    if (typeof value === 'function') {
      // Functions are immutable references — return as-is
      return value;
    }
    return value;
  }

  // Circular reference guard
  if (seen.has(value as object)) {
    return seen.get(value as object) as T;
  }

  const tag = typeOf(value);

  switch (tag) {
    case 'Date': {
      const cloned = new Date((value as unknown as Date).getTime()) as unknown as T;
      seen.set(value as object, cloned);
      return cloned;
    }
    case 'RegExp': {
      const original = value as unknown as RegExp;
      const cloned = new RegExp(original.source, original.flags) as unknown as T;
      seen.set(value as object, cloned);
      return cloned;
    }
    case 'Map': {
      const original = value as unknown as Map<unknown, unknown>;
      const cloned = new Map<unknown, unknown>();
      seen.set(value as object, cloned);
      for (const [k, v] of original) {
        cloned.set(recursiveClone(k, seen), recursiveClone(v, seen));
      }
      return cloned as unknown as T;
    }
    case 'Set': {
      const original = value as unknown as Set<unknown>;
      const cloned = new Set<unknown>();
      seen.set(value as object, cloned);
      for (const v of original) {
        cloned.add(recursiveClone(v, seen));
      }
      return cloned as unknown as T;
    }
    case 'WeakMap': {
      // WeakMap is non-iterable — return an empty instance of the same type
      const cloned = new WeakMap();
      seen.set(value as object, cloned);
      return cloned as unknown as T;
    }
    case 'WeakSet': {
      // WeakSet is non-iterable — return an empty instance of the same type
      const cloned = new WeakSet();
      seen.set(value as object, cloned);
      return cloned as unknown as T;
    }
    case 'ArrayBuffer': {
      const cloned = cloneArrayBuffer(value as unknown as ArrayBuffer) as unknown as T;
      seen.set(value as object, cloned);
      return cloned;
    }
    case 'SharedArrayBuffer': {
      // SharedArrayBuffer is intentionally shared memory — return the same reference
      seen.set(value as object, value);
      return value;
    }
    case 'DataView': {
      const original = value as unknown as DataView;
      const buffer = cloneArrayBuffer(original.buffer);
      const cloned = new DataView(buffer, original.byteOffset, original.byteLength) as unknown as T;
      seen.set(value as object, cloned);
      return cloned;
    }
    case 'Boolean':
    case 'Number':
    case 'String': {
      const original = value as unknown as { valueOf(): boolean | number | string };
      const cloned = Object(original.valueOf()) as unknown as T;
      seen.set(value as object, cloned);
      return cloned;
    }
    case 'Error':
    case 'EvalError':
    case 'RangeError':
    case 'ReferenceError':
    case 'SyntaxError':
    case 'TypeError':
    case 'URIError': {
      const original = value as unknown as Error;
      const Constructor = original.constructor as new (message?: string) => Error;
      const cloned = new Constructor(original.message);
      seen.set(value as object, cloned);
      cloned.name = original.name;
      if ('cause' in original) {
        const cause = (original as Error & { cause?: unknown }).cause;
        (cloned as Error & { cause?: unknown }).cause =
          cause !== undefined && cause !== null && typeof cause === 'object'
            ? (recursiveClone(cause, seen) as unknown)
            : cause;
      }
      // Copy custom enumerable properties (e.g. code, statusCode, description)
      for (const key of Object.keys(original)) {
        if (key !== 'message' && key !== 'name') {
          (cloned as unknown as Record<string, unknown>)[key] = recursiveClone(
            (original as unknown as Record<string, unknown>)[key],
            seen,
          );
        }
      }
      return cloned as unknown as T;
    }
    case 'Array': {
      const original = value as unknown as unknown[];
      const cloned = new Array(original.length) as unknown[];
      seen.set(value as object, cloned);
      for (let i = 0; i < original.length; i++) {
        if (i in original) {
          cloned[i] = recursiveClone(original[i], seen);
        }
      }
      return cloned as unknown as T;
    }
    case 'BigInt': {
      // Object(BigInt) wrapper
      const cloned = Object((value as unknown as { valueOf(): bigint }).valueOf()) as unknown as T;
      seen.set(value as object, cloned);
      return cloned;
    }
    default: {
      // TypedArrays
      if (ArrayBuffer.isView(value)) {
        const original = value as ArrayBufferView;
        const buffer = cloneArrayBuffer(original.buffer);
        const cloned = cloneTypedArray(original, buffer) as unknown as T;
        seen.set(value as object, cloned);
        return cloned;
      }

      // Plain objects — Object.keys naturally skips symbol keys
      const original = value as Record<string | number | symbol, unknown>;
      const cloned: Record<string | number | symbol, unknown> = {};
      seen.set(value as object, cloned);
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
  }
}

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
  return items.map((item) => item.clone());
}

/**
 * Deep-clones any value using the native `structuredClone` API when available,
 * falling back to a recursive implementation that supports:
 *
 * - Primitives, null, undefined
 * - Plain objects and arrays
 * - Date, RegExp
 * - Map, Set
 * - ArrayBuffer, DataView, and all TypedArray variants
 * - Error and its subclasses (including `cause`)
 * - BigInt (primitive and wrapper)
 * - Boolean, Number, String wrappers
 * - Circular references
 * - Functions (by reference, since they are immutable)
 *
 * Gracefully degrades on uncloneable types:
 * - `Symbol` values become `undefined`
 * - `WeakMap` / `WeakSet` become empty instances
 *
 * Never throws — if native `structuredClone` rejects a value, the fallback
 * recursively clones it in a lossy but safe manner.
 *
 * @example
 * const copy = deepClone({ user: { id: 1, name: 'Alice' } });
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Native structuredClone cannot handle this value (e.g. function, symbol)
      // Fall through to lossy recursive clone
    }
  }
  return recursiveClone(value, new WeakMap());
}
