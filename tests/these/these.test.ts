import { Err } from '../../src/errors/app-error.js';
import { Result } from '../../src/result/result.js';
import { These } from '../../src/these/index.js';

const err1 = Err.validation('Test.1', 'Error 1');
const err2 = Err.validation('Test.2', 'Error 2');

describe('These constructors', () => {
  it('creates a Left', () => {
    const t = These.left(err1);
    expect(These.isLeft(t)).toBe(true);
    expect(These.isRight(t)).toBe(false);
    expect(These.isBoth(t)).toBe(false);
  });

  it('creates a Right', () => {
    const t = These.right(42);
    expect(These.isLeft(t)).toBe(false);
    expect(These.isRight(t)).toBe(true);
    expect(These.isBoth(t)).toBe(false);
  });

  it('creates a Both', () => {
    const t = These.both(err1, 42);
    expect(These.isLeft(t)).toBe(false);
    expect(These.isRight(t)).toBe(false);
    expect(These.isBoth(t)).toBe(true);
  });
});

describe('These.map', () => {
  it('maps over Right', () => {
    const t = These.map(These.right(5), (n) => n * 2);
    expect(These.isRight(t)).toBe(true);
    if (These.isRight(t)) expect(t.right).toBe(10);
  });

  it('maps over Both preserving error', () => {
    const t = These.map(These.both(err1, 5), (n) => n * 2);
    expect(These.isBoth(t)).toBe(true);
    if (These.isBoth(t)) {
      expect(t.right).toBe(10);
      expect(t.left).toBe(err1);
    }
  });

  it('passes through Left', () => {
    const t = These.map(These.left(err1), (n: number) => n * 2);
    expect(These.isLeft(t)).toBe(true);
  });
});

describe('These.mapLeft', () => {
  it('maps over Left', () => {
    const t = These.mapLeft(These.left(err1), () => err2);
    expect(These.isLeft(t)).toBe(true);
    if (These.isLeft(t)) expect(t.left).toBe(err2);
  });

  it('passes through Right', () => {
    const t = These.mapLeft(These.right(42), () => err2);
    expect(These.isRight(t)).toBe(true);
  });
});

describe('These.flatMap', () => {
  it('chains over Right', () => {
    const t = These.flatMap(These.right(5), (n) => These.right(n * 2));
    expect(These.isRight(t)).toBe(true);
    if (These.isRight(t)) expect(t.right).toBe(10);
  });

  it('chains Both with Right', () => {
    const t = These.flatMap(These.both(err1, 5), (n) => These.right(n * 2));
    expect(These.isBoth(t)).toBe(true);
    if (These.isBoth(t)) expect(t.right).toBe(10);
  });
});

describe('These.match', () => {
  it('exhaustively matches all variants', () => {
    expect(
      These.match(
        These.left(err1),
        () => 'L',
        () => 'R',
        () => 'B',
      ),
    ).toBe('L');
    expect(
      These.match(
        These.right(42),
        () => 'L',
        () => 'R',
        () => 'B',
      ),
    ).toBe('R');
    expect(
      These.match(
        These.both(err1, 42),
        () => 'L',
        () => 'R',
        () => 'B',
      ),
    ).toBe('B');
  });
});

describe('These.getRight / getLeft', () => {
  it('getRight returns value for Right and Both', () => {
    expect(These.getRight(These.right(42))).toBe(42);
    expect(These.getRight(These.both(err1, 42))).toBe(42);
    expect(These.getRight(These.left(err1))).toBeUndefined();
  });

  it('getLeft returns error for Left and Both', () => {
    expect(These.getLeft(These.left(err1))).toBe(err1);
    expect(These.getLeft(These.both(err1, 42))).toBe(err1);
    expect(These.getLeft(These.right(42))).toBeUndefined();
  });
});

describe('These.toResult', () => {
  it('converts Right to success', () => {
    const r = These.toResult(These.right(42));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('converts Left to failure', () => {
    const r = These.toResult(These.left([err1]));
    expect(r.ok).toBe(false);
  });

  it('converts Both to failure', () => {
    const r = These.toResult(These.both([err1], 42));
    expect(r.ok).toBe(false);
  });
});

describe('These.toResultLenient', () => {
  it('converts Both to success', () => {
    const r = These.toResultLenient(These.both([err1], 42));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });
});

describe('These.fromResult', () => {
  it('converts success to Right', () => {
    const t = These.fromResult(Result.success(42));
    expect(These.isRight(t)).toBe(true);
  });

  it('converts failure to Left', () => {
    const t = These.fromResult(Result.failure(err1));
    expect(These.isLeft(t)).toBe(true);
  });
});

describe('These.partition', () => {
  it('partitions an array of These', () => {
    const { lefts, rights, boths } = These.partition([
      These.left(err1),
      These.right(1),
      These.both(err2, 2),
    ]);
    expect(lefts).toHaveLength(1);
    expect(rights).toHaveLength(1);
    expect(boths).toHaveLength(1);
    expect(boths[0].value).toBe(2);
  });
});
