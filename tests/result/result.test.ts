import { Err } from '../../src/errors/app-error.js';
import { Result } from '../../src/result/result.js';

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

  it('failIf returns failure when condition is true', () => {
    const r = Result.failIf(true, 'value', validationError);
    expect(r.ok).toBe(false);
  });

  it('failIf returns success when condition is false', () => {
    const r = Result.failIf(false, 'value', validationError);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('value');
  });

  it('throws when failure() called with no errors', () => {
    expect(() => Result.failure()).toThrow();
  });

  it('throws when failureFrom() called with empty array', () => {
    expect(() => Result.failureFrom([])).toThrow();
  });
});

describe('Result type guards', () => {
  it('isSuccess returns true for success', () => {
    expect(Result.isSuccess(Result.success(1))).toBe(true);
  });

  it('isSuccess returns false for failure', () => {
    expect(Result.isSuccess(Result.failure(validationError))).toBe(false);
  });

  it('isFailure returns true for failure', () => {
    expect(Result.isFailure(Result.failure(validationError))).toBe(true);
  });

  it('isFailure returns false for success', () => {
    expect(Result.isFailure(Result.success(1))).toBe(false);
  });
});

describe('Result error accessors', () => {
  it('firstError returns first error from failure', () => {
    const r = Result.failureFrom([validationError, notFoundError]);
    const err = Result.firstError(r);
    expect(err.code).toBe('Test.Invalid');
  });

  it('firstError returns fallback when called on success', () => {
    const err = Result.firstError(Result.success(1));
    expect(err.code).toBe('Result.NoFirstError');
  });

  it('firstError returns fallback for empty errors (edge)', () => {
    // This should not happen due to factory validation, but we cover the branch
    const fakeFailure = { ok: false as const, errors: [] as const };
    const err = Result.firstError(fakeFailure);
    expect(err.code).toBe('Result.Empty');
  });

  it('lastError returns last error from failure', () => {
    const r = Result.failureFrom([validationError, notFoundError]);
    const err = Result.lastError(r);
    expect(err.code).toBe('Test.NotFound');
  });

  it('lastError returns fallback when called on success', () => {
    const err = Result.lastError(Result.success(1));
    expect(err.code).toBe('Result.NoLastError');
  });

  it('lastError returns fallback for empty errors (edge)', () => {
    const fakeFailure = { ok: false as const, errors: [] as const };
    const err = Result.lastError(fakeFailure);
    expect(err.code).toBe('Result.Empty');
  });
});

