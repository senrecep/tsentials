import { NonEmptyArray } from '../../src/array/index.js';
import { Maybe } from '../../src/maybe/index.js';

describe('NonEmptyArray.isNonEmpty', () => {
  it('returns false for empty arrays', () => {
    expect(NonEmptyArray.isNonEmpty([])).toBe(false);
  });

  it('returns true for non-empty arrays', () => {
    expect(NonEmptyArray.isNonEmpty([1])).toBe(true);
    expect(NonEmptyArray.isNonEmpty([1, 2, 3])).toBe(true);
  });
});

describe('NonEmptyArray.prepend', () => {
  it('prepends an element', () => {
    const result = NonEmptyArray.prepend(1, [2, 3]);
    expect(result).toEqual([1, 2, 3]);
    expect(result[0]).toBe(1);
  });
});

describe('NonEmptyArray.append', () => {
  it('appends an element', () => {
    const result = NonEmptyArray.append([1, 2], 3);
    expect(result).toEqual([1, 2, 3]);
  });
});

describe('NonEmptyArray.head', () => {
  it('returns the first element', () => {
    expect(NonEmptyArray.head([1, 2, 3])).toBe(1);
  });
});

describe('NonEmptyArray.tail', () => {
  it('returns elements after the first', () => {
    expect(NonEmptyArray.tail([1, 2, 3])).toEqual([2, 3]);
  });
});

describe('NonEmptyArray.last', () => {
  it('returns the last element', () => {
    expect(NonEmptyArray.last([1, 2, 3])).toBe(3);
  });
});

describe('NonEmptyArray.init', () => {
  it('returns all but the last', () => {
    expect(NonEmptyArray.init([1, 2, 3])).toEqual([1, 2]);
  });
});

describe('NonEmptyArray.asNonEmptyArray', () => {
  it('returns None for empty array', () => {
    const result = NonEmptyArray.asNonEmptyArray([]);
    expect(Maybe.isNone(result)).toBe(true);
  });

  it('returns Some for non-empty array', () => {
    const result = NonEmptyArray.asNonEmptyArray([1, 2]);
    expect(Maybe.isSome(result)).toBe(true);
    if (Maybe.isSome(result)) expect(result.value).toEqual([1, 2]);
  });
});

describe('NonEmptyArray.map', () => {
  it('maps over values preserving non-empty', () => {
    const result = NonEmptyArray.map([1, 2, 3], (n) => n * 2);
    expect(result).toEqual([2, 4, 6]);
    expect(NonEmptyArray.isNonEmpty(result)).toBe(true);
  });
});

describe('NonEmptyArray.filter', () => {
  it('filters values, result may be empty', () => {
    const result = NonEmptyArray.filter([1, 2, 3], (n) => n > 2);
    expect(result).toEqual([3]);
  });
});

describe('NonEmptyArray.reverse', () => {
  it('reverses preserving non-empty', () => {
    const result = NonEmptyArray.reverse([1, 2, 3]);
    expect(result).toEqual([3, 2, 1]);
    expect(NonEmptyArray.isNonEmpty(result)).toBe(true);
  });
});

describe('NonEmptyArray.sort', () => {
  it('sorts preserving non-empty', () => {
    const result = NonEmptyArray.sort([3, 1, 2], (a, b) => a - b);
    expect(result).toEqual([1, 2, 3]);
    expect(NonEmptyArray.isNonEmpty(result)).toBe(true);
  });
});
