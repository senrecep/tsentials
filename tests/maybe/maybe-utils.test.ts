import { tryFirst, tryLast, tryFind, choose, asMaybe } from '../../src/maybe/maybe-utils.js';
import { Maybe } from '../../src/maybe/maybe.js';

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
});

describe('tryFind', () => {
  it('returns Some when predicate matches', () => {
    const m = tryFind([1, 2, 3, 4], n => n > 2);
    expect(m.hasValue).toBe(true);
    if (m.hasValue) expect(m.value).toBe(3);
  });

  it('returns None when no match', () => {
    const m = tryFind([1, 2, 3], n => n > 10);
    expect(m.hasValue).toBe(false);
  });

  it('returns None for empty array', () => {
    const m = tryFind([], (_n: number) => true);
    expect(m.hasValue).toBe(false);
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
});
