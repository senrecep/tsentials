import { Eq } from '../../src/eq/index.js';
import { Err } from '../../src/errors/app-error.js';
import { ErrorType } from '../../src/errors/error-type.js';
import { Maybe } from '../../src/maybe/maybe.js';

const abortError = (): Error => Object.assign(new Error('aborted'), { name: 'AbortError' });

describe('Maybe.equals', () => {
  it('None equals None', () => {
    expect(Maybe.equals(Maybe.none<number>(), Maybe.none<number>())).toBe(true);
  });

  it('Some equals Some with same value', () => {
    expect(Maybe.equals(Maybe.some(1), Maybe.some(1))).toBe(true);
    expect(Maybe.equals(Maybe.some(1), Maybe.some(2))).toBe(false);
  });

  it('Some never equals None (either order)', () => {
    expect(Maybe.equals(Maybe.some(0), Maybe.none<number>())).toBe(false);
    expect(Maybe.equals(Maybe.none<number>(), Maybe.some(0))).toBe(false);
  });

  it('uses strict equality by default (no structural compare)', () => {
    expect(Maybe.equals(Maybe.some({ id: 1 }), Maybe.some({ id: 1 }))).toBe(false);
  });

  it('uses the supplied Eq', () => {
    const eqUser = Eq.struct({ id: Eq.number });
    expect(Maybe.equals(Maybe.some({ id: 1 }), Maybe.some({ id: 1 }), eqUser)).toBe(true);
    expect(Maybe.equals(Maybe.some({ id: 1 }), Maybe.some({ id: 2 }), eqUser)).toBe(false);
    expect(Maybe.equals(Maybe.some({ id: 1 }), Maybe.none(), eqUser)).toBe(false);
  });

  it('does not call Eq when one side is None', () => {
    const eq = { equals: vi.fn(() => true) };
    expect(Maybe.equals(Maybe.some(1), Maybe.none<number>(), eq)).toBe(false);
    expect(eq.equals).not.toHaveBeenCalled();
  });
});

describe('Maybe.equalsValue (strict)', () => {
  it('a non-null value never equals None', () => {
    expect(Maybe.equalsValue(Maybe.none<number>(), 0)).toBe(false);
    expect(Maybe.equalsValue(Maybe.none<string>(), '')).toBe(false);
    expect(Maybe.equalsValue(Maybe.none<boolean>(), false)).toBe(false);
  });

  it('null / undefined equals None only', () => {
    expect(Maybe.equalsValue(Maybe.none<number>(), null)).toBe(true);
    expect(Maybe.equalsValue(Maybe.none<number>(), undefined)).toBe(true);
    expect(Maybe.equalsValue(Maybe.some(1), null)).toBe(false);
    expect(Maybe.equalsValue(Maybe.some(1), undefined)).toBe(false);
  });

  it('Some(x) equals x', () => {
    expect(Maybe.equalsValue(Maybe.some(5), 5)).toBe(true);
    expect(Maybe.equalsValue(Maybe.some(5), 6)).toBe(false);
  });

  it('uses the supplied Eq', () => {
    const eqCi: Eq<string> = { equals: (a, b) => a.toLowerCase() === b.toLowerCase() };
    expect(Maybe.equalsValue(Maybe.some('ABC'), 'abc', eqCi)).toBe(true);
    expect(Maybe.equalsValue(Maybe.none<string>(), 'abc', eqCi)).toBe(false);
  });
});

