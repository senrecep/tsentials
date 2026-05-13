import { Ord } from '../../src/ord/index.js';

describe('Ord.number', () => {
  it('compares numbers', () => {
    expect(Ord.number.compare(1, 2)).toBe(-1);
    expect(Ord.number.compare(2, 1)).toBe(1);
    expect(Ord.number.compare(1, 1)).toBe(0);
  });
});

describe('Ord.string', () => {
  it('compares strings lexicographically', () => {
    expect(Ord.string.compare('a', 'b')).toBe(-1);
    expect(Ord.string.compare('b', 'a')).toBe(1);
    expect(Ord.string.compare('a', 'a')).toBe(0);
  });
});

describe('Ord.boolean', () => {
  it('compares booleans (false < true)', () => {
    expect(Ord.boolean.compare(false, true)).toBe(-1);
    expect(Ord.boolean.compare(true, false)).toBe(1);
    expect(Ord.boolean.compare(false, false)).toBe(0);
  });
});

describe('Ord.date', () => {
  it('compares dates chronologically', () => {
    const d1 = new Date('2024-01-01');
    const d2 = new Date('2024-01-02');
    expect(Ord.date.compare(d1, d2)).toBe(-1);
    expect(Ord.date.compare(d2, d1)).toBe(1);
    expect(Ord.date.compare(d1, d1)).toBe(0);
  });
});

describe('Ord.reverse', () => {
  it('reverses ordering', () => {
    const desc = Ord.reverse(Ord.number);
    expect(desc.compare(1, 2)).toBe(1);
    expect(desc.compare(2, 1)).toBe(-1);
  });
});

describe('Ord.contramap', () => {
  it('derives Ord from projection', () => {
    interface User {
      readonly age: number;
    }
    const byAge = Ord.contramap(Ord.number, (u: User) => u.age);
    expect(byAge.compare({ age: 20 }, { age: 30 })).toBe(-1);
  });
});

describe('Ord.struct', () => {
  it('compares objects field-by-field', () => {
    interface Point {
      readonly x: number;
      readonly y: number;
    }
    const byPoint = Ord.struct<Point>({ x: Ord.number, y: Ord.number });
    expect(byPoint.compare({ x: 1, y: 2 }, { x: 2, y: 1 })).toBe(-1);
    expect(byPoint.compare({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(-1);
    expect(byPoint.compare({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(0);
  });
});

describe('Ord.sortBy', () => {
  it('sorts an array using an Ord', () => {
    const sorted = Ord.sortBy([3, 1, 4, 1, 5], Ord.number);
    expect(sorted).toEqual([1, 1, 3, 4, 5]);
  });
});

describe('Ord.min', () => {
  it('returns the lesser value', () => {
    expect(Ord.min(Ord.number, 1, 2)).toBe(1);
    expect(Ord.min(Ord.number, 2, 1)).toBe(1);
  });
});

describe('Ord.max', () => {
  it('returns the greater value', () => {
    expect(Ord.max(Ord.number, 1, 2)).toBe(2);
    expect(Ord.max(Ord.number, 2, 1)).toBe(2);
  });
});

describe('Ord.clamp', () => {
  it('clamps a value between bounds', () => {
    expect(Ord.clamp(Ord.number, 0, 10, -5)).toBe(0);
    expect(Ord.clamp(Ord.number, 0, 10, 15)).toBe(10);
    expect(Ord.clamp(Ord.number, 0, 10, 5)).toBe(5);
  });
});

describe('Ord.between', () => {
  it('checks if a value is between bounds (inclusive)', () => {
    expect(Ord.between(Ord.number, 0, 10, 5)).toBe(true);
    expect(Ord.between(Ord.number, 0, 10, 0)).toBe(true);
    expect(Ord.between(Ord.number, 0, 10, 10)).toBe(true);
    expect(Ord.between(Ord.number, 0, 10, -1)).toBe(false);
    expect(Ord.between(Ord.number, 0, 10, 11)).toBe(false);
  });
});
