import { Result } from '../../src/result/result.js';
import { ResultAsync, fromAsync } from '../../src/result/result-async.js';
import { Err } from '../../src/errors/app-error.js';

const err = Err.validation('Test.Invalid', 'invalid');
const notFound = Err.notFound('Test.NotFound', 'not found');

// Helpers
const okAsync = <T>(value: T) => Promise.resolve(Result.success(value));
const failAsync = <T>(e = err) => Promise.resolve(Result.failure<T>(e));

describe('ResultAsync factories', () => {
  it('from wraps Promise<Result<T>>', async () => {
    const r = await ResultAsync.from(okAsync(42));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('success creates resolved success', async () => {
    const r = await ResultAsync.success('hello');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('hello');
  });

  it('ok creates resolved void success', async () => {
    const r = await ResultAsync.ok();
    expect(r.ok).toBe(true);
  });

  it('failure creates resolved failure', async () => {
    const r = await ResultAsync.failure(err);
    expect(r.ok).toBe(false);
  });

  it('fromResult lifts sync Result', async () => {
    const r = await ResultAsync.fromResult(Result.success(99));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(99);
  });

  it('try wraps async throwing function', async () => {
    const r = await ResultAsync.try(async () => JSON.parse('{"x":1}') as unknown);
    expect(r.ok).toBe(true);
  });

  it('try catches async throws', async () => {
    const r = await ResultAsync.try(async () => { throw new Error('boom'); });
    expect(r.ok).toBe(false);
  });

  it('fromThrowable creates reusable safe wrapper', async () => {
    const safeDouble = ResultAsync.fromThrowable(async (n: number) => {
      if (n < 0) throw new Error('negative');
      return n * 2;
    });
    const ok = await safeDouble(5);
    const fail = await safeDouble(-1);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value).toBe(10);
    expect(fail.ok).toBe(false);
  });
});

describe('ResultAsync PromiseLike (direct await)', () => {
  it('can be awaited to get Result<T>', async () => {
    const result: Result<number> = await ResultAsync.success(7);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(7);
  });

  it('can be awaited to get failure Result', async () => {
    const result = await ResultAsync.failure<number>(err);
    expect(result.ok).toBe(false);
  });
});

describe('ResultAsync.andThen', () => {
  it('chains on success with Result<U>', async () => {
    const r = await fromAsync(okAsync(5))
      .andThen(n => Result.success(n * 2));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10);
  });

  it('chains on success with ResultAsync<U>', async () => {
    const r = await fromAsync(okAsync(5))
      .andThen(n => ResultAsync.success(n + 1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(6);
  });

  it('chains on success with Promise<Result<U>>', async () => {
    const r = await fromAsync(okAsync(3))
      .andThen(n => okAsync(n * 10));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(30);
  });

  it('short-circuits on failure', async () => {
    const called: boolean[] = [];
    const r = await fromAsync(failAsync<number>())
      .andThen(n => { called.push(true); return Result.success(n); });
    expect(r.ok).toBe(false);
    expect(called).toHaveLength(0);
  });

  it('propagates failure from chained fn', async () => {
    const r = await fromAsync(okAsync(5))
      .andThen(() => Result.failure<number>(notFound));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('Test.NotFound');
  });
});

describe('ResultAsync.map', () => {
  it('transforms success value (sync fn)', async () => {
    const r = await fromAsync(okAsync('hello')).map(s => s.toUpperCase());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('HELLO');
  });

  it('transforms success value (async fn)', async () => {
    const r = await fromAsync(okAsync(4)).map(async n => n * n);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(16);
  });

  it('passes through failure', async () => {
    const r = await fromAsync(failAsync<string>()).map(s => s.toUpperCase());
    expect(r.ok).toBe(false);
  });
});

describe('ResultAsync.ensure', () => {
  it('passes when sync predicate is true', async () => {
    const r = await fromAsync(okAsync(10)).ensure(n => n > 5, err);
    expect(r.ok).toBe(true);
  });

  it('fails when sync predicate is false', async () => {
    const r = await fromAsync(okAsync(3)).ensure(n => n > 5, err);
    expect(r.ok).toBe(false);
  });

  it('passes when async predicate resolves true', async () => {
    const r = await fromAsync(okAsync(10)).ensure(async n => n > 5, err);
    expect(r.ok).toBe(true);
  });

  it('fails when async predicate resolves false', async () => {
    const r = await fromAsync(okAsync(3)).ensure(async n => n > 5, err);
    expect(r.ok).toBe(false);
  });

  it('short-circuits on existing failure', async () => {
    const called: boolean[] = [];
    const r = await fromAsync(failAsync<number>())
      .ensure(n => { called.push(true); return n > 0; }, err);
    expect(r.ok).toBe(false);
    expect(called).toHaveLength(0);
  });
});

describe('ResultAsync.tap', () => {
  it('runs sync effect on success', async () => {
    const seen: number[] = [];
    const r = await fromAsync(okAsync(7)).tap(n => { seen.push(n); });
    expect(r.ok).toBe(true);
    expect(seen).toEqual([7]);
  });

  it('runs async effect on success', async () => {
    const seen: number[] = [];
    const r = await fromAsync(okAsync(7)).tap(async n => { seen.push(n); });
    expect(seen).toEqual([7]);
  });

  it('skips effect on failure', async () => {
    const seen: number[] = [];
    await fromAsync(failAsync<number>()).tap(n => { seen.push(n); });
    expect(seen).toHaveLength(0);
  });
});

describe('ResultAsync.tapError', () => {
  it('runs on failure', async () => {
    const seen: string[] = [];
    await fromAsync(failAsync()).tapError(async errs => { seen.push(errs[0]!.code); });
    expect(seen).toEqual(['Test.Invalid']);
  });

  it('skips on success', async () => {
    const seen: string[] = [];
    await fromAsync(okAsync(1)).tapError(async errs => { seen.push(errs[0]!.code); });
    expect(seen).toHaveLength(0);
  });
});

describe('ResultAsync.mapError', () => {
  it('transforms errors on failure', async () => {
    const r = await fromAsync(failAsync())
      .mapError(errs => errs.map(e => ({ ...e, code: `X.${e.code}` })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('X.Test.Invalid');
  });

  it('passes through success', async () => {
    const r = await fromAsync(okAsync(1)).mapError(errs => errs);
    expect(r.ok).toBe(true);
  });
});

describe('ResultAsync.compensate', () => {
  it('recovers with Result<T>', async () => {
    const r = await fromAsync(failAsync<number>())
      .compensate(() => Result.success(99));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(99);
  });

  it('recovers with ResultAsync<T>', async () => {
    const r = await fromAsync(failAsync<number>())
      .compensate(() => ResultAsync.success(88));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(88);
  });

  it('passes through success', async () => {
    const r = await fromAsync(okAsync(5))
      .compensate(() => Result.success(99));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(5);
  });
});

describe('ResultAsync.else', () => {
  it('returns fallback value on failure', async () => {
    const r = await fromAsync(failAsync<number>()).else(0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });

  it('calls factory on failure', async () => {
    const r = await fromAsync(failAsync<number>())
      .else(async () => -1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(-1);
  });

  it('passes through success', async () => {
    const r = await fromAsync(okAsync(42)).else(0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });
});

describe('ResultAsync terminal operations', () => {
  it('match extracts success value', async () => {
    const msg = await fromAsync(okAsync(10)).match(
      n => `val:${n}`,
      () => 'err',
    );
    expect(msg).toBe('val:10');
  });

  it('match extracts error branch', async () => {
    const msg = await fromAsync(failAsync()).match(
      () => 'ok',
      errs => errs[0]!.code,
    );
    expect(msg).toBe('Test.Invalid');
  });

  it('match accepts async handlers', async () => {
    const msg = await fromAsync(okAsync(5)).match(
      async n => `async:${n}`,
      async () => 'fail',
    );
    expect(msg).toBe('async:5');
  });

  it('unwrap returns value on success', async () => {
    const v = await fromAsync(okAsync(42)).unwrap();
    expect(v).toBe(42);
  });

  it('unwrap throws on failure', async () => {
    await expect(fromAsync(failAsync()).unwrap()).rejects.toThrow('Cannot unwrap');
  });

  it('unwrapOr returns value on success', async () => {
    expect(await fromAsync(okAsync(5)).unwrapOr(0)).toBe(5);
  });

  it('unwrapOr returns default on failure', async () => {
    expect(await fromAsync(failAsync<number>()).unwrapOr(-1)).toBe(-1);
  });

  it('toResult returns raw Promise<Result<T>>', async () => {
    const result = await fromAsync(okAsync(3)).toResult();
    expect(result.ok).toBe(true);
  });
});

describe('ResultAsync pipeline chaining', () => {
  it('multi-step pipeline resolves correctly', async () => {
    const result = await fromAsync(okAsync(2))
      .map(n => n * 3)
      .ensure(n => n < 100, err)
      .andThen(n => ResultAsync.success(n + 1))
      .match(n => n, () => -1);
    expect(result).toBe(7);
  });

  it('short-circuits midway and collects first error', async () => {
    const result = await fromAsync(okAsync(200))
      .ensure(n => n < 100, err)
      .map(n => n * 2)
      .match(() => 'ok', errs => errs[0]!.code);
    expect(result).toBe('Test.Invalid');
  });
});
