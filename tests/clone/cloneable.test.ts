import type { Cloneable } from '../../src/clone/cloneable.js';
import { cloneArray, deepClone } from '../../src/clone/cloneable.js';

class Product implements Cloneable<Product> {
  constructor(
    public readonly id: string,
    public readonly name: string,
    private _stock: number,
  ) {}

  get stock(): number {
    return this._stock;
  }

  adjustStock(delta: number): void {
    this._stock += delta;
  }

  clone(): Product {
    return new Product(this.id, this.name, this._stock);
  }
}

describe('Cloneable interface', () => {
  it('clones a Product', () => {
    const original = new Product('p1', 'Widget', 100);
    const copy = original.clone();
    expect(copy.id).toBe(original.id);
    expect(copy.name).toBe(original.name);
    expect(copy.stock).toBe(original.stock);
    expect(copy).not.toBe(original);
  });

  it('clone is independent (mutations do not affect original)', () => {
    const original = new Product('p1', 'Widget', 100);
    const copy = original.clone();
    copy.adjustStock(-10);
    expect(original.stock).toBe(100);
    expect(copy.stock).toBe(90);
  });
});

describe('cloneArray', () => {
  it('clones each element in the array', () => {
    const items = [new Product('a', 'Alpha', 10), new Product('b', 'Beta', 20)];
    const cloned = cloneArray(items);
    expect(cloned).toHaveLength(2);
    expect(cloned[0]).not.toBe(items[0]);
    expect(cloned[1]).not.toBe(items[1]);
  });

  it('modifications to clone do not affect original array', () => {
    const items = [new Product('a', 'Alpha', 10)];
    const cloned = cloneArray(items);
    cloned[0]!.adjustStock(50);
    expect(items[0]!.stock).toBe(10);
  });

  it('returns empty array for empty input', () => {
    const cloned = cloneArray([]);
    expect(cloned).toEqual([]);
  });
});

