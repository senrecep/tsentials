import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { deepClone } from '../../src/clone/index.js';

describe('deepClone vs structuredClone', () => {
  const buf = new ArrayBuffer(8);
  const circ: Record<string, unknown> = { a: 1 };
  circ.self = circ;
  const shared = { s: 1 };
  const sparse: number[] = [];
  sparse[0] = 1;
  sparse[2] = 3;
  const re = /a/gi;
  re.lastIndex = 3;

  const cases: Record<string, unknown> = {
    plain: { a: [1, { b: 2 }], u: undefined },
    circular: circ,
    sharedRefs: { a: shared, b: shared },
    sparse,
    negZero: -0,
    bigintWrapper: Object(10n),
    invalidDate: new Date(Number.NaN),
    regex: re,
    mapObjKey: new Map([[{ k: 1 }, { v: 1 }]]),
    set: new Set([{ a: 1 }]),
    typedView: new Uint8Array(buf, 2, 4),
    dataView: new DataView(buf, 1, 4),
    frozen: Object.freeze({ f: 1 }),
    numberWrapper: Object(5),
  };

  for (const [name, input] of Object.entries(cases)) {
    it(`matches native for ${name}`, () => {
      // toStrictEqual: prototypes, undefined-valued keys and sparse holes must match too
      expect(deepClone(input)).toStrictEqual(structuredClone(input));
    });
  }

  it('preserves shared references like native', () => {
    const out = deepClone({ a: shared, b: shared });
    expect(out.a).toBe(out.b);
    expect(out.a).not.toBe(shared);
  });

  it('keeps views over one buffer sharing one cloned buffer', () => {
    const b = new ArrayBuffer(8);
    const out = deepClone({ a: new Uint8Array(b, 0, 4), c: new Uint8Array(b) });
    expect(out.a.buffer).toBe(out.c.buffer);
    expect(out.a.buffer).not.toBe(b);
  });

  it('preserves lastIndex-independent regex source/flags and sparse holes', () => {
    expect(1 in deepClone(sparse)).toBe(false);
    expect(deepClone(re).flags).toBe('gi');
  });
});

describe('deepClone intentional divergences', () => {
  it('copies non-index array properties', () => {
    const arr = Object.assign([1, 2], { extra: 'x' });
    expect((deepClone(arr) as unknown as { extra: string }).extra).toBe('x');
  });

  it('preserves Error subclass, name, code, stack, cause', () => {
    class MyErr extends Error {
      constructor(
        public readonly code: string,
        public readonly detail: { n: number },
      ) {
        super(`custom ${code}`);
        this.name = 'MyErr';
      }
    }
    const err = new MyErr('E1', { n: 1 });
    (err as Error).cause = { c: 1 };
    const out = deepClone(err);
    expect(out).toBeInstanceOf(MyErr);
    expect(out).not.toBe(err);
    expect(out.name).toBe('MyErr');
    expect(out.message).toBe('custom E1');
    expect(out.code).toBe('E1');
    expect(out.detail).toEqual({ n: 1 });
    expect(out.detail).not.toBe(err.detail);
    expect(out.stack).toBe(err.stack);
    expect(out.cause).toEqual({ c: 1 });
  });

  it('preserves AggregateError.errors', () => {
    const agg = new AggregateError([new Error('a'), new TypeError('b')], 'multi');
    const out = deepClone(agg);
    expect(out).toBeInstanceOf(AggregateError);
    expect(out.errors).toHaveLength(2);
    expect(out.errors[1]).toBeInstanceOf(TypeError);
    expect(out.errors[0]).not.toBe(agg.errors[0]);
  });

  it('clones URL and URLSearchParams', () => {
    const u = new URL('http://a.b/c?x=1');
    const out = deepClone(u);
    expect(out).toBeInstanceOf(URL);
    expect(out).not.toBe(u);
    expect(out.href).toBe(u.href);
    expect(deepClone(new URLSearchParams('a=1&b=2')).get('b')).toBe('2');
  });

  it('returns Blob, Promise and functions by reference', () => {
    const blob = new Blob(['x']);
    const p = Promise.resolve(1);
    const fn = () => 1;
    expect(deepClone(blob)).toBe(blob);
    expect(deepClone(p)).toBe(p);
    expect(deepClone({ fn }).fn).toBe(fn);
  });

  it('never calls native structuredClone', () => {
    const original = globalThis.structuredClone;
    globalThis.structuredClone = (() => {
      throw new Error('native used');
    }) as typeof structuredClone;
    try {
      expect(deepClone({ a: 1 })).toStrictEqual({ a: 1 });
    } finally {
      globalThis.structuredClone = original;
    }
  });
});

