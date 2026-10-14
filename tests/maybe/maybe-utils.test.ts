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

  it('returns None when the first element is null (does not skip ahead)', () => {
    expect(tryFirst([null, undefined, 1]).hasValue).toBe(false);
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

  it('returns None when predicate matches an undefined element', () => {
    const arr = [undefined, 1, 2] as Array<number | undefined>;
    const result = tryFind(arr, (v) => v === undefined);
    expect(Maybe.isNone(result)).toBe(true);
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

describe('tryFirst / tryLast with a predicate', () => {
  it('tryFirst returns the first matching element', () => {
    expect(tryFirst([1, 2, 3, 4], (n) => n % 2 === 0)).toEqual(Maybe.some(2));
  });

  it('tryFirst returns None when nothing matches', () => {
    expect(tryFirst([1, 3], (n) => n % 2 === 0).hasValue).toBe(false);
  });

  it('tryFirst returns None when the first match is null', () => {
    const arr: Array<number | null> = [1, null, 4];
    expect(tryFirst(arr, (n) => n !== 1).hasValue).toBe(false);
  });

  it('tryLast returns the last matching element', () => {
    expect(tryLast([1, 2, 3, 4], (n) => n % 2 === 1)).toEqual(Maybe.some(3));
  });

  it('tryLast returns None when nothing matches or the array is empty', () => {
    expect(tryLast([1, 3], (n) => n > 5).hasValue).toBe(false);
    expect(tryLast([] as number[], () => true).hasValue).toBe(false);
  });

  it('tryLast returns None when the last element / last match is undefined', () => {
    expect(tryLast([1, undefined]).hasValue).toBe(false);
    const arr: Array<number | undefined> = [1, 2, undefined];
    expect(tryLast(arr, (n) => n !== 1).hasValue).toBe(false);
  });

  it('stops calling the predicate after the first match', () => {
    const seen: number[] = [];
    tryFirst([1, 2, 3], (n) => {
      seen.push(n);
      return n === 2;
    });
    expect(seen).toEqual([1, 2]);
  });
});

describe('tryFind on a Map or record', () => {
  it('finds a Map value by key', () => {
    const map = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    expect(tryFind(map, 'b')).toEqual(Maybe.some(2));
    expect(tryFind(map, 'c').hasValue).toBe(false);
  });

  it('a Map entry holding null/undefined is None', () => {
    const map = new Map<string, number | null | undefined>([
      ['n', null],
      ['u', undefined],
    ]);
    expect(tryFind(map, 'n').hasValue).toBe(false);
    expect(tryFind(map, 'u').hasValue).toBe(false);
  });

  it('finds a record value by own key', () => {
    const rec: Record<string, number> = { a: 1, b: 0 };
    expect(tryFind(rec, 'a')).toEqual(Maybe.some(1));
    expect(tryFind(rec, 'b')).toEqual(Maybe.some(0));
    expect(tryFind(rec, 'z').hasValue).toBe(false);
  });

  it('ignores inherited record keys and treats null values as None', () => {
    const rec: Record<string, string | null> = { n: null };
    expect(tryFind(rec, 'toString').hasValue).toBe(false);
    expect(tryFind(rec, 'n').hasValue).toBe(false);
  });

  it('works with a null-prototype record', () => {
    const rec = Object.assign(Object.create(null) as Record<string, number>, { x: 5 });
    expect(tryFind(rec, 'x')).toEqual(Maybe.some(5));
  });
});

describe('choose with a selector', () => {
  it('maps each element and keeps only the Some values, in order', () => {
    const users = [{ email: 'a@x' }, { email: null }, { email: 'c@x' }];
    expect(choose(users, (u) => Maybe.from(u.email))).toEqual(['a@x', 'c@x']);
  });

  it('returns an empty array when every selection is None', () => {
    expect(choose([1, 2], () => Maybe.none<number>())).toEqual([]);
  });
});