describe('deepClone', () => {
  it('deep clones a plain object', () => {
    const obj = { a: 1, nested: { b: 2 } };
    const copy = deepClone(obj);
    expect(copy).toEqual(obj);
    expect(copy).not.toBe(obj);
    expect(copy.nested).not.toBe(obj.nested);
  });

  it('deep clones an array', () => {
    const arr = [{ id: 1 }, { id: 2 }];
    const copy = deepClone(arr);
    expect(copy).toEqual(arr);
    copy[0]!.id = 99;
    expect(arr[0]!.id).toBe(1);
  });

  it('deep clones nested arrays', () => {
    const arr = [
      [1, 2],
      [3, 4],
    ];
    const copy = deepClone(arr);
    expect(copy).toEqual(arr);
    copy[0]![0] = 99;
    expect(arr[0]![0]).toBe(1);
  });

  it('deep clones objects with Date values', () => {
    const obj = { createdAt: new Date('2024-01-01') };
    const copy = deepClone(obj);
    expect(copy.createdAt).toEqual(obj.createdAt);
    expect(copy.createdAt).not.toBe(obj.createdAt);
  });

  it('deep clones objects with Map values', () => {
    const obj = { map: new Map([['key', 'value']]) };
    const copy = deepClone(obj);
    expect(copy.map.get('key')).toBe('value');
    copy.map.set('key', 'modified');
    expect(obj.map.get('key')).toBe('value');
  });

  it('deep clones objects with Set values', () => {
    const obj = { set: new Set([1, 2, 3]) };
    const copy = deepClone(obj);
    expect(copy.set.has(2)).toBe(true);
    copy.set.add(99);
    expect(obj.set.has(99)).toBe(false);
  });

  it('deep clones a primitive string', () => {
    expect(deepClone('hello')).toBe('hello');
  });

  it('deep clones a primitive number', () => {
    expect(deepClone(42)).toBe(42);
  });

  it('deep clones null', () => {
    expect(deepClone(null)).toBeNull();
  });

  it('deep clones undefined', () => {
    expect(deepClone(undefined)).toBeUndefined();
  });

  it('deep clones a boolean', () => {
    expect(deepClone(true)).toBe(true);
  });

  it('deep clones circular references in objects', () => {
    const obj: { a: number; self?: unknown } = { a: 1 };
    obj.self = obj;
    const copy = deepClone(obj);
    expect(copy).not.toBe(obj);
    expect(copy.a).toBe(1);
    expect(copy.self).toBe(copy);
  });

  it('deep clones circular references in arrays', () => {
    const arr: unknown[] = [1, 2];
    arr.push(arr);
    const copy = deepClone(arr);
    expect(copy).not.toBe(arr);
    expect(copy[0]).toBe(1);
    expect(copy[1]).toBe(2);
    expect(copy[2]).toBe(copy);
  });

  it('deep clones RegExp values', () => {
    const obj = { pattern: /test/gi };
    const copy = deepClone(obj);
    expect(copy.pattern.source).toBe('test');
    expect(copy.pattern.flags).toBe('gi');
    expect(copy.pattern).not.toBe(obj.pattern);
  });

  it('deep clones BigInt values', () => {
    const obj = { value: BigInt(42) };
    const copy = deepClone(obj);
    expect(copy.value).toBe(BigInt(42));
  });

  it('deep clones ArrayBuffer values', () => {
    const buffer = new ArrayBuffer(4);
    const view = new Uint8Array(buffer);
    view.set([1, 2, 3, 4]);
    const copy = deepClone(buffer);
    expect(copy).not.toBe(buffer);
    expect(new Uint8Array(copy)).toEqual(new Uint8Array(buffer));
  });

  it('deep clones Uint8Array values', () => {
    const arr = new Uint8Array([1, 2, 3]);
    const obj = { data: arr };
    const copy = deepClone(obj);
    expect(copy.data).not.toBe(arr);
    expect(copy.data).toEqual(arr);
    expect(copy.data.buffer).not.toBe(arr.buffer);
  });

  it('deep clones Float64Array values', () => {
    const arr = new Float64Array([1.1, 2.2, 3.3]);
    const copy = deepClone(arr);
    expect(copy).not.toBe(arr);
    expect(copy).toEqual(arr);
  });

  it('deep clones BigInt64Array values', () => {
    const arr = new BigInt64Array([BigInt(1), BigInt(2)]);
    const copy = deepClone(arr);
    expect(copy).not.toBe(arr);
    expect(copy).toEqual(arr);
  });

  it('deep clones DataView values', () => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setInt32(0, 42);
    const copy = deepClone(view);
    expect(copy).not.toBe(view);
    expect(copy.getInt32(0)).toBe(42);
    expect(copy.buffer).not.toBe(buffer);
  });

  it('deep clones Error values preserving name and message', () => {
    const error = new TypeError('Something went wrong');
    const copy = deepClone(error);
    expect(copy).not.toBe(error);
    expect(copy.name).toBe('TypeError');
    expect(copy.message).toBe('Something went wrong');
  });

  it('deep clones Error with cause', () => {
    const cause = new Error('root cause');
    const error = new Error('wrapper', { cause });
    const copy = deepClone(error);
    expect(copy.message).toBe('wrapper');
    expect((copy as Error & { cause?: unknown }).cause).toStrictEqual(cause);
  });

  it('deep clones Boolean wrapper objects', () => {
    const obj = { value: Object(true) };
    const copy = deepClone(obj);
    expect(copy.value).not.toBe(obj.value);
    expect(copy.value.valueOf()).toBe(true);
  });

  it('deep clones Number wrapper objects', () => {
    const obj = { value: Object(42) };
    const copy = deepClone(obj);
    expect(copy.value).not.toBe(obj.value);
    expect(copy.value.valueOf()).toBe(42);
  });

  it('deep clones String wrapper objects', () => {
    const obj = { value: Object('hello') };
    const copy = deepClone(obj);
    expect(copy.value).not.toBe(obj.value);
    expect(copy.value.valueOf()).toBe('hello');
  });

  it('preserves function references by identity', () => {
    const fn = () => 42;
    const obj = { fn };
    const copy = deepClone(obj);
    expect(copy.fn).toBe(fn);
  });

  it('replaces symbol values with undefined', () => {
    const obj = { sym: Symbol('x'), other: 'ok' };
    const copy = deepClone(obj);
    expect(copy.sym).toBeUndefined();
    expect(copy.other).toBe('ok');
  });

  it('returns empty WeakMap instance', () => {
    const wm = new WeakMap();
    const copy = deepClone(wm);
    expect(copy).toBeInstanceOf(WeakMap);
    expect(copy).not.toBe(wm);
  });

  it('returns empty WeakSet instance', () => {
    const ws = new WeakSet();
    const copy = deepClone(ws);
    expect(copy).toBeInstanceOf(WeakSet);
    expect(copy).not.toBe(ws);
  });

  it('deep clones Error with circular cause (error.cause === error)', () => {
    const error = new Error('circular');
    (error as Error & { cause?: unknown }).cause = error;
    const copy = deepClone(error);
    expect(copy).not.toBe(error);
    expect(copy.message).toBe('circular');
    expect((copy as Error & { cause?: unknown }).cause).toBe(copy);
  });

  it('deep clones Error with custom cause (nested error)', () => {
    const cause = new TypeError('cause error');
    const error = new Error('main error', { cause });
    const copy = deepClone(error);
    expect(copy).not.toBe(error);
    expect(copy.message).toBe('main error');
    expect((copy as Error & { cause?: unknown }).cause).not.toBe(cause);
    expect(((copy as Error & { cause?: unknown }).cause as Error).message).toBe('cause error');
  });

  it('does not pollute prototype via __proto__ key', () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}') as Record<
      string,
      unknown
    >;
    const copy = deepClone(malicious);
    expect(copy.safe).toBe(1);
    expect((copy as Record<string, unknown>).polluted).toBeUndefined();
    // Object.prototype must not be polluted
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('preserves sparse array holes', () => {
    // biome-ignore lint/suspicious/noSparseArray: intentionally testing sparse array behavior
    const sparse = [1, , 3] as unknown[];
    const copy = deepClone(sparse);
    expect(copy).toHaveLength(3);
    expect(0 in copy).toBe(true);
    expect(1 in copy).toBe(false); // hole preserved
    expect(2 in copy).toBe(true);
    expect(copy[0]).toBe(1);
    expect(copy[2]).toBe(3);
  });
});