describe('deepClone dispatch is not spoofable', () => {
  it('treats a plain object tagged "Map" as a plain object (no throw)', () => {
    const fake = { [Symbol.toStringTag]: 'Map', a: 1 };
    expect(Object.prototype.toString.call(fake)).toBe('[object Map]');
    const out = deepClone(fake);
    expect(out).not.toBeInstanceOf(Map);
    expect(out).toStrictEqual({ a: 1 });
  });

  it('treats a plain object tagged "Array" as a plain object (no corruption)', () => {
    const fake = { [Symbol.toStringTag]: 'Array', length: 2, 0: 'x', extra: { y: 1 } };
    const out = deepClone(fake);
    expect(Array.isArray(out)).toBe(false);
    expect(out).toStrictEqual({ 0: 'x', length: 2, extra: { y: 1 } });
    expect(out.extra).not.toBe(fake.extra);
  });

  it('treats tagged Date / Set / RegExp / ArrayBuffer impostors as plain objects', () => {
    for (const tag of ['Date', 'Set', 'RegExp', 'ArrayBuffer', 'WeakMap', 'URL', 'Number']) {
      const out = deepClone({ [Symbol.toStringTag]: tag, v: 1 });
      expect(out).toStrictEqual({ v: 1 });
    }
  });

  it('treats Object.create(Map.prototype) as a plain object (no throw)', () => {
    const fake = Object.create(Map.prototype) as Map<unknown, unknown>;
    expect(fake).toBeInstanceOf(Map);
    expect(() => deepClone(fake)).not.toThrow();
    expect(deepClone(fake)).not.toBeInstanceOf(Map);
  });

  it('clones a real Map / array even when its toStringTag is overridden', () => {
    const map = new Map([['k', { v: 1 }]]);
    Object.defineProperty(map, Symbol.toStringTag, { value: 'Other' });
    const outMap = deepClone(map);
    expect(outMap).toBeInstanceOf(Map);
    expect(outMap.get('k')).toStrictEqual({ v: 1 });
    expect(outMap.get('k')).not.toBe(map.get('k'));

    const arr = [1, { a: 2 }];
    Object.defineProperty(arr, Symbol.toStringTag, { value: 'Object' });
    const outArr = deepClone(arr);
    expect(Array.isArray(outArr)).toBe(true);
    expect(outArr).toHaveLength(2);
  });

  it('still recognises built-ins from another realm', () => {
    const foreign = runInNewContext(
      '({ d: new Date(5), m: new Map([[1, { a: 1 }]]), s: new Set([2]), r: /x/g, a: [1, 2], b: new ArrayBuffer(4) })',
    ) as {
      d: Date;
      m: Map<number, unknown>;
      s: Set<number>;
      r: RegExp;
      a: number[];
      b: ArrayBuffer;
    };
    const out = deepClone(foreign);
    expect(out.d).toBeInstanceOf(Date);
    expect(out.d.getTime()).toBe(5);
    expect(out.m).toBeInstanceOf(Map);
    expect(out.m.get(1)).toEqual({ a: 1 });
    expect(out.s).toBeInstanceOf(Set);
    expect(out.s.has(2)).toBe(true);
    expect(out.r).toBeInstanceOf(RegExp);
    expect(out.r.flags).toBe('g');
    expect(Array.isArray(out.a)).toBe(true);
    expect(out.b).toBeInstanceOf(ArrayBuffer);
    expect(out.b.byteLength).toBe(4);
  });
});
