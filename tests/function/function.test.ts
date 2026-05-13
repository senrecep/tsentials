import { constant, flip, flow, identity, pipe } from '../../src/function/index.js';

describe('pipe', () => {
  it('returns the initial value with no functions', () => {
    expect(pipe(42)).toBe(42);
  });

  it('threads a value through functions', () => {
    const result = pipe(
      5,
      (n) => n * 2,
      (n) => n + 1,
      (n) => String(n),
    );
    expect(result).toBe('11');
  });

  it('works with many steps', () => {
    const result = pipe(
      1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
    );
    expect(result).toBe(11);
  });
});

describe('flow', () => {
  it('composes functions left-to-right', () => {
    const fn = flow(
      (n: number) => n * 2,
      (n) => n + 1,
      (n) => String(n),
    );
    expect(fn(5)).toBe('11');
  });

  it('works with a single function', () => {
    const fn = flow((n: number) => n * 2);
    expect(fn(5)).toBe(10);
  });
});

describe('identity', () => {
  it('returns the argument unchanged', () => {
    expect(identity(42)).toBe(42);
    expect(identity('hello')).toBe('hello');
  });
});

describe('constant', () => {
  it('creates a function that always returns the same value', () => {
    const fn = constant(42);
    expect(fn()).toBe(42);
    expect(fn()).toBe(42);
  });
});

describe('flip', () => {
  it('reverses argument order', () => {
    const subtract = (a: number, b: number) => a - b;
    const flipped = flip(subtract);
    expect(flipped(3, 10)).toBe(7);
  });
});