describe('deepClone fallback (without native structuredClone)', () => {
  const originalStructuredClone = globalThis.structuredClone;

  beforeEach(() => {
    // @ts-expect-error — intentionally removing structuredClone for fallback testing
    globalThis.structuredClone = undefined;
  });

  afterEach(() => {
    globalThis.structuredClone = originalStructuredClone;
  });

  it('falls back to recursive clone for plain objects', () => {
    const obj = { a: 1, nested: { b: 2 } };
    const copy = deepClone(obj);
    expect(copy).toEqual(obj);
    expect(copy).not.toBe(obj);
    expect(copy.nested).not.toBe(obj.nested);
  });

  it('falls back to recursive clone for circular references', () => {
    const obj: { a: number; self?: unknown } = { a: 1 };
    obj.self = obj;
    const copy = deepClone(obj);
    expect(copy.self).toBe(copy);
  });

  it('falls back to recursive clone for Date', () => {
    const obj = { d: new Date('2024-06-01') };
    const copy = deepClone(obj);
    expect(copy.d).toEqual(obj.d);
    expect(copy.d).not.toBe(obj.d);
  });

  it('falls back to recursive clone for Map', () => {
    const obj = { m: new Map([['k', 'v']]) };
    const copy = deepClone(obj);
    expect(copy.m.get('k')).toBe('v');
  });

  it('falls back to recursive clone for Set', () => {
    const obj = { s: new Set([1, 2]) };
    const copy = deepClone(obj);
    expect(copy.s.has(2)).toBe(true);
  });

  it('falls back to recursive clone for ArrayBuffer', () => {
    const buffer = new ArrayBuffer(2);
    new Uint8Array(buffer).set([5, 10]);
    const copy = deepClone(buffer);
    expect(copy).not.toBe(buffer);
    expect(new Uint8Array(copy)).toEqual(new Uint8Array(buffer));
  });

  it('falls back to recursive clone for Uint8Array', () => {
    const arr = new Uint8Array([1, 2, 3]);
    const copy = deepClone(arr);
    expect(copy).toEqual(arr);
    expect(copy.buffer).not.toBe(arr.buffer);
  });

  it('falls back to recursive clone for Error', () => {
    const err = new Error('fail');
    const copy = deepClone(err);
    expect(copy.message).toBe('fail');
    expect(copy.name).toBe('Error');
  });

  it('falls back and preserves function reference', () => {
    const fn = () => 42;
    const copy = deepClone(fn);
    expect(copy).toBe(fn);
  });

  it('fallback: replaces symbol values with undefined', () => {
    const sym = Symbol('test');
    const obj = { sym, other: 'ok' };
    const copy = deepClone(obj);
    expect(copy.sym).toBeUndefined();
    expect(copy.other).toBe('ok');
  });

  it('fallback: returns empty WeakMap instance', () => {
    const wm = new WeakMap();
    const copy = deepClone(wm);
    expect(copy).toBeInstanceOf(WeakMap);
    expect(copy).not.toBe(wm);
  });

  it('fallback: returns empty WeakSet instance', () => {
    const ws = new WeakSet();
    const copy = deepClone(ws);
    expect(copy).toBeInstanceOf(WeakSet);
    expect(copy).not.toBe(ws);
  });

  it('fallback: deep clones BigInt wrapper', () => {
    const obj = { value: Object(BigInt(99)) };
    const copy = deepClone(obj);
    expect(copy.value.valueOf()).toBe(BigInt(99));
    expect(copy.value).not.toBe(obj.value);
  });

  it('fallback: clones Error with object cause (recursive clone of cause)', () => {
    const cause = { reason: 'network', code: 500 };
    const err = new Error('request failed');
    (err as Error & { cause?: unknown }).cause = cause;
    const copy = deepClone(err);
    expect(copy.message).toBe('request failed');
    const copyCause = (copy as Error & { cause?: unknown }).cause as typeof cause;
    expect(copyCause).toEqual(cause);
    expect(copyCause).not.toBe(cause);
  });

  it('fallback: clones Error with primitive cause (string)', () => {
    const err = new Error('bad state');
    (err as Error & { cause?: unknown }).cause = 'timeout';
    const copy = deepClone(err);
    expect(copy.message).toBe('bad state');
    expect((copy as Error & { cause?: unknown }).cause).toBe('timeout');
  });

  it('fallback: clones DataView', () => {
    const buffer = new ArrayBuffer(8);
    new Uint8Array(buffer).set([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = new DataView(buffer, 2, 4);
    const copy = deepClone(view);
    expect(copy).toBeInstanceOf(DataView);
    expect(copy.byteLength).toBe(4);
    expect(copy.buffer).not.toBe(buffer);
    expect(copy.getUint8(0)).toBe(3);
  });

  it('fallback: clones Boolean wrapper object', () => {
    const obj = Object(true);
    const copy = deepClone(obj);
    expect(copy.valueOf()).toBe(true);
    expect(copy).not.toBe(obj);
  });

  it('fallback: clones Number wrapper object', () => {
    const obj = Object(42);
    const copy = deepClone(obj);
    expect(copy.valueOf()).toBe(42);
    expect(copy).not.toBe(obj);
  });

  it('fallback: clones String wrapper object', () => {
    const obj = Object('hello');
    const copy = deepClone(obj);
    expect(copy.valueOf()).toBe('hello');
    expect(copy).not.toBe(obj);
  });

  it('fallback: clones Error with custom enumerable properties', () => {
    const err = new Error('bad input');
    (err as Error & { code?: string; statusCode?: number }).code = 'INVALID';
    (err as Error & { code?: string; statusCode?: number }).statusCode = 400;
    const copy = deepClone(err);
    expect(copy.message).toBe('bad input');
    expect((copy as Error & { code?: string }).code).toBe('INVALID');
    expect((copy as Error & { statusCode?: number }).statusCode).toBe(400);
  });

  it('fallback: deep clones Array values', () => {
    const arr = [1, 'hello', { x: 42 }];
    const copy = deepClone(arr);
    expect(copy).not.toBe(arr);
    expect(copy).toEqual(arr);
    expect(copy[2]).not.toBe(arr[2]);
  });

  it('fallback: preserves sparse array holes in Array case', () => {
    // biome-ignore lint/suspicious/noSparseArray: intentionally testing sparse array behavior
    const sparse = [10, , 30] as unknown[];
    const copy = deepClone(sparse);
    expect(copy).toHaveLength(3);
    expect(0 in copy).toBe(true);
    expect(1 in copy).toBe(false);
    expect(2 in copy).toBe(true);
    expect(copy[0]).toBe(10);
    expect(copy[2]).toBe(30);
  });

  it('fallback: deep clones RegExp', () => {
    const re = /foo\d+/gi;
    const copy = deepClone(re);
    expect(copy).not.toBe(re);
    expect(copy.source).toBe('foo\\d+');
    expect(copy.flags).toBe('gi');
  });

  it('fallback: returns same reference for SharedArrayBuffer', () => {
    const sab = new SharedArrayBuffer(4);
    const copy = deepClone(sab);
    expect(copy).toBe(sab);
  });

  it('fallback: clones TypedArray backed by SharedArrayBuffer (non-ArrayBuffer path)', () => {
    const sab = new SharedArrayBuffer(4);
    const view = new Uint8Array(sab);
    view[0] = 7;
    view[1] = 8;
    const copy = deepClone(view);
    expect(copy).toBeInstanceOf(Uint8Array);
    expect(copy[0]).toBe(7);
    expect(copy[1]).toBe(8);
  });

  it('fallback: clones DataView backed by SharedArrayBuffer (non-ArrayBuffer path)', () => {
    const sab = new SharedArrayBuffer(4);
    const view = new DataView(sab);
    view.setUint8(0, 42);
    const copy = deepClone(view);
    expect(copy).toBeInstanceOf(DataView);
    expect(copy.getUint8(0)).toBe(42);
  });
});
