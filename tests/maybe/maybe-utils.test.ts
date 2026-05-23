import { Maybe } from '../../src/maybe/maybe.js';
import { asMaybe, choose, tryFind, tryFirst, tryLast } from '../../src/maybe/maybe-utils.js';

describe('tryFirst', () => {
  it('returns Some for non-empty array', () => {
    const m = tryFirst([1, 2, 3]);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(1);
  });

  it('returns None for empty array', () => {
    const m = tryFirst([]);
    expect(m.hasValue).toBe(false);
  });

  it('returns first element for single-element array', () => {
    const m = tryFirst([42]);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(42);
  });

  it('returns first element for large array', () => {
    const m = tryFirst(Array.from({ length: 1000 }, (_, i) => i));
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(0);
  });

  it('returns Some for array with null/undefined elements', () => {
    const m = tryFirst([null, undefined, 1]);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBeNull();
  });
});

describe('tryLast', () => {
  it('returns Some with last element for non-empty array', () => {
    const m = tryLast([1, 2, 3]);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(3);
  });

  it('returns None for empty array', () => {
    const m = tryLast([]);
    expect(m.hasValue).toBe(false);
  });

  it('returns the only element for single-element array', () => {
    const m = tryLast([42]);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(42);
  });

  it('returns last element for large array', () => {
    const m = tryLast(Array.from({ length: 1000 }, (_, i) => i));
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(999);
  });
});

describe('tryFind', () => {
  it('returns Some when predicate matches', () => {
    const m = tryFind([1, 2, 3, 4], (n) => n > 2);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(3);
  });

  it('returns None when no match', () => {
    const m = tryFind([1, 2, 3], (n) => n > 10);
    expect(m.hasValue).toBe(false);
  });

  it('returns None for empty array', () => {
    const m = tryFind([], (_n: number) => true);
    expect(m.hasValue).toBe(false);
  });

  it('returns first match when multiple match', () => {
    const m = tryFind([1, 2, 3, 4, 5], (n) => n > 2);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(3);
  });

  it('returns match for first element', () => {
    const m = tryFind([10, 20, 30], (n) => n > 5);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(10);
  });

  it('returns match for last element', () => {
    const m = tryFind([1, 2, 3], (n) => n > 2);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(3);
  });

  it('returns None when predicate never matches', () => {
    const m = tryFind(['a', 'b', 'c'], (s) => s === 'z');
    expect(m.hasValue).toBe(false);
  });

  it('returns Some when predicate matches an undefined element', () => {
    const arr = [undefined, 1, 2] as Array<number | undefined>;
    const result = tryFind(arr, (v) => v === undefined);
    expect(Maybe.isSome(result)).toBe(true);
    expect(Maybe.getOrDefault(result, 'fallback' as unknown)).toBeUndefined();
  });

  it('returns None when predicate does not match', () => {
    const arr = [1, 2, 3];
    const result = tryFind(arr, (v) => v === 99);
    expect(Maybe.isNone(result)).toBe(true);
  });
});

describe('choose', () => {
  it('extracts Some values, drops None', () => {
    const result = choose([Maybe.some(1), Maybe.none<number>(), Maybe.some(2)]);
    expect(result).toEqual([1, 2]);
  });

  it('returns empty array for all-None input', () => {
    const result = choose([Maybe.none<number>(), Maybe.none<number>()]);
    expect(result).toEqual([]);
  });

  it('returns all values when all are Some', () => {
    const result = choose([Maybe.some('a'), Maybe.some('b')]);
    expect(result).toEqual(['a', 'b']);
  });

  it('returns empty array for empty input', () => {
    const result = choose([]);
    expect(result).toEqual([]);
  });

  it('preserves order', () => {
    const result = choose([
      Maybe.some(1),
      Maybe.none<number>(),
      Maybe.some(2),
      Maybe.none<number>(),
      Maybe.some(3),
    ]);
    expect(result).toEqual([1, 2, 3]);
  });

  it('handles mixed types (when typed)', () => {
    const result = choose([Maybe.some('hello'), Maybe.none<string>(), Maybe.some('world')]);
    expect(result).toEqual(['hello', 'world']);
  });
});

describe('asMaybe', () => {
  it('wraps non-null value', () => {
    const m = asMaybe(42);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(42);
  });

  it('returns None for null', () => {
    const m = asMaybe(null);
    expect(m.hasValue).toBe(false);
  });

  it('returns None for undefined', () => {
    const m = asMaybe(undefined);
    expect(m.hasValue).toBe(false);
  });

  it('wraps string value', () => {
    const m = asMaybe('hello');
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe('hello');
  });

  it('wraps zero value', () => {
    const m = asMaybe(0);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(0);
  });

  it('wraps false value', () => {
    const m = asMaybe(false);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(false);
  });

  it('wraps empty string', () => {
    const m = asMaybe('');
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe('');
  });

  it('returns None for empty array (empty array is truthy)', () => {
    const m = asMaybe([]);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toEqual([]);
  });
});
