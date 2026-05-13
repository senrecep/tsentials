import { Err } from '../../src/errors/app-error.js';
import { Result } from '../../src/result/result.js';
import { ResultAsync } from '../../src/result/result-async.js';

const err1 = Err.validation('Test.1', 'Error 1');
const err2 = Err.validation('Test.2', 'Error 2');

describe('Result.ap', () => {
  it('applies function inside Result to value inside Result', () => {
    const fn = Result.success((n: number) => n * 2);
    const val = Result.success(5);
    const result = Result.ap(fn, val);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(10);
  });

  it('collects errors when fn fails', () => {
    const fn = Result.failure<(n: number) => number>(err1);
    const val = Result.success(5);
    const result = Result.ap(fn, val);
    expect(result.ok).toBe(false);
  });

  it('collects errors when value fails', () => {
    const fn = Result.success((n: number) => n * 2);
    const val = Result.failure<number>(err1);
    const result = Result.ap(fn, val);
    expect(result.ok).toBe(false);
  });

  it('collects all errors when both fail', () => {
    const fn = Result.failure<(n: number) => number>(err1);
    const val = Result.failure<number>(err2);
    const result = Result.ap(fn, val);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });
});

describe('Result.partition', () => {
  it('separates successes and failures', () => {
    const { ok, err } = Result.partition([
      Result.success(1),
      Result.failure(err1),
      Result.success(3),
      Result.failure(err2),
    ]);
    expect(ok).toEqual([1, 3]);
    expect(err).toHaveLength(2);
  });

  it('returns empty arrays when input is empty', () => {
    const { ok, err } = Result.partition<number>([]);
    expect(ok).toEqual([]);
    expect(err).toEqual([]);
  });
});

describe('Result.sequence', () => {
  it('collects async Results into a single Result', async () => {
    const results = await Result.sequence([
      Promise.resolve(Result.success(1)),
      Promise.resolve(Result.success(2)),
    ]);
    expect(results.ok).toBe(true);
    if (results.ok) expect(results.value).toEqual([1, 2]);
  });

  it('collects all errors on failure', async () => {
    const results = await Result.sequence([
      Promise.resolve(Result.success(1)),
      Promise.resolve(Result.failure(err1)),
    ]);
    expect(results.ok).toBe(false);
  });
});

describe('ResultAsync.sequence', () => {
  it('collects ResultAsync items into ResultAsync array', async () => {
    const results = ResultAsync.sequence([ResultAsync.success(1), ResultAsync.success(2)]);
    const resolved = await results;
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.value).toEqual([1, 2]);
  });
});

describe('ResultAsync.partition', () => {
  it('partitions ResultAsync items', async () => {
    const { ok, err } = await ResultAsync.partition([
      ResultAsync.success(1),
      ResultAsync.failure(err1),
    ]);
    expect(ok).toEqual([1]);
    expect(err).toHaveLength(1);
  });
});
