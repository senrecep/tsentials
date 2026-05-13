import { Err } from '../../src/errors/app-error.js';
import { Result } from '../../src/result/result.js';
import { chain, ResultChain } from '../../src/result/result-chain.js';

const err = Err.validation('Test.Invalid', 'invalid');
const _notFound = Err.notFound('Test.NotFound', 'not found');

describe('ResultChain sync API', () => {
  it('chain() creates a ResultChain', () => {
    const c = chain(Result.success(42));
    expect(c.unwrap().ok).toBe(true);
  });

  it('bind chains on success', () => {
    const r = chain(Result.success(5))
      .bind((n) => Result.success(n * 2))
      .unwrap();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10);
  });

  it('bind short-circuits on failure', () => {
    const called: boolean[] = [];
    const r = chain(Result.failure<number>(err))
      .bind((n) => {
        called.push(true);
        return Result.success(n * 2);
      })
      .unwrap();
    expect(r.ok).toBe(false);
    expect(called).toHaveLength(0);
  });

  it('map transforms value', () => {
    const r = chain(Result.success(3))
      .map((n) => n + 1)
      .unwrap();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(4);
  });

  it('map passes through failure', () => {
    const called: boolean[] = [];
    const r = chain(Result.failure<number>(err))
      .map((n) => {
        called.push(true);
        return n + 1;
      })
      .unwrap();
    expect(r.ok).toBe(false);
    expect(called).toHaveLength(0);
  });

  it('ensure passes when predicate true', () => {
    const r = chain(Result.success(10))
      .ensure((n) => n > 5, err)
      .unwrap();
    expect(r.ok).toBe(true);
  });

  it('ensure fails when predicate false', () => {
    const r = chain(Result.success(3))
      .ensure((n) => n > 5, err)
      .unwrap();
    expect(r.ok).toBe(false);
  });

  it('ensure supports function error', () => {
    const r = chain(Result.success(3))
      .ensure(
        (n) => n > 5,
        (n) => Err.validation('Value', `Bad ${n}`),
      )
      .unwrap();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.description).toBe('Bad 3');
  });

  it('match extracts success value', () => {
    const v = chain(Result.success(99)).match(
      (n) => n,
      () => -1,
    );
    expect(v).toBe(99);
  });

  it('match extracts error value', () => {
    const v = chain(Result.failure<number>(err)).match(
      () => -1,
      (errs) => errs[0]!.code,
    );
    expect(v).toBe('Test.Invalid');
  });

  it('compensate recovers failure', () => {
    const r = chain(Result.failure<number>(err))
      .compensate(() => Result.success(0))
      .unwrap();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });

  it('compensate passes through success', () => {
    const called: boolean[] = [];
    const r = chain(Result.success(5))
      .compensate(() => {
        called.push(true);
        return Result.success(0);
      })
      .unwrap();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(5);
    expect(called).toHaveLength(0);
  });

  it('unwrap returns Result', () => {
    const c = chain(Result.success(42));
    const r = c.unwrap();
    expect(r.ok).toBe(true);
  });

  it('unwrapOr returns value on success', () => {
    expect(chain(Result.success(7)).unwrapOr(-1)).toBe(7);
  });

  it('unwrapOr returns default on failure', () => {
    expect(chain(Result.failure<number>(err)).unwrapOr(-1)).toBe(-1);
  });

  it('unwrapOrElse computes from errors', () => {
    const v = chain(Result.failure<number>(err)).unwrapOrElse((errs) => errs.length);
    expect(v).toBe(1);
  });

  it('unwrapOrElse returns value on success', () => {
    const v = chain(Result.success(7)).unwrapOrElse(() => -1);
    expect(v).toBe(7);
  });

  it('tap runs side effect on success', () => {
    const seen: number[] = [];
    chain(Result.success(9)).tap((n) => seen.push(n));
    expect(seen).toEqual([9]);
  });

  it('tap skips on failure', () => {
    const seen: number[] = [];
    chain(Result.failure<number>(err)).tap((n) => seen.push(n));
    expect(seen).toHaveLength(0);
  });

  it('tapError runs on failure', () => {
    const seen: string[] = [];
    chain(Result.failure(err)).tapError((errs) => seen.push(errs[0]!.code));
    expect(seen).toEqual(['Test.Invalid']);
  });

  it('tapError skips on success', () => {
    const seen: string[] = [];
    chain(Result.success(1)).tapError((errs) => seen.push(errs[0]!.code));
    expect(seen).toHaveLength(0);
  });

  it('else returns fallback on failure', () => {
    const r = chain(Result.failure<number>(err)).else(0).unwrap();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });

  it('else passes through success', () => {
    const r = chain(Result.success(5)).else(0).unwrap();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(5);
  });

  it('else calls factory on failure', () => {
    const r = chain(Result.failure<number>(err))
      .else((errs) => errs.length)
      .unwrap();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1);
  });

  it('mapError transforms errors', () => {
    const r = chain(Result.failure<number>(err))
      .mapError((errs) => errs.map((e) => ({ ...e, code: `E.${e.code}` })))
      .unwrap();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('E.Test.Invalid');
  });

  it('mapError passes through success', () => {
    const called: boolean[] = [];
    const r = chain(Result.success(5))
      .mapError((errs) => {
        called.push(true);
        return errs;
      })
      .unwrap();
    expect(r.ok).toBe(true);
    expect(called).toHaveLength(0);
  });
});

