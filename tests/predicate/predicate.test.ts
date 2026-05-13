import { Predicate } from '../../src/predicate/index.js';

describe('Predicate.from', () => {
  it('creates a predicate from a boolean function', () => {
    const isEven = Predicate.from((n: number) => n % 2 === 0);
    expect(isEven.test(4)).toBe(true);
    expect(isEven.test(3)).toBe(false);
  });
});

describe('Predicate.and', () => {
  it('returns true only when both predicates pass', () => {
    const isPositive = Predicate.from((n: number) => n > 0);
    const isEven = Predicate.from((n: number) => n % 2 === 0);
    const combined = Predicate.and(isPositive, isEven);
    expect(combined.test(4)).toBe(true);
    expect(combined.test(-4)).toBe(false);
    expect(combined.test(3)).toBe(false);
  });
});

describe('Predicate.or', () => {
  it('returns true when at least one predicate passes', () => {
    const isPositive = Predicate.from((n: number) => n > 0);
    const isEven = Predicate.from((n: number) => n % 2 === 0);
    const combined = Predicate.or(isPositive, isEven);
    expect(combined.test(4)).toBe(true);
    expect(combined.test(-4)).toBe(true);
    expect(combined.test(-3)).toBe(false);
  });
});

describe('Predicate.not', () => {
  it('negates a predicate', () => {
    const isEven = Predicate.from((n: number) => n % 2 === 0);
    const isOdd = Predicate.not(isEven);
    expect(isOdd.test(3)).toBe(true);
    expect(isOdd.test(4)).toBe(false);
  });
});

describe('Predicate.all', () => {
  it('combines multiple predicates with AND', () => {
    const combined = Predicate.all(
      Predicate.from((n: number) => n > 0),
      Predicate.from((n: number) => n < 10),
      Predicate.from((n: number) => n % 2 === 0),
    );
    expect(combined.test(4)).toBe(true);
    expect(combined.test(12)).toBe(false);
  });
});

describe('Predicate.any', () => {
  it('combines multiple predicates with OR', () => {
    const combined = Predicate.any(
      Predicate.from((n: number) => n < 0),
      Predicate.from((n: number) => n > 10),
    );
    expect(combined.test(-1)).toBe(true);
    expect(combined.test(11)).toBe(true);
    expect(combined.test(5)).toBe(false);
  });
});

describe('Predicate.refinement', () => {
  it('creates a type guard predicate', () => {
    const isString = Predicate.refinement((x: unknown): x is string => typeof x === 'string');
    expect(isString.test('hello')).toBe(true);
    expect(isString.test(42)).toBe(false);
  });
});