describe('Maybe.format', () => {
  it('formats Some(value) and None', () => {
    expect(Maybe.format(Maybe.some(42))).toBe('Some(42)');
    expect(Maybe.format(Maybe.some('abc'))).toBe('Some(abc)');
    expect(Maybe.format(Maybe.some(1.5))).toBe('Some(1.5)');
    expect(Maybe.format(Maybe.none())).toBe('None');
  });

  it('uses the value toString', () => {
    const v = { toString: () => 'custom' };
    expect(Maybe.format(Maybe.some(v))).toBe('Some(custom)');
  });

  it('formats nested Maybes recursively', () => {
    expect(Maybe.format(Maybe.some(Maybe.some(1)))).toBe('Some(Some(1))');
    expect(Maybe.format(Maybe.some(Maybe.none<number>()))).toBe('Some(None)');
    expect(Maybe.format(Maybe.some(Maybe.some(Maybe.some('x'))))).toBe('Some(Some(Some(x)))');
  });

  it('does not treat a plain object with a non-boolean hasValue as a Maybe', () => {
    const v = { hasValue: 'yes', toString: () => 'obj' };
    expect(Maybe.format(Maybe.some(v))).toBe('Some(obj)');
  });

  it('does not shadow Object.prototype.toString on the namespace', () => {
    expect(Object.hasOwn(Maybe, 'toString')).toBe(false);
    expect(String(Maybe)).toBe('[object Object]');
    expect(`${Maybe}`).toBe('[object Object]');
  });
});

describe('Maybe.toResult / toUnitResult', () => {
  it('Some → success', () => {
    const r = Maybe.toResult(Maybe.some(7));
    expect(r).toEqual({ ok: true, value: 7 });
  });

  it('None → default NotFound Maybe.Result error', () => {
    const r = Maybe.toResult(Maybe.none<number>());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]?.code).toBe('Maybe.Result');
      expect(r.errors[0]?.type).toBe(ErrorType.NotFound);
      expect(r.errors[0]?.description).toBe("The 'Maybe' has no value.");
    }
  });

  it('None → supplied error', () => {
    const err = Err.notFound('User.NotFound', 'missing');
    const r = Maybe.toResult(Maybe.none<number>(), err);
    expect(!r.ok && r.errors[0]).toBe(err);
  });

  it('toUnitResult maps Some → ok, None → error', () => {
    expect(Maybe.toUnitResult(Maybe.some('x')).ok).toBe(true);
    const r = Maybe.toUnitResult(Maybe.none());
    expect(!r.ok && r.errors[0]?.code).toBe('Maybe.Result');
    const err = Err.validation('X', 'y');
    const r2 = Maybe.toUnitResult(Maybe.none(), err);
    expect(!r2.ok && r2.errors[0]).toBe(err);
  });
});

describe('Maybe.sequence', () => {
  it('Some(values) when all have a value', () => {
    expect(Maybe.sequence([Maybe.some(1), Maybe.some(2), Maybe.some(3)])).toEqual(
      Maybe.some([1, 2, 3]),
    );
  });

  it('None when any is None', () => {
    expect(Maybe.isNone(Maybe.sequence([Maybe.some(1), Maybe.none<number>()]))).toBe(true);
  });

  it('empty input → Some([])', () => {
    expect(Maybe.sequence<number>([])).toEqual(Maybe.some([]));
  });

  it('accepts any iterable and stops at the first None', () => {
    const seen: number[] = [];
    function* gen() {
      seen.push(1);
      yield Maybe.some(1);
      seen.push(2);
      yield Maybe.none<number>();
      seen.push(3);
      yield Maybe.some(3);
    }
    expect(Maybe.isNone(Maybe.sequence(gen()))).toBe(true);
    expect(seen).toEqual([1, 2]);
  });
});