describe('Result pipeline', () => {
  it('then chains on success', () => {
    const r = Result.then(Result.success(5), (n) => Result.success(n * 2));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10);
  });

  it('then short-circuits on failure', () => {
    const called: boolean[] = [];
    const r = Result.then(Result.failure(validationError), () => {
      called.push(true);
      return Result.success(99);
    });
    expect(r.ok).toBe(false);
    expect(called).toHaveLength(0);
  });

  it('map transforms the value', () => {
    const r = Result.map(Result.success('hello'), (s) => s.toUpperCase());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('HELLO');
  });

  it('map passes through failure', () => {
    const r = Result.map(Result.failure<string>(validationError), (s) => s.toUpperCase());
    expect(r.ok).toBe(false);
  });

  it('ensure passes when predicate is true', () => {
    const r = Result.ensure(Result.success(10), (n) => n > 5, validationError);
    expect(r.ok).toBe(true);
  });

  it('ensure fails when predicate is false', () => {
    const r = Result.ensure(Result.success(3), (n) => n > 5, validationError);
    expect(r.ok).toBe(false);
  });

  it('ensure supports function error factory', () => {
    const r = Result.ensure(
      Result.success(3),
      (n) => n > 5,
      (n) => Err.validation('Value.TooSmall', `Value ${n} is too small`),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.description).toBe('Value 3 is too small');
  });

  it('tap runs side effect on success', () => {
    const seen: number[] = [];
    const r = Result.tap(Result.success(42), (n) => seen.push(n));
    expect(r.ok).toBe(true);
    expect(seen).toEqual([42]);
  });

  it('tap skips side effect on failure', () => {
    const seen: number[] = [];
    Result.tap(Result.failure<number>(validationError), (n) => seen.push(n));
    expect(seen).toHaveLength(0);
  });

  it('tapError runs on failure', () => {
    const seen: string[] = [];
    Result.tapError(Result.failure(validationError), (errs) => seen.push(errs[0]!.code));
    expect(seen).toEqual(['Test.Invalid']);
  });

  it('tapError skips on success', () => {
    const seen: string[] = [];
    Result.tapError(Result.success(1), (errs) => seen.push(errs[0]!.code));
    expect(seen).toHaveLength(0);
  });

  it('mapError transforms errors', () => {
    const r = Result.mapError(Result.failure<number>(validationError), (errs) =>
      errs.map((e) => ({ ...e, code: `WRAPPED.${e.code}` })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('WRAPPED.Test.Invalid');
  });

  it('mapError passes through success', () => {
    const r = Result.mapError(Result.success(42), (errs) => errs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('match returns success branch value', () => {
    const msg = Result.match(
      Result.success(42),
      (v) => `Got ${v}`,
      () => 'Failed',
    );
    expect(msg).toBe('Got 42');
  });

  it('match returns error branch value', () => {
    const msg = Result.match(
      Result.failure(validationError),
      () => 'OK',
      (errs) => errs[0]!.code,
    );
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

  it('else calls factory function on failure', () => {
    const r = Result.else(Result.failure<number>(validationError), (errs) => errs.length);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1);
  });

  it('compensate recovers from failure', () => {
    const r = Result.compensate(Result.failure<number>(validationError), () => Result.success(-1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(-1);
  });

  it('compensate passes through success', () => {
    const called: boolean[] = [];
    const r = Result.compensate(Result.success(5), () => {
      called.push(true);
      return Result.success(-1);
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(5);
    expect(called).toHaveLength(0);
  });

  it('deconstruct returns tuple for success', () => {
    const [ok, value, errors] = Result.deconstruct(Result.success(42));
    expect(ok).toBe(true);
    expect(value).toBe(42);
    expect(errors).toBeNull();
  });

  it('deconstruct returns tuple for failure', () => {
    const [ok, value, errors] = Result.deconstruct(Result.failure(validationError));
    expect(ok).toBe(false);
    expect(value).toBeNull();
    expect(errors).toHaveLength(1);
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

  it('uses custom onError mapper', () => {
    const r = Result.try(
      () => {
        throw new Error('boom');
      },
      () => Err.validation('Custom', 'Mapped'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('Custom');
  });

  it('tryAsync wraps async success', async () => {
    const r = await Result.tryAsync(async () => 42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('tryAsync catches async errors', async () => {
    const r = await Result.tryAsync(async () => {
      throw new Error('boom');
    });
    expect(r.ok).toBe(false);
  });

  it('tryAsync uses custom onError mapper', async () => {
    const r = await Result.tryAsync(
      async () => {
        throw new Error('async boom');
      },
      () => Err.validation('Custom.Async', 'Mapped async'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('Custom.Async');
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

  it('and returns empty array for empty input', () => {
    const r = Result.and([]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
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

  it('or returns failure for empty input (no errors to collect)', () => {
    const r = Result.or([]);
    expect(Result.isFailure(r)).toBe(true);
  });
});

describe('Result.unwrap', () => {
  it('returns value on success', () => {
    expect(Result.unwrap(Result.success(7))).toBe(7);
  });

  it('throws ResultUnwrapError on failure', () => {
    expect(() => Result.unwrap(Result.failure(validationError))).toThrow(
      'Cannot unwrap a failed Result',
    );
  });

  it('ResultUnwrapError contains errors array', () => {
    try {
      Result.unwrap(Result.failure(validationError));
      expect.fail('should have thrown');
    } catch (e) {
      if (e instanceof Error && 'errors' in e) {
        expect((e as { errors: unknown }).errors).toHaveLength(1);
      }
    }
  });

  it('ResultUnwrapError has correct name', () => {
    try {
      Result.unwrap(Result.failure(validationError));
      expect.fail('should have thrown');
    } catch (e) {
      expect(e instanceof Error && e.name).toBe('ResultUnwrapError');
    }
  });

  it('ResultUnwrapError message contains error codes', () => {
    try {
      Result.unwrap(Result.failure(validationError));
      expect.fail('should have thrown');
    } catch (e) {
      expect(e instanceof Error && e.message).toContain('Test.Invalid');
    }
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
    const r = Result.unwrapOrElse(Result.failure<number>(validationError), (errs) => errs.length);
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
  it('thenAsync chains on success', async () => {
    const r = await Result.thenAsync(Result.success(5), async (n) => Result.success(n * 2));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10);
  });

  it('thenAsync short-circuits on failure', async () => {
    const called: boolean[] = [];
    const r = await Result.thenAsync(Result.failure<number>(validationError), async () => {
      called.push(true);
      return Result.success(99);
    });
    expect(r.ok).toBe(false);
    expect(called).toHaveLength(0);
  });

  it('mapAsync transforms the value', async () => {
    const r = await Result.mapAsync(Result.success('hello'), async (s) => s.toUpperCase());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('HELLO');
  });

  it('mapAsync passes through failure', async () => {
    const r = await Result.mapAsync(Result.failure<string>(validationError), async (s) =>
      s.toUpperCase(),
    );
    expect(r.ok).toBe(false);
  });

  it('ensureAsync passes when predicate resolves true', async () => {
    const r = await Result.ensureAsync(Result.success(10), async (n) => n > 5, validationError);
    expect(r.ok).toBe(true);
  });

  it('ensureAsync fails when predicate resolves false', async () => {
    const r = await Result.ensureAsync(Result.success(3), async (n) => n > 5, validationError);
    expect(r.ok).toBe(false);
  });

  it('ensureAsync supports function error factory', async () => {
    const r = await Result.ensureAsync(
      Result.success(3),
      async (n) => n > 5,
      (n) => Err.validation('Value.TooSmall', `Value ${n} is too small`),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.description).toBe('Value 3 is too small');
  });

  it('tapAsync runs on success', async () => {
    const seen: number[] = [];
    const r = await Result.tapAsync(Result.success(7), async (n) => {
      seen.push(n);
    });
    expect(r.ok).toBe(true);
    expect(seen).toEqual([7]);
  });

  it('tapAsync skips on failure', async () => {
    const seen: number[] = [];
    await Result.tapAsync(Result.failure<number>(validationError), async (n) => {
      seen.push(n);
    });
    expect(seen).toHaveLength(0);
  });

  it('tapErrorAsync runs on failure', async () => {
    const seen: string[] = [];
    await Result.tapErrorAsync(Result.failure(validationError), async (errs) => {
      seen.push(errs[0]!.code);
    });
    expect(seen).toEqual(['Test.Invalid']);
  });

  it('tapErrorAsync skips on success', async () => {
    const seen: string[] = [];
    await Result.tapErrorAsync(Result.success(1), async (errs) => {
      seen.push(errs[0]!.code);
    });
    expect(seen).toHaveLength(0);
  });

  it('compensateAsync recovers from failure', async () => {
    const r = await Result.compensateAsync(Result.failure<number>(validationError), async () =>
      Result.success(99),
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
    const r = await Result.mapErrorAsync(Result.failure<number>(validationError), async (errs) =>
      errs.map((e) => ({ ...e, code: `WRAPPED.${e.code}` })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('WRAPPED.Test.Invalid');
  });

  it('mapErrorAsync passes through success', async () => {
    const r = await Result.mapErrorAsync(Result.success(42), async (errs) => errs);
    expect(r.ok).toBe(true);
  });
});

describe('Result new pipeline methods', () => {
  // ─── bindIf ───────────────────────────────────────────────────────────────

  it('bindIf chains fn when condition is true', () => {
    const r = Result.bindIf(Result.success(5), true, (n) => Result.success(n * 2));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10);
  });

  it('bindIf skips fn when condition is false', () => {
    const called: boolean[] = [];
    const r = Result.bindIf(Result.success(5), false, (n) => {
      called.push(true);
      return Result.success(n * 2);
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(5);
    expect(called).toHaveLength(0);
  });

  it('bindIf chains fn when predicate returns true', () => {
    const r = Result.bindIf(
      Result.success(10),
      (n) => n > 5,
      (n) => Result.success(n + 1),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(11);
  });

  it('bindIf skips fn when predicate returns false', () => {
    const r = Result.bindIf(
      Result.success(3),
      (n) => n > 5,
      (n) => Result.success(n + 1),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(3);
  });

  it('bindIf short-circuits on failure', () => {
    const called: boolean[] = [];
    const r = Result.bindIf(Result.failure<number>(validationError), true, (n) => {
      called.push(true);
      return Result.success(n);
    });
    expect(r.ok).toBe(false);
    expect(called).toHaveLength(0);
  });

  it('bindIfAsync chains fn when condition is true', async () => {
    const r = await Result.bindIfAsync(Result.success(5), true, async (n) => Result.success(n * 2));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10);
  });

  it('bindIfAsync skips fn when condition is false', async () => {
    const called: boolean[] = [];
    const r = await Result.bindIfAsync(Result.success(5), false, async (n) => {
      called.push(true);
      return Result.success(n * 2);
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(5);
    expect(called).toHaveLength(0);
  });

  it('bindIfAsync chains fn when predicate returns true', async () => {
    const r = await Result.bindIfAsync(
      Result.success(10),
      (n) => n > 5,
      async (n) => Result.success(n + 1),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(11);
  });

  it('bindIfAsync short-circuits on failure', async () => {
    const called: boolean[] = [];
    const r = await Result.bindIfAsync(Result.failure<number>(validationError), true, async (n) => {
      called.push(true);
      return Result.success(n);
    });
    expect(r.ok).toBe(false);
    expect(called).toHaveLength(0);
  });

  // ─── tapIf ────────────────────────────────────────────────────────────────

  it('tapIf runs fn when condition is true', () => {
    const seen: number[] = [];
    const r = Result.tapIf(Result.success(42), true, (n) => seen.push(n));
    expect(r.ok).toBe(true);
    expect(seen).toEqual([42]);
  });

  it('tapIf skips fn when condition is false', () => {
    const seen: number[] = [];
    Result.tapIf(Result.success(42), false, (n) => seen.push(n));
    expect(seen).toHaveLength(0);
  });

  it('tapIf runs fn when predicate returns true', () => {
    const seen: number[] = [];
    Result.tapIf(
      Result.success(42),
      (n) => n > 10,
      (n) => seen.push(n),
    );
    expect(seen).toEqual([42]);
  });

  it('tapIf skips fn when predicate returns false', () => {
    const seen: number[] = [];
    Result.tapIf(
      Result.success(42),
      (n) => n > 100,
      (n) => seen.push(n),
    );
    expect(seen).toHaveLength(0);
  });

  it('tapIf skips fn on failure', () => {
    const seen: number[] = [];
    Result.tapIf(Result.failure<number>(validationError), true, (n) => seen.push(n));
    expect(seen).toHaveLength(0);
  });

  // ─── tapErrorIf ───────────────────────────────────────────────────────────

  it('tapErrorIf runs fn on failure when condition is true', () => {
    const seen: string[] = [];
    Result.tapErrorIf(Result.failure(validationError), true, (errs) => seen.push(errs[0]!.code));
    expect(seen).toEqual(['Test.Invalid']);
  });

  it('tapErrorIf skips fn on failure when condition is false', () => {
    const seen: string[] = [];
    Result.tapErrorIf(Result.failure(validationError), false, (errs) => seen.push(errs[0]!.code));
    expect(seen).toHaveLength(0);
  });

  it('tapErrorIf runs fn on failure when predicate returns true', () => {
    const seen: number[] = [];
    Result.tapErrorIf(
      Result.failure(validationError),
      (errs) => errs.length > 0,
      (errs) => seen.push(errs.length),
    );
    expect(seen).toEqual([1]);
  });

  it('tapErrorIf skips fn on failure when predicate returns false', () => {
    const seen: number[] = [];
    Result.tapErrorIf(
      Result.failure(validationError),
      (errs) => errs.length > 5,
      (errs) => seen.push(errs.length),
    );
    expect(seen).toHaveLength(0);
  });

  it('tapErrorIf skips fn on success', () => {
    const seen: string[] = [];
    Result.tapErrorIf(Result.success(1), true, (errs) => seen.push(errs[0]!.code));
    expect(seen).toHaveLength(0);
  });

  // ─── compensateFirst ──────────────────────────────────────────────────────

  it('compensateFirst recovers using first error', () => {
    const r = Result.compensateFirst(
      Result.failureFrom([validationError, notFoundError]),
      (firstErr) => Result.success(firstErr.code),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Test.Invalid');
  });

  it('compensateFirst passes through success', () => {
    const called: boolean[] = [];
    const r = Result.compensateFirst(Result.success(99), (err) => {
      called.push(true);
      return Result.success(err.code);
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(99);
    expect(called).toHaveLength(0);
  });

  it('compensateFirstAsync recovers using first error', async () => {
    const r = await Result.compensateFirstAsync(
      Result.failureFrom([validationError, notFoundError]),
      async (firstErr) => Result.success(firstErr.code),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Test.Invalid');
  });

  it('compensateFirstAsync passes through success', async () => {
    const called: boolean[] = [];
    const r = await Result.compensateFirstAsync(Result.success(99), async (err) => {
      called.push(true);
      return Result.success(err.code);
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(99);
    expect(called).toHaveLength(0);
  });

  // ─── recover ──────────────────────────────────────────────────────────────

  it('recover recovers when predicate matches first error', () => {
    const r = Result.recover(
      Result.failure(validationError),
      (err) => err.code === 'Test.Invalid',
      () => Result.success('recovered'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('recovered');
  });

  it('recover passes through when predicate does not match', () => {
    const r = Result.recover(
      Result.failure(notFoundError),
      (err) => err.code === 'Test.Invalid',
      () => Result.success('recovered'),
    );
    expect(r.ok).toBe(false);
  });

  it('recover passes through success', () => {
    const called: boolean[] = [];
    const r = Result.recover(
      Result.success('original'),
      () => {
        called.push(true);
        return true;
      },
      () => Result.success('recovered'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('original');
    expect(called).toHaveLength(0);
  });

  it('recoverAsync recovers when predicate matches', async () => {
    const r = await Result.recoverAsync(
      Result.failure(validationError),
      (err) => err.code === 'Test.Invalid',
      async () => Result.success('recovered'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('recovered');
  });

  it('recoverAsync passes through when predicate does not match', async () => {
    const r = await Result.recoverAsync(
      Result.failure(notFoundError),
      (err) => err.code === 'Test.Invalid',
      async () => Result.success('recovered'),
    );
    expect(r.ok).toBe(false);
  });

  it('recoverAsync passes through success', async () => {
    const called: boolean[] = [];
    const r = await Result.recoverAsync(
      Result.success('original'),
      async () => {
        called.push(true);
        return true;
      },
      async () => Result.success('recovered'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('original');
    expect(called).toHaveLength(0);
  });

  // ─── always ───────────────────────────────────────────────────────────────

  it('always calls fn with success result and returns fn result', () => {
    const seen: boolean[] = [];
    const out = Result.always(Result.success(42), (r) => {
      seen.push(r.ok);
      return 'done';
    });
    expect(seen).toEqual([true]);
    expect(out).toBe('done');
  });

  it('always calls fn with failure result', () => {
    const seen: boolean[] = [];
    const out = Result.always(Result.failure(validationError), (r) => {
      seen.push(r.ok);
      return 'cleaned';
    });
    expect(seen).toEqual([false]);
    expect(out).toBe('cleaned');
  });

  it('alwaysAsync calls fn with success result', async () => {
    const seen: boolean[] = [];
    const out = await Result.alwaysAsync(Result.success(42), async (r) => {
      seen.push(r.ok);
      return 'done';
    });
    expect(seen).toEqual([true]);
    expect(out).toBe('done');
  });

  it('alwaysAsync calls fn with failure result', async () => {
    const seen: boolean[] = [];
    const out = await Result.alwaysAsync(Result.failure(validationError), async (r) => {
      seen.push(r.ok);
      return 'cleaned';
    });
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

  it('combine with no arguments succeeds with empty tuple', () => {
    const r = Result.combine();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });
});

describe('Result.elseWith', () => {
  it('returns value when success', () => {
    const r = Result.success(42);
    const val = Result.elseWith(r, () => 0);
    expect(val).toBe(42);
  });

  it('calls factory with errors when failure', () => {
    const err = Err.validation('Code', 'msg');
    const r = Result.failure<number>(err);
    const val = Result.elseWith(r, (errs) => errs.length);
    expect(val).toBe(1);
  });

  it('works correctly when T is a function type', () => {
    const fn = () => 42;
    const r = Result.failure<() => number>(Err.validation('Code', 'msg'));
    const val = Result.elseWith(r, () => fn);
    expect(val).toBe(fn);
  });

  it('Result.or([]) returns failure instead of throwing', () => {
    const r = Result.or([]);
    expect(Result.isFailure(r)).toBe(true);
    expect(Result.firstError(r)?.code).toBe('Result.Or.Empty');
  });
});

// ─── Coverage: uncovered functions and branches ──────────────────────────────

describe('Result.tryGet', () => {
  it('returns [true, value, undefined] on success', () => {
    const [ok, value, errors] = Result.tryGet(Result.success(42));
    expect(ok).toBe(true);
    expect(value).toBe(42);
    expect(errors).toBeUndefined();
  });

  it('returns [false, undefined, errors] on failure', () => {
    const [ok, value, errors] = Result.tryGet(Result.failure(validationError));
    expect(ok).toBe(false);
    expect(value).toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});

describe('Result.switch', () => {
  it('calls onSuccess for success result', () => {
    const seen: number[] = [];
    Result.switch(
      Result.success(42),
      (v) => seen.push(v),
      () => seen.push(-1),
    );
    expect(seen).toEqual([42]);
  });

  it('calls onError for failure result', () => {
    const seen: string[] = [];
    Result.switch(
      Result.failure(validationError),
      () => seen.push('ok'),
      (errs) => seen.push(errs[0]!.code),
    );
    expect(seen).toEqual(['Test.Invalid']);
  });
});

describe('Result.matchFirst', () => {
  it('returns success branch value', () => {
    const msg = Result.matchFirst(
      Result.success(42),
      (v) => `Got ${v}`,
      (err) => err.code,
    );
    expect(msg).toBe('Got 42');
  });

  it('returns first error branch value', () => {
    const msg = Result.matchFirst(
      Result.failureFrom([validationError, notFoundError]),
      () => 'OK',
      (err) => err.code,
    );
    expect(msg).toBe('Test.Invalid');
  });

  it('returns fallback for empty errors (edge)', () => {
    const fakeFailure = { ok: false as const, errors: [] as const };
    const msg = Result.matchFirst(
      fakeFailure,
      () => 'OK',
      (err) => err.code,
    );
    expect(msg).toBe('Result.Empty');
  });
});

describe('Result.matchLast', () => {
  it('returns success branch value', () => {
    const msg = Result.matchLast(
      Result.success(42),
      (v) => `Got ${v}`,
      (err) => err.code,
    );
    expect(msg).toBe('Got 42');
  });

  it('returns last error branch value', () => {
    const msg = Result.matchLast(
      Result.failureFrom([validationError, notFoundError]),
      () => 'OK',
      (err) => err.code,
    );
    expect(msg).toBe('Test.NotFound');
  });

  it('returns fallback for empty errors (edge)', () => {
    const fakeFailure = { ok: false as const, errors: [] as const };
    const msg = Result.matchLast(
      fakeFailure,
      () => 'OK',
      (err) => err.code,
    );
    expect(msg).toBe('Result.Empty');
  });
});

describe('Result.switchFirst', () => {
  it('calls onSuccess for success result', () => {
    const seen: number[] = [];
    Result.switchFirst(
      Result.success(42),
      (v) => seen.push(v),
      () => seen.push(-1),
    );
    expect(seen).toEqual([42]);
  });

  it('calls onFirstError for failure result', () => {
    const seen: string[] = [];
    Result.switchFirst(
      Result.failureFrom([validationError, notFoundError]),
      () => seen.push('ok'),
      (err) => seen.push(err.code),
    );
    expect(seen).toEqual(['Test.Invalid']);
  });

  it('calls onFirstError with fallback for empty errors (edge)', () => {
    const fakeFailure = { ok: false as const, errors: [] as const };
    const seen: string[] = [];
    Result.switchFirst(
      fakeFailure,
      () => seen.push('ok'),
      (err) => seen.push(err.code),
    );
    expect(seen).toEqual(['Result.Empty']);
  });
});

describe('Result.switchLast', () => {
  it('calls onSuccess for success result', () => {
    const seen: number[] = [];
    Result.switchLast(
      Result.success(42),
      (v) => seen.push(v),
      () => seen.push(-1),
    );
    expect(seen).toEqual([42]);
  });

  it('calls onLastError for failure result', () => {
    const seen: string[] = [];
    Result.switchLast(
      Result.failureFrom([validationError, notFoundError]),
      () => seen.push('ok'),
      (err) => seen.push(err.code),
    );
    expect(seen).toEqual(['Test.NotFound']);
  });

  it('calls onLastError with fallback for empty errors (edge)', () => {
    const fakeFailure = { ok: false as const, errors: [] as const };
    const seen: string[] = [];
    Result.switchLast(
      fakeFailure,
      () => seen.push('ok'),
      (err) => seen.push(err.code),
    );
    expect(seen).toEqual(['Result.Empty']);
  });
});

describe('Result.tapErrorFirst', () => {
  it('runs fn with first error on failure', () => {
    const seen: string[] = [];
    const r = Result.tapErrorFirst(Result.failureFrom([validationError, notFoundError]), (err) =>
      seen.push(err.code),
    );
    expect(r.ok).toBe(false);
    expect(seen).toEqual(['Test.Invalid']);
  });

  it('skips fn on success', () => {
    const seen: string[] = [];
    const r = Result.tapErrorFirst(Result.success(42), (err) => seen.push(err.code));
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it('skips fn on failure with empty errors (edge)', () => {
    const fakeFailure = { ok: false as const, errors: [] as const };
    const seen: string[] = [];
    const r = Result.tapErrorFirst(fakeFailure, (err) => seen.push(err.code));
    expect(r.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });
});

describe('Result.ensureNotNull', () => {
  it('passes through non-null success', () => {
    const r = Result.ensureNotNull(Result.success(42), validationError);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('fails on null value', () => {
    const r = Result.ensureNotNull(Result.success(null), validationError);
    expect(r.ok).toBe(false);
  });

  it('fails on undefined value', () => {
    const r = Result.ensureNotNull(Result.success(undefined), validationError);
    expect(r.ok).toBe(false);
  });

  it('passes through existing failure', () => {
    const r = Result.ensureNotNull(Result.failure<number | null>(notFoundError), validationError);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('Test.NotFound');
  });
});

describe('Result.failWhen', () => {
  it('fails when predicate is true', () => {
    const r = Result.failWhen(Result.success(3), (n) => n < 5, validationError);
    expect(r.ok).toBe(false);
  });

  it('passes through when predicate is false', () => {
    const r = Result.failWhen(Result.success(10), (n) => n < 5, validationError);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10);
  });

  it('supports function error factory', () => {
    const r = Result.failWhen(
      Result.success(3),
      (n) => n < 5,
      (n) => Err.validation('Value.TooSmall', `Value ${n} is too small`),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.description).toBe('Value 3 is too small');
  });

  it('passes through existing failure', () => {
    const r = Result.failWhen(Result.failure<number>(notFoundError), () => true, validationError);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('Test.NotFound');
  });
});

describe('Result.tryCatch', () => {
  it('maps value on success', () => {
    const r = Result.tryCatch(Result.success('{"a":1}'), (s) => JSON.parse(s) as unknown);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });

  it('catches thrown error with default handler', () => {
    const r = Result.tryCatch(Result.success('{invalid}'), (s) => JSON.parse(s) as unknown);
    expect(r.ok).toBe(false);
  });

  it('catches thrown error with static AppError', () => {
    const r = Result.tryCatch(
      Result.success('{invalid}'),
      (s) => JSON.parse(s) as unknown,
      Err.validation('JSON.Bad', 'Bad JSON'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('JSON.Bad');
  });

  it('catches thrown error with function error factory', () => {
    const r = Result.tryCatch(
      Result.success('{invalid}'),
      (s) => JSON.parse(s) as unknown,
      (e) => Err.validation('JSON.Custom', String(e)),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('JSON.Custom');
  });

  it('passes through existing failure', () => {
    const r = Result.tryCatch(Result.failure<string>(notFoundError), (s) => s.toUpperCase());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('Test.NotFound');
  });
});

describe('Result.tryCatchAsync', () => {
  it('maps value on success', async () => {
    const r = await Result.tryCatchAsync(Result.success(5), async (n) => n * 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10);
  });

  it('catches thrown error with default handler', async () => {
    const r = await Result.tryCatchAsync(Result.success(1), async () => {
      throw new Error('boom');
    });
    expect(r.ok).toBe(false);
  });

  it('catches thrown error with static AppError', async () => {
    const r = await Result.tryCatchAsync(
      Result.success(1),
      async () => {
        throw new Error('boom');
      },
      Err.validation('Async.Bad', 'Bad async'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('Async.Bad');
  });

  it('catches thrown error with function error factory', async () => {
    const r = await Result.tryCatchAsync(
      Result.success(1),
      async () => {
        throw new Error('async boom');
      },
      (e) => Err.validation('Async.Custom', String(e)),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('Async.Custom');
  });

  it('passes through existing failure', async () => {
    const r = await Result.tryCatchAsync(Result.failure<number>(notFoundError), async (n) => n * 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('Test.NotFound');
  });
});

describe('Result.fromValue', () => {
  it('creates a success result from a value', () => {
    const r = Result.fromValue(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });
});

describe('Result.fromError', () => {
  it('creates a failure result from an error', () => {
    const r = Result.fromError(validationError);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('Test.Invalid');
  });
});

describe('Result.ensure passes through failure', () => {
  it('returns the failure without calling predicate', () => {
    const called: boolean[] = [];
    const r = Result.ensure(
      Result.failure<number>(validationError),
      () => {
        called.push(true);
        return true;
      },
      notFoundError,
    );
    expect(r.ok).toBe(false);
    expect(called).toHaveLength(0);
  });
});

describe('Result.ensureAsync passes through failure', () => {
  it('returns the failure without calling predicate', async () => {
    const called: boolean[] = [];
    const r = await Result.ensureAsync(
      Result.failure<number>(validationError),
      async () => {
        called.push(true);
        return true;
      },
      notFoundError,
    );
    expect(r.ok).toBe(false);
    expect(called).toHaveLength(0);
  });
});

describe('Result.compensateFirst with empty errors (edge)', () => {
  it('uses fallback error for empty errors array', () => {
    const fakeFailure = { ok: false as const, errors: [] as const };
    const r = Result.compensateFirst(fakeFailure, (err) => Result.success(err.code));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Result.Empty');
  });
});

describe('Result.compensateFirstAsync with empty errors (edge)', () => {
  it('uses fallback error for empty errors array', async () => {
    const fakeFailure = { ok: false as const, errors: [] as const };
    const r = await Result.compensateFirstAsync(fakeFailure, async (err) =>
      Result.success(err.code),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Result.Empty');
  });
});