describe('ResultChain async API', () => {
  it('fromPromise wraps a Promise<Result<T>>', async () => {
    const c = await ResultChain.fromPromise(Promise.resolve(Result.success(42)));
    const r = c.unwrap();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('fromPromise wraps a Promise<Result<T>> failure', async () => {
    const c = await ResultChain.fromPromise(Promise.resolve(Result.failure<number>(err)));
    const r = c.unwrap();
    expect(r.ok).toBe(false);
  });

  it('thenAsync chains async bind', async () => {
    const c = await chain(Result.success(3)).thenAsync(async (n) => Result.success(n * 10));
    expect(c.unwrap().ok).toBe(true);
    if (c.unwrap().ok) expect((c.unwrap() as { ok: true; value: number }).value).toBe(30);
  });

  it('thenAsync short-circuits on failure', async () => {
    const called: boolean[] = [];
    const c = await chain(Result.failure<number>(err)).thenAsync(async (n) => {
      called.push(true);
      return Result.success(n * 10);
    });
    expect(c.unwrap().ok).toBe(false);
    expect(called).toHaveLength(0);
  });

  it('mapAsync transforms async', async () => {
    const c = await chain(Result.success(4)).mapAsync(async (n) => n * n);
    const r = c.unwrap();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(16);
  });

  it('mapAsync passes through failure', async () => {
    const called: boolean[] = [];
    const c = await chain(Result.failure<number>(err)).mapAsync(async (n) => {
      called.push(true);
      return n * n;
    });
    expect(c.unwrap().ok).toBe(false);
    expect(called).toHaveLength(0);
  });

  it('ensureAsync passes when async predicate true', async () => {
    const c = await chain(Result.success(10)).ensureAsync(async (n) => n > 5, err);
    expect(c.unwrap().ok).toBe(true);
  });

  it('ensureAsync fails when async predicate false', async () => {
    const c = await chain(Result.success(2)).ensureAsync(async (n) => n > 5, err);
    expect(c.unwrap().ok).toBe(false);
  });

  it('tapAsync runs async effect on success', async () => {
    const seen: number[] = [];
    const c = await chain(Result.success(9)).tapAsync(async (n) => {
      seen.push(n);
    });
    expect(seen).toEqual([9]);
    expect(c.unwrap().ok).toBe(true);
  });

  it('tapAsync skips on failure', async () => {
    const seen: number[] = [];
    await chain(Result.failure<number>(err)).tapAsync(async (n) => {
      seen.push(n);
    });
    expect(seen).toHaveLength(0);
  });

  it('tapErrorAsync runs on failure', async () => {
    const seen: string[] = [];
    await chain(Result.failure(err)).tapErrorAsync(async (errs) => {
      seen.push(errs[0]!.code);
    });
    expect(seen).toEqual(['Test.Invalid']);
  });

  it('tapErrorAsync skips on success', async () => {
    const seen: string[] = [];
    await chain(Result.success(1)).tapErrorAsync(async (errs) => {
      seen.push(errs[0]!.code);
    });
    expect(seen).toHaveLength(0);
  });

  it('compensateAsync recovers from failure', async () => {
    const c = await chain(Result.failure<number>(err)).compensateAsync(async () =>
      Result.success(77),
    );
    expect(c.unwrap().ok).toBe(true);
    if (c.unwrap().ok) expect((c.unwrap() as { ok: true; value: number }).value).toBe(77);
  });

  it('compensateAsync passes through success', async () => {
    const called: boolean[] = [];
    const c = await chain(Result.success(5)).compensateAsync(async () => {
      called.push(true);
      return Result.success(77);
    });
    expect(c.unwrap().ok).toBe(true);
    if (c.unwrap().ok) expect((c.unwrap() as { ok: true; value: number }).value).toBe(5);
    expect(called).toHaveLength(0);
  });

  it('mapErrorAsync transforms errors', async () => {
    const c = await chain(Result.failure<number>(err)).mapErrorAsync(async (errs) =>
      errs.map((e) => ({ ...e, code: `E.${e.code}` })),
    );
    const r = c.unwrap();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('E.Test.Invalid');
  });

  it('elseAsync returns fallback on failure', async () => {
    const c = await chain(Result.failure<number>(err)).elseAsync(-1);
    const r = c.unwrap();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(-1);
  });

  it('elseAsync passes through success', async () => {
    const c = await chain(Result.success(5)).elseAsync(-1);
    const r = c.unwrap();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(5);
  });

  it('matchAsync handles success', async () => {
    const v = await chain(Result.success(42)).matchAsync(
      async (n) => `v:${n}`,
      async () => 'err',
    );
    expect(v).toBe('v:42');
  });

  it('matchAsync handles failure', async () => {
    const v = await chain(Result.failure(err)).matchAsync(
      async () => 'ok',
      async (errs) => errs[0]!.code,
    );
    expect(v).toBe('Test.Invalid');
  });
});