describe('Maybe.traverse', () => {
  const parse = (s: string): Maybe<number> => {
    const n = Number(s);
    return Number.isNaN(n) ? Maybe.none() : Maybe.some(n);
  };

  it('Some(mapped) when every item maps to Some', () => {
    expect(Maybe.traverse(['1', '2'], parse)).toEqual(Maybe.some([1, 2]));
  });

  it('None and stops calling fn after the first None', () => {
    const fn = vi.fn(parse);
    const r = Maybe.traverse(['1', 'x', '3'], fn);
    expect(Maybe.isNone(r)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('empty input → Some([])', () => {
    expect(Maybe.traverse([], parse)).toEqual(Maybe.some([]));
  });
});

describe('Maybe.partition', () => {
  it('returns values in order and the None count', () => {
    expect(
      Maybe.partition([Maybe.some(1), Maybe.none<number>(), Maybe.some(3), Maybe.none<number>()]),
    ).toEqual({ values: [1, 3], noneCount: 2 });
  });

  it('empty input', () => {
    expect(Maybe.partition<number>([])).toEqual({ values: [], noneCount: 0 });
  });
});

describe('Maybe.flatten / fromNullable', () => {
  it('flatten unwraps nested Maybe', () => {
    expect(Maybe.flatten(Maybe.some(Maybe.some(5)))).toEqual(Maybe.some(5));
    expect(Maybe.isNone(Maybe.flatten(Maybe.some(Maybe.none<number>())))).toBe(true);
    expect(Maybe.isNone(Maybe.flatten(Maybe.none<Maybe<number>>()))).toBe(true);
  });

  it('flatten treats null/undefined outer as None', () => {
    expect(Maybe.isNone(Maybe.flatten<number>(null))).toBe(true);
    expect(Maybe.isNone(Maybe.flatten<number>(undefined))).toBe(true);
  });

  it('fromNullable turns a nullable Maybe into a Maybe', () => {
    const stored: { points?: Maybe<number> } = {};
    expect(Maybe.isNone(Maybe.fromNullable(stored.points))).toBe(true);
    expect(Maybe.isNone(Maybe.fromNullable<number>(null))).toBe(true);
    const some = Maybe.some(3);
    expect(Maybe.fromNullable(some)).toBe(some);
  });
});

describe('Maybe.fromTry (cancellation-safe)', () => {
  it('turns ordinary errors into None', () => {
    expect(
      Maybe.isNone(
        Maybe.fromTry<number>(() => {
          throw new Error('boom');
        }),
      ),
    ).toBe(true);
  });

  it('rethrows AbortError instead of swallowing it', () => {
    const e = abortError();
    expect(() =>
      Maybe.fromTry(() => {
        throw e;
      }),
    ).toThrow(e);
  });

  it('rethrows TimeoutError', () => {
    const e = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    expect(() =>
      Maybe.fromTry(() => {
        throw e;
      }),
    ).toThrow(e);
  });
});

describe('Maybe.fromTryAsync', () => {
  it('resolved value → Some, null/undefined → None', async () => {
    expect(await Maybe.fromTryAsync(async () => 5)).toEqual(Maybe.some(5));
    expect(Maybe.isNone(await Maybe.fromTryAsync(async () => null))).toBe(true);
    expect(Maybe.isNone(await Maybe.fromTryAsync(async () => undefined))).toBe(true);
  });

  it('rejection → None', async () => {
    const m = await Maybe.fromTryAsync(async () => {
      throw new Error('boom');
    });
    expect(Maybe.isNone(m)).toBe(true);
  });

  it('passes the signal to fn', async () => {
    const controller = new AbortController();
    const fn = vi.fn(async (_s?: AbortSignal) => 1);
    await Maybe.fromTryAsync(fn, { signal: controller.signal });
    expect(fn).toHaveBeenCalledWith(controller.signal);
  });

  it('caller abort propagates even when fn ignores the signal', async () => {
    const controller = new AbortController();
    const pending = Maybe.fromTryAsync(() => new Promise<number>(() => undefined), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('already-aborted signal rejects with the custom reason', async () => {
    const controller = new AbortController();
    controller.abort('stop');
    await expect(Maybe.fromTryAsync(async () => 1, { signal: controller.signal })).rejects.toBe(
      'stop',
    );
  });

  it('caller abort thrown by fn propagates', async () => {
    const controller = new AbortController();
    const pending = Maybe.fromTryAsync(
      (signal) =>
        new Promise<number>((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason));
        }),
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('foreign AbortError while caller signal is not aborted → None', async () => {
    const controller = new AbortController();
    const m = await Maybe.fromTryAsync(
      async () => {
        throw abortError();
      },
      { signal: controller.signal },
    );
    expect(Maybe.isNone(m)).toBe(true);
  });

  it('AbortError without any signal → None', async () => {
    const m = await Maybe.fromTryAsync(async () => {
      throw abortError();
    });
    expect(Maybe.isNone(m)).toBe(true);
  });
});
