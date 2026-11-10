import { Err } from '../../src/errors/app-error.js';
import { Maybe } from '../../src/maybe/maybe.js';
import { MaybeAsync } from '../../src/maybe/maybe-async.js';
import { ResultAsync } from '../../src/result/result-async.js';

const abortedSignal = (): AbortSignal => {
  const c = new AbortController();
  c.abort(new Error('stop'));
  return c.signal;
};

describe('Maybe.tapNoneAsync', () => {
  it('runs the side effect only on None and returns the same Maybe', async () => {
    const fn = vi.fn(async () => {});
    const none = Maybe.none<number>();
    expect(await Maybe.tapNoneAsync(none, fn)).toBe(none);
    const some = Maybe.some(1);
    expect(await Maybe.tapNoneAsync(some, fn)).toBe(some);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('MaybeAsync factories', () => {
  it('is awaitable and wraps a promise, a plain Maybe or another MaybeAsync', async () => {
    expect(await MaybeAsync.from(Promise.resolve(Maybe.some(1)))).toEqual(Maybe.some(1));
    expect(await MaybeAsync.from(Maybe.none<number>())).toEqual(Maybe.none());
    expect(await MaybeAsync.from(MaybeAsync.some(2))).toEqual(Maybe.some(2));
    expect(await MaybeAsync.none<number>()).toEqual(Maybe.none());
    expect(await MaybeAsync.some(null)).toEqual(Maybe.none());
  });

  it('try follows Maybe.fromTryAsync', async () => {
    expect(await MaybeAsync.try(async () => 1)).toEqual(Maybe.some(1));
    expect(await MaybeAsync.try(() => Promise.reject(new Error('x')))).toEqual(Maybe.none());
    const signal = abortedSignal();
    await expect(MaybeAsync.try(async () => 1, { signal })).rejects.toBe(signal.reason);
  });

  it('propagates a rejection through then', async () => {
    const err = new Error('boom');
    await expect(MaybeAsync.from<number>(Promise.reject(err)).map((n) => n)).rejects.toBe(err);
  });
});

describe('MaybeAsync pipeline', () => {
  it('chains sync and async steps with one await', async () => {
    const seen: string[] = [];
    const result = await MaybeAsync.some(2)
      .map((n) => n * 10)
      .map(async (n) => n + 1)
      .filter(async (n) => n > 20)
      .bind((n) => Maybe.some(`v${n}`))
      .bind(async (s) => Maybe.some(s.toUpperCase()))
      .tap(async (s) => {
        seen.push(s);
      })
      .tapNone(() => {
        seen.push('none');
      });
    expect(result).toEqual(Maybe.some('V21'));
    expect(seen).toEqual(['V21']);
  });

  it('short-circuits on None and runs tapNone', async () => {
    const fn = vi.fn();
    const onNone = vi.fn(async () => {});
    const result = await MaybeAsync.some(1)
      .filter((n) => n > 5)
      .map(fn)
      .bind(fn)
      .tap(fn)
      .tapNone(onNone);
    expect(result).toEqual(Maybe.none());
    expect(fn).not.toHaveBeenCalled();
    expect(onNone).toHaveBeenCalledTimes(1);
  });

  it('map and bind turn null into None', async () => {
    expect(await MaybeAsync.some(1).map(() => null)).toEqual(Maybe.none());
    const handBuilt = { hasValue: true, value: undefined } as unknown as Maybe<number>;
    expect(await MaybeAsync.some(1).bind(async () => handBuilt)).toEqual(Maybe.none());
  });

  it('orElse uses the fallback only on None', async () => {
    const fallback = vi.fn(async () => Maybe.some(9));
    expect(await MaybeAsync.none<number>().orElse(fallback)).toEqual(Maybe.some(9));
    expect(await MaybeAsync.some(1).orElse(fallback)).toEqual(Maybe.some(1));
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('toResult returns a ResultAsync with the default or a custom error', async () => {
    const ok = MaybeAsync.some(1).toResult();
    expect(ok).toBeInstanceOf(ResultAsync);
    expect(await ok).toEqual({ ok: true, value: 1 });
    const def = await MaybeAsync.none<number>().toResult();
    expect(def.ok).toBe(false);
    if (!def.ok) expect(def.errors[0]?.code).toBe('Maybe.Result');
    const custom = Err.notFound('User.NotFound', 'missing');
    const failed = await MaybeAsync.none<number>().toResult(custom);
    if (!failed.ok) expect(failed.errors[0]).toBe(custom);
  });
});

describe('MaybeAsync terminals', () => {
  it('match picks the branch (sync or async)', async () => {
    expect(
      await MaybeAsync.some(2).match(
        (n) => n * 2,
        () => 0,
      ),
    ).toBe(4);
    expect(
      await MaybeAsync.none<number>().match(
        async (n) => n,
        async () => -1,
      ),
    ).toBe(-1);
  });

  it('getOrElse and getOrDefault', async () => {
    expect(await MaybeAsync.some(1).getOrElse(() => 0)).toBe(1);
    expect(await MaybeAsync.none<number>().getOrElse(async () => 7)).toBe(7);
    expect(await MaybeAsync.some(1).getOrDefault(0)).toBe(1);
    expect(await MaybeAsync.none<number>().getOrDefault(0)).toBe(0);
  });
});

describe('MaybeAsync with { signal }', () => {
  it('passes the signal to every callback', async () => {
    const signal = new AbortController().signal;
    const seen: Array<AbortSignal | undefined> = [];
    const record = <V>(s: AbortSignal | undefined, value?: V): V => {
      seen.push(s);
      return value as V;
    };
    await MaybeAsync.some(1)
      .map((n, s) => record(s, n), { signal })
      .filter((_, s) => record(s, true), { signal })
      .bind((n, s) => record(s, Maybe.some(n)), { signal })
      .tap((_, s) => record(s), { signal })
      .match(
        (n, s) => record(s, n),
        () => 0,
        { signal },
      );
    await MaybeAsync.none<number>()
      .tapNone((s) => record(s), { signal })
      .orElse((s) => record(s, Maybe.none()), { signal })
      .getOrElse((s) => record(s, 0), { signal });
    expect(seen).toHaveLength(8);
    expect(seen.every((s) => s === signal)).toBe(true);
  });

  it('rejects with signal.reason before running a callback when already aborted', async () => {
    const signal = abortedSignal();
    const fn = vi.fn();
    await expect(MaybeAsync.some(1).map(fn, { signal })).rejects.toBe(signal.reason);
    await expect(MaybeAsync.some(1).bind(fn, { signal })).rejects.toBe(signal.reason);
    await expect(MaybeAsync.some(1).filter(fn, { signal })).rejects.toBe(signal.reason);
    await expect(MaybeAsync.some(1).tap(fn, { signal })).rejects.toBe(signal.reason);
    await expect(MaybeAsync.none().tapNone(fn, { signal })).rejects.toBe(signal.reason);
    await expect(MaybeAsync.none().orElse(fn, { signal })).rejects.toBe(signal.reason);
    await expect(MaybeAsync.some(1).match(fn, fn, { signal })).rejects.toBe(signal.reason);
    await expect(MaybeAsync.none().getOrElse(fn, { signal })).rejects.toBe(signal.reason);
    expect(fn).not.toHaveBeenCalled();
  });

  it('ignores the signal when the callback does not run', async () => {
    const signal = abortedSignal();
    expect(await MaybeAsync.none<number>().map((n) => n, { signal })).toEqual(Maybe.none());
    expect(await MaybeAsync.some(1).getOrElse(() => 0, { signal })).toBe(1);
  });

  it('stops waiting for a pending callback when the signal aborts', async () => {
    const c = new AbortController();
    const pending = MaybeAsync.some(1).map(() => new Promise<number>(() => {}), {
      signal: c.signal,
    });
    c.abort(new Error('late'));
    await expect(pending).rejects.toBe(c.signal.reason);
  });
});
