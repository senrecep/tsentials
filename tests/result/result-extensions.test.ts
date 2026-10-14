import { type AppError, Err } from '../../src/errors/app-error.js';
import { ErrorType } from '../../src/errors/error-type.js';
import {
  isAbortError,
  isCallerAbort,
  rethrowIfAborted,
  throwIfAborted,
  withAbort,
} from '../../src/result/abort.js';
import { Result } from '../../src/result/result.js';
import { ResultAsync } from '../../src/result/result-async.js';
import { chain } from '../../src/result/result-chain.js';

const validation = Err.validation('V.1', 'validation');
const notFound = Err.notFound('N.1', 'not found');
const conflict = Err.conflict('C.1', 'conflict');

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const never = <T>() => new Promise<T>(() => undefined);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function abortError(message = 'aborted'): DOMException {
  return new DOMException(message, 'AbortError');
}

// ─── 1. Lazy error factories ────────────────────────────────────────────────

describe('lazy error factories', () => {
  it('Result.ensure does not call the factory when the predicate passes', () => {
    const factory = vi.fn((n: number) => Err.validation('X', `bad ${n}`));
    const r = Result.ensure(Result.success(5), (n) => n > 0, factory);
    expect(r.ok).toBe(true);
    expect(factory).not.toHaveBeenCalled();
  });

  it('Result.ensure calls the factory once with the value when the predicate fails', () => {
    const factory = vi.fn((n: number) => Err.validation('X', `bad ${n}`));
    const r = Result.ensure(Result.success(-1), (n) => n > 0, factory);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(-1);
    expect(Result.firstError(r).description).toBe('bad -1');
  });

  it('Result.ensure never calls predicate or factory on failure', () => {
    const factory = vi.fn(() => validation);
    const predicate = vi.fn(() => true);
    Result.ensure(Result.failure<number>(notFound), predicate, factory);
    expect(predicate).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it('Result.ensureAsync is lazy', async () => {
    const factory = vi.fn(() => validation);
    await Result.ensureAsync(Result.success(1), async () => true, factory);
    expect(factory).not.toHaveBeenCalled();
    const r = await Result.ensureAsync(Result.success(1), async () => false, factory);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
  });

  it('Result.failWhen is lazy', () => {
    const factory = vi.fn(() => validation);
    expect(Result.failWhen(Result.success(1), () => false, factory).ok).toBe(true);
    expect(factory).not.toHaveBeenCalled();
    expect(Result.failWhen(Result.success(1), () => true, factory).ok).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('ResultAsync.ensure is lazy', async () => {
    const factory = vi.fn(() => validation);
    await ResultAsync.success(1).ensure(async () => true, factory);
    expect(factory).not.toHaveBeenCalled();
    const r = await ResultAsync.success(1).ensure(() => false, factory);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
  });

  it('ResultAsync.failWhen is lazy and fails when predicate matches', async () => {
    const factory = vi.fn((n: number) => Err.validation('Neg', `neg ${n}`));
    const ok = await ResultAsync.success(3).failWhen((n) => n < 0, factory);
    expect(ok.ok).toBe(true);
    expect(factory).not.toHaveBeenCalled();
    const bad = await ResultAsync.success(-3).failWhen(async (n) => n < 0, factory);
    expect(Result.firstError(bad).description).toBe('neg -3');
    const fixed = await ResultAsync.success(-3).failWhen(() => true, validation);
    expect(Result.firstError(fixed)).toBe(validation);
  });

  it('ResultChain.ensure / ensureAsync are lazy', async () => {
    const factory = vi.fn(() => validation);
    chain(Result.success(1)).ensure(() => true, factory);
    await chain(Result.success(1)).ensureAsync(async () => true, factory);
    expect(factory).not.toHaveBeenCalled();
  });
});

// ─── 2. Abort helpers ───────────────────────────────────────────────────────

describe('abort helpers', () => {
  it('isAbortError recognises AbortError and TimeoutError by name', () => {
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError(new DOMException('t', 'TimeoutError'))).toBe(true);
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });

  it('isCallerAbort requires the caller signal to be aborted', () => {
    const c = new AbortController();
    expect(isCallerAbort(abortError(), c.signal)).toBe(false);
    expect(isCallerAbort(abortError(), undefined)).toBe(false);
    c.abort();
    expect(isCallerAbort(abortError('other source'), c.signal)).toBe(true);
    expect(isCallerAbort(c.signal.reason, c.signal)).toBe(true);
    expect(isCallerAbort(new TypeError('boom'), c.signal)).toBe(false);
  });

  it('isCallerAbort matches a custom (non-error) abort reason by identity', () => {
    const c = new AbortController();
    c.abort('stop');
    expect(isCallerAbort('stop', c.signal)).toBe(true);
    expect(isCallerAbort('other', c.signal)).toBe(false);
  });

  it('rethrowIfAborted rethrows only the caller abort', () => {
    const c = new AbortController();
    expect(() => rethrowIfAborted(abortError(), c.signal)).not.toThrow();
    c.abort();
    expect(() => rethrowIfAborted(c.signal.reason, c.signal)).toThrow();
    expect(() => rethrowIfAborted(new Error('x'), c.signal)).not.toThrow();
  });

  it('throwIfAborted throws signal.reason', () => {
    const c = new AbortController();
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted(c.signal)).not.toThrow();
    c.abort('why');
    expect(() => throwIfAborted(c.signal)).toThrow('why');
  });

  it('withAbort passes through without a signal', async () => {
    await expect(withAbort(Promise.resolve(1), undefined)).resolves.toBe(1);
    await expect(withAbort(Promise.reject(new Error('e')), undefined)).rejects.toThrow('e');
  });

  it('withAbort rejects with signal.reason when aborted mid-flight', async () => {
    const c = new AbortController();
    const p = withAbort(never<number>(), c.signal);
    c.abort();
    await expect(p).rejects.toBe(c.signal.reason);
  });

  it('withAbort rejects immediately on an already-aborted signal and observes the input', async () => {
    const c = new AbortController();
    c.abort('gone');
    const late = new Promise<number>((_, rej) => setTimeout(() => rej(new Error('late')), 5));
    await expect(withAbort(late, c.signal)).rejects.toBe('gone');
    // The late rejection must not surface as unhandled (vitest would fail the run).
    await new Promise((r) => setTimeout(r, 15));
  });

  it('withAbort removes its abort listener once the promise settles', async () => {
    const c = new AbortController();
    const add = vi.spyOn(c.signal, 'addEventListener');
    const remove = vi.spyOn(c.signal, 'removeEventListener');
    await withAbort(Promise.resolve(1), c.signal);
    await withAbort(Promise.reject(new Error('x')), c.signal).catch(() => undefined);
    expect(add).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });
});

// ─── 2b. Result.tryAsync with AbortSignal ───────────────────────────────────

describe('Result.tryAsync abort semantics', () => {
  it('without a signal an AbortError becomes a failure (no caller token)', async () => {
    const r = await Result.tryAsync(async () => {
      throw abortError();
    });
    expect(r.ok).toBe(false);
  });

  it('propagates the caller abort even when fn ignores the signal', async () => {
    const c = new AbortController();
    const p = Result.tryAsync(() => never<number>(), { signal: c.signal });
    c.abort();
    await expect(p).rejects.toBe(c.signal.reason);
  });

  it('passes the signal to fn and propagates the abort fn raises from it', async () => {
    const c = new AbortController();
    let received: AbortSignal | undefined;
    const p = Result.tryAsync(
      (signal) =>
        new Promise<number>((_, reject) => {
          received = signal;
          signal?.addEventListener('abort', () => reject(abortError('from fn')));
        }),
      { signal: c.signal },
    );
    expect(received).toBe(c.signal);
    c.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('propagates a custom abort reason', async () => {
    const c = new AbortController();
    const p = Result.tryAsync(() => never<number>(), { signal: c.signal });
    c.abort('stop');
    await expect(p).rejects.toBe('stop');
  });

  it('propagates AbortSignal.timeout as TimeoutError', async () => {
    const p = Result.tryAsync(() => never<number>(), { signal: AbortSignal.timeout(5) });
    await expect(p).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('an AbortError from an unrelated source becomes a failure', async () => {
    const c = new AbortController();
    const r = await Result.tryAsync(
      async () => {
        throw abortError('someone else');
      },
      { signal: c.signal },
    );
    expect(r.ok).toBe(false);
  });

  it('still calls fn when the signal is already aborted, then rejects', async () => {
    const c = new AbortController();
    c.abort();
    const fn = vi.fn(async () => 1);
    await expect(Result.tryAsync(fn, { signal: c.signal })).rejects.toBe(c.signal.reason);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses onError for non-abort errors when options are passed third', async () => {
    const c = new AbortController();
    const r = await Result.tryAsync(
      async () => {
        throw new Error('boom');
      },
      (e) => Err.unexpected('Mapped', (e as Error).message),
      { signal: c.signal },
    );
    expect(Result.firstError(r).code).toBe('Mapped');
  });

  it('a synchronous throw from fn becomes a failure', async () => {
    const r = await Result.tryAsync(() => {
      throw new Error('sync');
    });
    expect(Result.firstError(r).description).toContain('sync');
  });

  it('succeeds normally with a signal that never aborts', async () => {
    const c = new AbortController();
    const r = await Result.tryAsync(async () => 42, { signal: c.signal });
    expect(r).toEqual(Result.success(42));
  });

  it('ResultAsync.try forwards the signal', async () => {
    const c = new AbortController();
    const p = ResultAsync.try(() => never<number>(), { signal: c.signal }).map((n) => n + 1);
    c.abort();
    await expect(p).rejects.toBe(c.signal.reason);
  });
});

// ─── 5. recover scans all errors; recoverFirst ─────────────────────────────

describe('recover / recoverFirst', () => {
  const multi = Result.failure<number>(validation, notFound, conflict);

  it('recover(ErrorType) scans all errors and passes the matching one', () => {
    const fn = vi.fn((e: AppError) => Result.success(e.code.length));
    const r = Result.recover(multi, ErrorType.NotFound, fn);
    expect(fn).toHaveBeenCalledWith(notFound);
    expect(r).toEqual(Result.success(3));
  });

  it('recover(predicate) passes the first matching error', () => {
    const fn = vi.fn(() => Result.success(1));
    Result.recover(multi, (e) => e.type !== ErrorType.Validation, fn);
    expect(fn).toHaveBeenCalledWith(notFound);
  });

  it('recover returns the original failure when nothing matches', () => {
    const fn = vi.fn(() => Result.success(1));
    expect(Result.recover(multi, ErrorType.Forbidden, fn)).toBe(multi);
    expect(fn).not.toHaveBeenCalled();
  });

  it('recover passes success through without calling anything', () => {
    const pred = vi.fn(() => true);
    const ok = Result.success(1);
    expect(Result.recover(ok, pred, () => Result.success(2))).toBe(ok);
    expect(pred).not.toHaveBeenCalled();
  });

  it('recoverFirst only looks at the first error', () => {
    const fn = vi.fn(() => Result.success(9));
    expect(Result.recoverFirst(multi, ErrorType.NotFound, fn)).toBe(multi);
    expect(fn).not.toHaveBeenCalled();
    expect(Result.recoverFirst(multi, ErrorType.Validation, fn)).toEqual(Result.success(9));
    expect(fn).toHaveBeenCalledWith(validation);
    expect(Result.recoverFirst(multi, (e) => e.code === 'V.1', fn).ok).toBe(true);
  });

  it('recoverAsync / recoverFirstAsync', async () => {
    expect(
      (await Result.recoverAsync(multi, ErrorType.Conflict, async () => Result.success(1))).ok,
    ).toBe(true);
    expect(
      await Result.recoverFirstAsync(multi, ErrorType.Conflict, async () => Result.success(1)),
    ).toBe(multi);
    expect(
      (await Result.recoverFirstAsync(multi, ErrorType.Validation, async () => Result.success(1)))
        .ok,
    ).toBe(true);
  });

  it('ResultAsync.recover scans all errors; recoverFirst checks the first only', async () => {
    const fn = vi.fn(async (e: AppError) => Result.success(e.code));
    const src = () => ResultAsync.failure<string>(validation, notFound);
    expect(await src().recover(ErrorType.NotFound, fn)).toEqual(Result.success('N.1'));
    expect((await src().recoverFirst(ErrorType.NotFound, fn)).ok).toBe(false);
    expect(
      await src().recoverFirst(
        (e) => e.code === 'V.1',
        () => Result.success('x'),
      ),
    ).toEqual(Result.success('x'));
    expect(await src().recover(ErrorType.NotFound, () => ResultAsync.success('async'))).toEqual(
      Result.success('async'),
    );
  });

  it('ResultChain recover / recoverFirst / recoverAsync / recoverFirstAsync', async () => {
    expect(
      chain(multi)
        .recover(ErrorType.Conflict, () => Result.success(1))
        .unwrap().ok,
    ).toBe(true);
    expect(
      chain(multi)
        .recoverFirst(ErrorType.Conflict, () => Result.success(1))
        .unwrap(),
    ).toBe(multi);
    expect(
      (await chain(multi).recoverAsync(ErrorType.Conflict, async () => Result.success(1))).ok,
    ).toBe(true);
    expect(
      await chain(multi).recoverFirstAsync(ErrorType.Conflict, async () => Result.success(1)),
    ).toBe(multi);
  });
});

// ─── 8. mapEachError ────────────────────────────────────────────────────────

describe('mapEachError', () => {
  const prefix = (e: AppError): AppError => ({ ...e, code: `P.${e.code}` });

  it('maps every error in order', () => {
    const r = Result.mapEachError(Result.failure<number>(validation, notFound), prefix);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toEqual(['P.V.1', 'P.N.1']);
  });

  it('does not call the mapper on success', () => {
    const fn = vi.fn(prefix);
    const ok = Result.success(1);
    expect(Result.mapEachError(ok, fn)).toBe(ok);
    expect(fn).not.toHaveBeenCalled();
  });

  it('mapEachErrorAsync maps sequentially and in order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const r = await Result.mapEachErrorAsync(
      Result.failure<number>(validation, notFound, conflict),
      async (e) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await tick();
        order.push(e.code);
        inFlight--;
        return prefix(e);
      },
    );
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(['V.1', 'N.1', 'C.1']);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toEqual(['P.V.1', 'P.N.1', 'P.C.1']);
  });

  it('mapEachErrorAsync checks the signal before each mapper call', async () => {
    const c = new AbortController();
    const fn = vi.fn(async (e: AppError) => {
      c.abort();
      return e;
    });
    await expect(
      Result.mapEachErrorAsync(Result.failure(validation, notFound), fn, { signal: c.signal }),
    ).rejects.toBe(c.signal.reason);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ResultAsync.mapEachError accepts sync and async mappers', async () => {
    const r1 = await ResultAsync.failure(validation, notFound).mapEachError(prefix);
    const r2 = await ResultAsync.failure(validation).mapEachError(async (e) => prefix(e));
    if (!r1.ok) expect(r1.errors.map((e) => e.code)).toEqual(['P.V.1', 'P.N.1']);
    if (!r2.ok) expect(r2.errors[0]!.code).toBe('P.V.1');
    expect(r1.ok || r2.ok).toBe(false);
  });

  it('ResultChain.mapEachError / mapEachErrorAsync', async () => {
    const r1 = chain(Result.failure(validation, notFound)).mapEachError(prefix).unwrap();
    const r2 = await chain(Result.failure(validation)).mapEachErrorAsync(async (e) => prefix(e));
    expect(Result.lastError(r1).code).toBe('P.N.1');
    expect(Result.firstError(r2).code).toBe('P.V.1');
  });
});

// ─── 9. Async collections ───────────────────────────────────────────────────

describe('Result.sequenceAsync / sequence', () => {
  it('collects values in input order', async () => {
    const slow = deferred<Result<number>>();
    const p = Result.sequenceAsync([slow.promise, Promise.resolve(Result.success(2))]);
    slow.resolve(Result.success(1));
    expect(await p).toEqual(Result.success([1, 2]));
  });

  it('collects ALL errors', async () => {
    const r = await Result.sequence([
      Promise.resolve(Result.failure<number>(validation)),
      Promise.resolve(Result.success(1)),
      Promise.resolve(Result.failure<number>(notFound)),
    ]);
    if (!r.ok) expect(r.errors).toEqual([validation, notFound]);
    expect(r.ok).toBe(false);
  });

  it('awaits every promise, then rethrows the first rejection in input order', async () => {
    let slowDone = false;
    const first = new Error('first');
    const second = new Error('second');
    const slow = new Promise<Result<number>>((res) =>
      setTimeout(() => {
        slowDone = true;
        res(Result.success(3));
      }, 10),
    );
    const p = Result.sequenceAsync([
      Promise.resolve(Result.success(0)),
      new Promise<Result<number>>((_, rej) => setTimeout(() => rej(first), 5)),
      Promise.reject(second),
      slow,
    ]);
    await expect(p).rejects.toBe(first);
    expect(slowDone).toBe(true);
  });

  it('rejects with the caller abort at once and observes the rest', async () => {
    const c = new AbortController();
    const pending = deferred<Result<number>>();
    const p = Result.sequenceAsync(
      [
        pending.promise,
        new Promise<Result<number>>((_, rej) => setTimeout(() => rej(new Error('later')), 5)),
      ],
      { signal: c.signal },
    );
    c.abort();
    await expect(p).rejects.toBe(c.signal.reason);
    await new Promise((r) => setTimeout(r, 15));
  });

  it('rejects immediately on an already-aborted signal', async () => {
    const c = new AbortController();
    c.abort('pre');
    await expect(
      Result.sequenceAsync([Promise.resolve(Result.success(1))], { signal: c.signal }),
    ).rejects.toBe('pre');
  });

  it('an AbortError from an item without caller abort is a fault (rethrown after the loop)', async () => {
    let slowDone = false;
    const ab = abortError('item');
    const slow = new Promise<Result<number>>((res) =>
      setTimeout(() => {
        slowDone = true;
        res(Result.success(1));
      }, 5),
    );
    await expect(Result.sequenceAsync([Promise.reject(ab), slow])).rejects.toBe(ab);
    expect(slowDone).toBe(true);
  });

  it('reuses one signal across many items without leaking listeners', async () => {
    const c = new AbortController();
    const add = vi.spyOn(c.signal, 'addEventListener');
    const remove = vi.spyOn(c.signal, 'removeEventListener');
    const items = Array.from({ length: 30 }, (_, i) => Promise.resolve(Result.success(i)));
    const r = await Result.sequenceAsync(items, { signal: c.signal });
    expect(r.ok).toBe(true);
    expect(add.mock.calls.length).toBe(remove.mock.calls.length);
  });

  it('empty input succeeds with []', async () => {
    expect(await Result.sequenceAsync([])).toEqual(Result.success([]));
  });
});

describe('ResultAsync.sequence / partition settle semantics', () => {
  it('sequence awaits all then rethrows the first rejection', async () => {
    let done = false;
    const boom = new Error('boom');
    const p = ResultAsync.sequence([
      ResultAsync.from(Promise.reject(boom)),
      ResultAsync.from(
        new Promise<Result<number>>((res) =>
          setTimeout(() => {
            done = true;
            res(Result.success(1));
          }, 5),
        ),
      ),
    ]);
    await expect(p).rejects.toBe(boom);
    expect(done).toBe(true);
  });

  it('sequence honours the signal', async () => {
    const c = new AbortController();
    const p = ResultAsync.sequence([ResultAsync.from(never<Result<number>>())], {
      signal: c.signal,
    });
    c.abort();
    await expect(p).rejects.toBe(c.signal.reason);
  });

  it('partition accepts ResultAsync and plain promises and honours the signal', async () => {
    const { ok, err } = await ResultAsync.partition([
      ResultAsync.success(1),
      Promise.resolve(Result.failure<number>(validation)),
    ]);
    expect(ok).toEqual([1]);
    expect(err).toEqual([validation]);
    const c = new AbortController();
    c.abort();
    await expect(
      ResultAsync.partition([ResultAsync.success(1)], { signal: c.signal }),
    ).rejects.toBe(c.signal.reason);
  });

  it('partition awaits all then rethrows the first rejection', async () => {
    const boom = new Error('boom');
    await expect(
      ResultAsync.partition([Promise.reject(boom), ResultAsync.success(1)]),
    ).rejects.toBe(boom);
  });
});

describe('Result.traverseAsync', () => {
  function tracker() {
    let inFlight = 0;
    let max = 0;
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    const fn = async (n: number): Promise<Result<number>> => {
      inFlight++;
      max = Math.max(max, inFlight);
      const gate = deferred<void>();
      gates.push(gate);
      await gate.promise;
      inFlight--;
      return n < 0 ? Result.failure(Err.validation(`Neg.${n}`, 'neg')) : Result.success(n * 10);
    };
    return { fn, gates, max: () => max, inFlight: () => inFlight };
  }

  it('is sequential by default and keeps order', async () => {
    const t = tracker();
    const p = Result.traverseAsync([1, 2, 3], t.fn);
    for (let i = 0; i < 3; i++) {
      await tick();
      expect(t.inFlight()).toBe(1);
      t.gates[i]!.resolve();
    }
    expect(await p).toEqual(Result.success([10, 20, 30]));
    expect(t.max()).toBe(1);
  });

  it('respects the concurrency limit and reaches it', async () => {
    const t = tracker();
    const p = Result.traverseAsync([1, 2, 3, 4, 5], t.fn, { concurrency: 2 });
    await tick();
    expect(t.inFlight()).toBe(2);
    expect(t.gates).toHaveLength(2);
    // finish out of order: second first
    t.gates[1]!.resolve();
    await tick();
    expect(t.inFlight()).toBe(2);
    t.gates[0]!.resolve();
    await tick();
    expect(t.gates).toHaveLength(4);
    for (let i = 2; i < 5; i++) {
      expect(t.inFlight()).toBeLessThanOrEqual(2);
      t.gates[i]!.resolve();
      await tick();
    }
    expect(await p).toEqual(Result.success([10, 20, 30, 40, 50]));
    expect(t.max()).toBe(2);
  });

  it('concurrency Infinity starts every item at once', async () => {
    const t = tracker();
    const p = Result.traverseAsync([1, 2, 3, 4], t.fn, { concurrency: Number.POSITIVE_INFINITY });
    await tick();
    expect(t.inFlight()).toBe(4);
    for (const g of t.gates) g.resolve();
    expect(await p).toEqual(Result.success([10, 20, 30, 40]));
  });

  it('collects all errors in item order even when completed out of order', async () => {
    const t = tracker();
    const p = Result.traverseAsync([-1, 2, -3], t.fn, { concurrency: 3 });
    await tick();
    t.gates[2]!.resolve();
    t.gates[1]!.resolve();
    t.gates[0]!.resolve();
    const r = await p;
    if (!r.ok) expect(r.errors.map((e) => e.code)).toEqual(['Neg.-1', 'Neg.-3']);
    expect(r.ok).toBe(false);
  });

  it.each([0, -1, Number.NaN, 1.5])('rejects invalid concurrency %s with RangeError', async (n) => {
    await expect(
      Result.traverseAsync([1], async (x) => Result.success(x), { concurrency: n }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('passes the signal to fn and stops starting items after abort', async () => {
    const c = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const fn = vi.fn(async (n: number, signal?: AbortSignal) => {
      seen.push(signal);
      if (n === 1) c.abort();
      return Result.success(n);
    });
    await expect(Result.traverseAsync([1, 2, 3], fn, { signal: c.signal })).rejects.toBe(
      c.signal.reason,
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(seen[0]).toBe(c.signal);
  });

  it('never calls fn when the signal is already aborted', async () => {
    const c = new AbortController();
    c.abort();
    const fn = vi.fn(async (n: number) => Result.success(n));
    await expect(Result.traverseAsync([1, 2], fn, { signal: c.signal })).rejects.toBe(
      c.signal.reason,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('stops after a thrown error (sequential) and rethrows it', async () => {
    const boom = new Error('boom');
    const fn = vi.fn(async (n: number) => {
      if (n === 2) throw boom;
      return Result.success(n);
    });
    await expect(Result.traverseAsync([1, 2, 3], fn)).rejects.toBe(boom);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('with concurrency, settles in-flight items before rethrowing and starts no more', async () => {
    const boom = new Error('boom');
    const slow = deferred<void>();
    let slowDone = false;
    const fn = vi.fn(async (n: number) => {
      if (n === 1) throw boom;
      if (n === 2) {
        await slow.promise;
        slowDone = true;
      }
      return Result.success(n);
    });
    const p = Result.traverseAsync([1, 2, 3, 4], fn, { concurrency: 2 });
    let rejected = false;
    p.catch(() => {
      rejected = true;
    });
    await tick();
    expect(rejected).toBe(false);
    slow.resolve();
    await expect(p).rejects.toBe(boom);
    expect(slowDone).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('empty input succeeds with []', async () => {
    expect(await Result.traverseAsync([], async () => Result.success(1))).toEqual(
      Result.success([]),
    );
  });
});

describe('Result.firstFailureOrSuccesses', () => {
  it('returns all values when none failed', () => {
    expect(Result.firstFailureOrSuccesses([Result.success(1), Result.success(2)])).toEqual(
      Result.success([1, 2]),
    );
  });

  it('returns only the first failure and stops iterating', () => {
    const visited: number[] = [];
    function* gen(): Generator<Result<number>> {
      visited.push(0);
      yield Result.success(0);
      visited.push(1);
      yield Result.failure(validation, notFound);
      visited.push(2);
      yield Result.failure(conflict);
    }
    const r = Result.firstFailureOrSuccesses(gen());
    if (!r.ok) expect(r.errors).toEqual([validation, notFound]);
    expect(r.ok).toBe(false);
    expect(visited).toEqual([0, 1]);
  });
});

// ─── 13. ResultAsync additional members ────────────────────────────────────────

describe('ResultAsync additional members', () => {
  it('tapErrorIf runs (and awaits) only when the condition holds', async () => {
    const seen: string[] = [];
    await ResultAsync.failure(validation).tapErrorIf(true, async (errs) => {
      await tick();
      seen.push(errs[0]!.code);
    });
    await ResultAsync.failure(validation).tapErrorIf(false, () => {
      seen.push('no');
    });
    await ResultAsync.failure(notFound).tapErrorIf(
      (errs) => errs[0]!.type === ErrorType.NotFound,
      (errs) => {
        seen.push(errs[0]!.code);
      },
    );
    await ResultAsync.success(1).tapErrorIf(true, () => {
      seen.push('success');
    });
    expect(seen).toEqual(['V.1', 'N.1']);
  });

  it('ensureNotNull fails on null/undefined and narrows otherwise', async () => {
    const a = await ResultAsync.success<string | null>(null).ensureNotNull(validation);
    const b = await ResultAsync.success<string | undefined>(undefined).ensureNotNull(validation);
    const c = await ResultAsync.success<string | null>('x').ensureNotNull(validation);
    expect(Result.firstError(a)).toBe(validation);
    expect(b.ok).toBe(false);
    expect(c).toEqual(Result.success('x'));
    const passthrough = await ResultAsync.failure<string | null>(notFound).ensureNotNull(
      validation,
    );
    expect(Result.firstError(passthrough)).toBe(notFound);
  });

  it('matchFirst receives only the first error', async () => {
    const v = await ResultAsync.failure(validation, notFound).matchFirst(
      () => 'ok',
      async (e) => e.code,
    );
    expect(v).toBe('V.1');
    expect(
      await ResultAsync.success(2).matchFirst(
        (n) => n * 2,
        () => 0,
      ),
    ).toBe(4);
  });

  it('unwrapOrElse returns value or computes (sync/async) from errors', async () => {
    expect(await ResultAsync.success(1).unwrapOrElse(() => 0)).toBe(1);
    expect(
      await ResultAsync.failure<number>(validation, notFound).unwrapOrElse((e) => e.length),
    ).toBe(2);
    expect(await ResultAsync.failure<number>(validation).unwrapOrElse(async () => 7)).toBe(7);
  });

  it('elseWith is a deprecated alias of unwrapOrElse', async () => {
    expect(await ResultAsync.failure<number>(validation).elseWith(() => 5)).toBe(5);
  });

  it('combine collects a heterogeneous tuple', async () => {
    const r = await ResultAsync.combine(
      ResultAsync.success(1),
      Promise.resolve(Result.success('a')),
      Result.success(true),
    );
    expect(r).toEqual(Result.success([1, 'a', true]));
    if (r.ok) {
      const [n, s, b]: readonly [number, string, boolean] = r.value;
      expect([n, s, b]).toEqual([1, 'a', true]);
    }
  });

  it('combine collects ALL errors', async () => {
    const r = await ResultAsync.combine(
      ResultAsync.failure<number>(validation),
      ResultAsync.success('a'),
      Promise.resolve(Result.failure<boolean>(notFound)),
    );
    if (!r.ok) expect(r.errors).toEqual([validation, notFound]);
    expect(r.ok).toBe(false);
  });
});

// ─── 13b. ResultChain async methods return ResultAsync ─────────────────────

describe('ResultChain fluent async', () => {
  it('async methods return ResultAsync and continue fluently with one await', async () => {
    const pipeline = chain(Result.success(2))
      .mapAsync(async (n) => n * 10)
      .andThen((n) => Result.success(n + 1))
      .ensure((n) => n > 0, validation)
      .map((n) => `v${n}`);
    expect(pipeline).toBeInstanceOf(ResultAsync);
    expect(await pipeline).toEqual(Result.success('v21'));
  });

  it('every *Async method returns a ResultAsync', () => {
    const c = chain(Result.success(1));
    const f = chain(Result.failure<number>(validation));
    const all = [
      c.thenAsync(async (n) => Result.success(n)),
      c.mapAsync(async (n) => n),
      c.ensureAsync(async () => true, validation),
      c.tapAsync(async () => undefined),
      f.tapErrorAsync(async () => undefined),
      f.compensateAsync(async () => Result.success(1)),
      f.mapErrorAsync(async (e) => [...e]),
      f.mapEachErrorAsync(async (e) => e),
      f.elseAsync(0),
      c.bindIfAsync(true, async (n) => Result.success(n)),
      f.compensateFirstAsync(async () => Result.success(1)),
      f.recoverAsync(ErrorType.Validation, async () => Result.success(1)),
      f.recoverFirstAsync(ErrorType.Validation, async () => Result.success(1)),
      c.toAsync(),
    ];
    for (const x of all) expect(x).toBeInstanceOf(ResultAsync);
  });

  it('async failure short-circuits through the ResultAsync pipeline', async () => {
    const fn = vi.fn((n: number) => n);
    const r = await chain(Result.failure<number>(validation))
      .thenAsync(async (n) => Result.success(n))
      .map(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(Result.firstError(r)).toBe(validation);
  });

  it('elseAsync with an async fallback factory', async () => {
    const r = await chain(Result.failure<number>(validation, notFound)).elseAsync(
      async (errs) => errs.length,
    );
    expect(r).toEqual(Result.success(2));
  });
});

// ─── 21. elseWith deprecated aliases ───────────────────────────────────────

describe('elseWith deprecated aliases', () => {
  it('Result.elseWith behaves like unwrapOrElse', () => {
    const f = Result.failure<number>(validation);
    expect(Result.elseWith(f, (e) => e.length)).toBe(Result.unwrapOrElse(f, (e) => e.length));
    expect(Result.elseWith(Result.success(3), () => 0)).toBe(3);
  });

  it('ResultChain.elseWith behaves like unwrapOrElse', () => {
    expect(chain(Result.failure<number>(validation)).elseWith(() => 4)).toBe(4);
    expect(chain(Result.success(1)).elseWith(() => 4)).toBe(1);
  });
});
