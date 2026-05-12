import { Result } from '../../src/result/result.js';
import { Err } from '../../src/errors/app-error.js';

const validationError = Err.validation('Test.Invalid', 'Test validation error');
const notFoundError = Err.notFound('Test.NotFound', 'Test not found');

describe('Result factories', () => {
  it('creates a success result', () => {
    const r = Result.success(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('creates a failure result', () => {
    const r = Result.failure(validationError);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(1);
  });

  it('creates a void success with ok()', () => {
    const r = Result.ok();
    expect(r.ok).toBe(true);
  });

  it('creates failure from error array', () => {
    const r = Result.failureFrom([validationError, notFoundError]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });

  it('successIf returns success when condition is true', () => {
    const r = Result.successIf(true, 'value', validationError);
    expect(r.ok).toBe(true);
  });

  it('successIf returns failure when condition is false', () => {
    const r = Result.successIf(false, 'value', validationError);
    expect(r.ok).toBe(false);
  });

  it('throws when failure() called with no errors', () => {
    expect(() => Result.failure()).toThrow();
  });
});

describe('Result pipeline', () => {
  it('then chains on success', () => {
    const r = Result.then(Result.success(5), n => Result.success(n * 2));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10);
  });

  it('then short-circuits on failure', () => {
    const called: boolean[] = [];
    const r = Result.then(
      Result.failure(validationError),
      () => { called.push(true); return Result.success(99); }
    );
    expect(r.ok).toBe(false);
    expect(called).toHaveLength(0);
  });

  it('map transforms the value', () => {
    const r = Result.map(Result.success('hello'), s => s.toUpperCase());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('HELLO');
  });

  it('map passes through failure', () => {
    const r = Result.map(Result.failure<string>(validationError), s => s.toUpperCase());
    expect(r.ok).toBe(false);
  });

  it('ensure passes when predicate is true', () => {
    const r = Result.ensure(Result.success(10), n => n > 5, validationError);
    expect(r.ok).toBe(true);
  });

  it('ensure fails when predicate is false', () => {
    const r = Result.ensure(Result.success(3), n => n > 5, validationError);
    expect(r.ok).toBe(false);
  });

  it('tap runs side effect on success', () => {
    const seen: number[] = [];
    const r = Result.tap(Result.success(42), n => seen.push(n));
    expect(r.ok).toBe(true);
    expect(seen).toEqual([42]);
  });

  it('tap skips side effect on failure', () => {
    const seen: number[] = [];
    Result.tap(Result.failure<number>(validationError), n => seen.push(n));
    expect(seen).toHaveLength(0);
  });

  it('tapError runs on failure', () => {
    const seen: string[] = [];
    Result.tapError(Result.failure(validationError), errs => seen.push(errs[0]!.code));
    expect(seen).toEqual(['Test.Invalid']);
  });

  it('match returns success branch value', () => {
    const msg = Result.match(Result.success(42), v => `Got ${v}`, () => 'Failed');
    expect(msg).toBe('Got 42');
  });

  it('match returns error branch value', () => {
    const msg = Result.match(Result.failure(validationError), () => 'OK', errs => errs[0]!.code);
    expect(msg).toBe('Test.Invalid');
  });

  it('else returns fallback on failure', () => {
    const r = Result.else(Result.failure<number>(validationError), 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });

  it('else passes through success', () => {
    const r = Result.else(Result.success(42), 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('compensate recovers from failure', () => {
    const r = Result.compensate(
      Result.failure<number>(validationError),
      () => Result.success(-1)
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(-1);
  });
});

describe('Result.try', () => {
  it('wraps a successful function', () => {
    const r = Result.try(() => JSON.parse('{"a":1}') as unknown);
    expect(r.ok).toBe(true);
  });

  it('catches thrown errors', () => {
    const r = Result.try(() => JSON.parse('{invalid}') as unknown);
    expect(r.ok).toBe(false);
  });

  it('tryAsync wraps async success', async () => {
    const r = await Result.tryAsync(async () => 42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('tryAsync catches async errors', async () => {
    const r = await Result.tryAsync(async () => { throw new Error('boom'); });
    expect(r.ok).toBe(false);
  });
});

describe('Result combination', () => {
  it('and collects all successes', () => {
    const r = Result.and([Result.success(1), Result.success(2), Result.success(3)]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([1, 2, 3]);
  });

  it('and collects ALL errors (not short-circuit)', () => {
    const r = Result.and([
      Result.failure(validationError),
      Result.failure(notFoundError),
      Result.success(3),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });

  it('or returns first success', () => {
    const r = Result.or([Result.failure(validationError), Result.success(99)]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(99);
  });

  it('or returns all errors when all fail', () => {
    const r = Result.or([Result.failure(validationError), Result.failure(notFoundError)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });
});

describe('Result.unwrap', () => {
  it('returns value on success', () => {
    expect(Result.unwrap(Result.success(7))).toBe(7);
  });

  it('throws ResultUnwrapError on failure', () => {
    expect(() => Result.unwrap(Result.failure(validationError))).toThrow('Cannot unwrap a failed Result');
  });
});

describe('Result utilities', () => {
  it('unwrapOr returns value on success', () => {
    expect(Result.unwrapOr(Result.success(42), 0)).toBe(42);
  });

  it('unwrapOr returns default on failure', () => {
    expect(Result.unwrapOr(Result.failure<number>(validationError), -1)).toBe(-1);
  });

  it('unwrapOrElse calls fn on failure', () => {
    const r = Result.unwrapOrElse(Result.failure<number>(validationError), errs => errs.length);
    expect(r).toBe(1);
  });

  it('unwrapOrElse returns value on success', () => {
    expect(Result.unwrapOrElse(Result.success(5), () => -1)).toBe(5);
  });

  it('flatten unwraps nested success', () => {
    const nested = Result.success(Result.success(42));
    const flat = Result.flatten(nested);
    expect(flat.ok).toBe(true);
    if (flat.ok) expect(flat.value).toBe(42);
  });

  it('flatten propagates outer failure', () => {
    const r = Result.flatten(Result.failure<Result<number>>(validationError));
    expect(r.ok).toBe(false);
  });

  it('flatten propagates inner failure', () => {
    const r = Result.flatten(Result.success(Result.failure<number>(validationError)));
    expect(r.ok).toBe(false);
  });
});

describe('Result async pipeline', () => {
  it('tapAsync runs on success', async () => {
    const seen: number[] = [];
    const r = await Result.tapAsync(Result.success(7), async n => { seen.push(n); });
    expect(r.ok).toBe(true);
    expect(seen).toEqual([7]);
  });

  it('tapAsync skips on failure', async () => {
    const seen: number[] = [];
    await Result.tapAsync(Result.failure<number>(validationError), async n => { seen.push(n); });
    expect(seen).toHaveLength(0);
  });

  it('tapErrorAsync runs on failure', async () => {
    const seen: string[] = [];
    await Result.tapErrorAsync(Result.failure(validationError), async errs => { seen.push(errs[0]!.code); });
    expect(seen).toEqual(['Test.Invalid']);
  });

  it('tapErrorAsync skips on success', async () => {
    const seen: string[] = [];
    await Result.tapErrorAsync(Result.success(1), async errs => { seen.push(errs[0]!.code); });
    expect(seen).toHaveLength(0);
  });

  it('compensateAsync recovers from failure', async () => {
    const r = await Result.compensateAsync(
      Result.failure<number>(validationError),
      async () => Result.success(99),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(99);
  });

  it('compensateAsync passes through success', async () => {
    const r = await Result.compensateAsync(Result.success(5), async () => Result.success(99));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(5);
  });

  it('mapErrorAsync transforms errors', async () => {
    const r = await Result.mapErrorAsync(
      Result.failure<number>(validationError),
      async errs => errs.map(e => ({ ...e, code: `WRAPPED.${e.code}` })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('WRAPPED.Test.Invalid');
  });

  it('mapErrorAsync passes through success', async () => {
    const r = await Result.mapErrorAsync(Result.success(42), async errs => errs);
    expect(r.ok).toBe(true);
  });
});

describe('Result new pipeline methods', () => {
  // ─── bindIf ───────────────────────────────────────────────────────────────

  it('bindIf chains fn when condition is true', () => {
    const r = Result.bindIf(Result.success(5), true, n => Result.success(n * 2));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10);
  });

  it('bindIf skips fn when condition is false', () => {
    const called: boolean[] = [];
    const r = Result.bindIf(Result.success(5), false, n => { called.push(true); return Result.success(n * 2); });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(5);
    expect(called).toHaveLength(0);
  });

  it('bindIf chains fn when predicate returns true', () => {
    const r = Result.bindIf(Result.success(10), n => n > 5, n => Result.success(n + 1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(11);
  });

  it('bindIf skips fn when predicate returns false', () => {
    const r = Result.bindIf(Result.success(3), n => n > 5, n => Result.success(n + 1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(3);
  });

  it('bindIf short-circuits on failure', () => {
    const called: boolean[] = [];
    const r = Result.bindIf(Result.failure<number>(validationError), true, n => { called.push(true); return Result.success(n); });
    expect(r.ok).toBe(false);
    expect(called).toHaveLength(0);
  });

  // ─── tapIf ────────────────────────────────────────────────────────────────

  it('tapIf runs fn when condition is true', () => {
    const seen: number[] = [];
    const r = Result.tapIf(Result.success(42), true, n => seen.push(n));
    expect(r.ok).toBe(true);
    expect(seen).toEqual([42]);
  });

  it('tapIf skips fn when condition is false', () => {
    const seen: number[] = [];
    Result.tapIf(Result.success(42), false, n => seen.push(n));
    expect(seen).toHaveLength(0);
  });

  it('tapIf skips fn on failure', () => {
    const seen: number[] = [];
    Result.tapIf(Result.failure<number>(validationError), true, n => seen.push(n));
    expect(seen).toHaveLength(0);
  });

  // ─── tapErrorIf ───────────────────────────────────────────────────────────

  it('tapErrorIf runs fn on failure when condition is true', () => {
    const seen: string[] = [];
    Result.tapErrorIf(Result.failure(validationError), true, errs => seen.push(errs[0]!.code));
    expect(seen).toEqual(['Test.Invalid']);
  });

  it('tapErrorIf skips fn on failure when condition is false', () => {
    const seen: string[] = [];
    Result.tapErrorIf(Result.failure(validationError), false, errs => seen.push(errs[0]!.code));
    expect(seen).toHaveLength(0);
  });

  it('tapErrorIf runs fn on failure when predicate returns true', () => {
    const seen: number[] = [];
    Result.tapErrorIf(Result.failure(validationError), errs => errs.length > 0, errs => seen.push(errs.length));
    expect(seen).toEqual([1]);
  });

  it('tapErrorIf skips fn on success', () => {
    const seen: string[] = [];
    Result.tapErrorIf(Result.success(1), true, errs => seen.push(errs[0]!.code));
    expect(seen).toHaveLength(0);
  });

  // ─── compensateFirst ──────────────────────────────────────────────────────

  it('compensateFirst recovers using first error', () => {
    const r = Result.compensateFirst(
      Result.failureFrom([validationError, notFoundError]),
      firstErr => Result.success(firstErr.code),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Test.Invalid');
  });

  it('compensateFirst passes through success', () => {
    const called: boolean[] = [];
    const r = Result.compensateFirst(Result.success(99), err => { called.push(true); return Result.success(err.code); });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(99);
    expect(called).toHaveLength(0);
  });

  // ─── recover ──────────────────────────────────────────────────────────────

  it('recover recovers when predicate matches first error', () => {
    const r = Result.recover(
      Result.failure(validationError),
      err => err.code === 'Test.Invalid',
      () => Result.success('recovered'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('recovered');
  });

  it('recover passes through when predicate does not match', () => {
    const r = Result.recover(
      Result.failure(notFoundError),
      err => err.code === 'Test.Invalid',
      () => Result.success('recovered'),
    );
    expect(r.ok).toBe(false);
  });

  it('recover passes through success', () => {
    const called: boolean[] = [];
    const r = Result.recover(
      Result.success('original'),
      () => { called.push(true); return true; },
      () => Result.success('recovered'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('original');
    expect(called).toHaveLength(0);
  });

  // ─── always ───────────────────────────────────────────────────────────────

  it('always calls fn with success result and returns fn result', () => {
    const seen: boolean[] = [];
    const out = Result.always(Result.success(42), r => { seen.push(r.ok); return 'done'; });
    expect(seen).toEqual([true]);
    expect(out).toBe('done');
  });

  it('always calls fn with failure result', () => {
    const seen: boolean[] = [];
    const out = Result.always(Result.failure(validationError), r => { seen.push(r.ok); return 'cleaned'; });
    expect(seen).toEqual([false]);
    expect(out).toBe('cleaned');
  });

  // ─── combine ──────────────────────────────────────────────────────────────

  it('combine succeeds with tuple when all succeed', () => {
    const r = Result.combine(Result.success(1), Result.success('hello'), Result.success(true));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([1, 'hello', true]);
  });

  it('combine collects all errors when some fail', () => {
    const r = Result.combine(
      Result.success(1),
      Result.failure(validationError),
      Result.failure(notFoundError),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });

  it('combine with single success', () => {
    const r = Result.combine(Result.success(42));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([42]);
  });

  it('combine with all failures collects all errors', () => {
    const r = Result.combine(Result.failure(validationError), Result.failure(notFoundError));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });
});
