import type { AppError } from '../../src/errors/app-error.js';
import { Err } from '../../src/errors/app-error.js';
import { ErrorType } from '../../src/errors/error-type.js';
import { retryIfFailed } from '../../src/resilience/index.js';
import { Result } from '../../src/result/result.js';
import { ResultAsync } from '../../src/result/result-async.js';

type Settled<T> = { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown };

async function settle<T>(p: PromiseLike<T>): Promise<Settled<T>> {
  const settled = Promise.resolve(p).then(
    (value): Settled<T> => ({ status: 'fulfilled', value }),
    (reason: unknown): Settled<T> => ({ status: 'rejected', reason }),
  );
  await vi.runAllTimersAsync();
  return settled;
}

async function run<T>(p: PromiseLike<Result<T>>): Promise<Result<T>> {
  const outcome = await settle(p);
  if (outcome.status === 'rejected') throw new Error(`unexpected rejection: ${outcome.reason}`);
  return outcome.value;
}

const firstError = <T>(r: Result<T>): AppError | undefined => (r.ok ? undefined : r.errors[0]);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('retryIfFailed', () => {
  it('returns a ResultAsync', () => {
    expect(retryIfFailed(() => Result.ok())).toBeInstanceOf(ResultAsync);
  });

  it('returns success without retrying', async () => {
    let attempts = 0;
    const r = await run(
      retryIfFailed(() => {
        attempts++;
        return Result.success(42);
      }),
    );
    expect(r).toEqual(Result.success(42));
    expect(attempts).toBe(1);
  });

  it('retries a transient failure', async () => {
    let attempts = 0;
    const r = await run(
      retryIfFailed(
        async () => {
          attempts++;
          return attempts < 3 ? Result.failure<number>(Err.unexpected()) : Result.success(42);
        },
        { maxAttempts: 3, delay: 10 },
      ),
    );
    expect(r).toEqual(Result.success(42));
    expect(attempts).toBe(3);
  });

  it('returns the last failure when all retries failed (maxAttempts + 1 calls)', async () => {
    let attempts = 0;
    const r = await run(
      retryIfFailed(
        () => {
          attempts++;
          return Result.failure<number>(Err.unexpected());
        },
        { maxAttempts: 2, delay: 10 },
      ),
    );
    expect(r.ok).toBe(false);
    expect(attempts).toBe(3);
  });

  it.each([
    ['Unauthorized', Err.unauthorized()],
    ['Forbidden', Err.forbidden()],
    ['NotFound', Err.notFound()],
    ['Validation', Err.validation()],
  ])('does not retry %s', async (_, error) => {
    let attempts = 0;
    const r = await run(
      retryIfFailed(
        () => {
          attempts++;
          return Result.failure<number>(error);
        },
        { maxAttempts: 3, delay: 10 },
      ),
    );
    expect(firstError(r)).toBe(error);
    expect(attempts).toBe(1);
  });

  it.each([
    ['Conflict', Err.conflict()],
    ['Failure', Err.failure()],
    ['Unexpected', Err.unexpected()],
  ])('retries %s', async (_, error) => {
    let attempts = 0;
    const r = await run(
      retryIfFailed(
        () => {
          attempts++;
          return attempts < 2 ? Result.failure<number>(error) : Result.success(42);
        },
        { maxAttempts: 3, delay: 10 },
      ),
    );
    expect(r).toEqual(Result.success(42));
    expect(attempts).toBe(2);
  });

  it('retries thrown exceptions and converts the last one to Unexpected', async () => {
    let attempts = 0;
    const r = await run(
      retryIfFailed(
        (): Result<number> => {
          attempts++;
          throw new TypeError('boom');
        },
        { maxAttempts: 2, delay: 1 },
      ),
    );
    expect(firstError(r)).toMatchObject({ code: 'TypeError', type: ErrorType.Unexpected });
    expect(attempts).toBe(3);
  });

  it('uses constant backoff', async () => {
    const start = Date.now();
    const times: number[] = [];
    await run(
      retryIfFailed(
        () => {
          times.push(Date.now() - start);
          return Result.failure(Err.unexpected());
        },
        { maxAttempts: 2, delay: 10, exponentialBackoff: false },
      ),
    );
    expect(times).toEqual([0, 10, 20]);
  });

  it('uses the defaults (3 retries, 1 s exponential)', async () => {
    const start = Date.now();
    const times: number[] = [];
    await run(
      retryIfFailed(() => {
        times.push(Date.now() - start);
        return Result.failure(Err.unexpected());
      }),
    );
    expect(times).toEqual([0, 1000, 3000, 7000]);
  });

  it('retries independently when called repeatedly with the same options', async () => {
    let total = 0;
    const operation = () => {
      total++;
      return total % 2 === 1 ? Result.failure<number>(Err.unexpected()) : Result.success(total);
    };
    const first = await run(retryIfFailed(operation, { maxAttempts: 2, delay: 1 }));
    const second = await run(retryIfFailed(operation, { maxAttempts: 2, delay: 1 }));
    expect(first).toEqual(Result.success(2));
    expect(second).toEqual(Result.success(4));
  });

  it('invalid options reject the returned promise', async () => {
    const outcome = await settle(retryIfFailed(() => Result.ok(), { maxAttempts: 0 }));
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') expect(outcome.reason).toBeInstanceOf(RangeError);
  });

  it('uses an injected delay', async () => {
    const delays: number[] = [];
    await run(
      retryIfFailed(() => Result.failure(Err.unexpected()), {
        maxAttempts: 2,
        delay: 5,
        time: {
          delay: async (ms) => {
            delays.push(ms);
          },
        },
      }),
    );
    expect(delays).toEqual([5, 10]);
  });
});

describe('retryIfFailed with shouldRetry', () => {
  it('retries while the predicate returns true', async () => {
    let attempts = 0;
    const r = await run(
      retryIfFailed(
        () => {
          attempts++;
          return attempts < 3
            ? Result.failure<number>(Err.failure('Transient'))
            : Result.success(42);
        },
        { shouldRetry: (e) => e.code === 'Transient', maxAttempts: 3, delay: 1 },
      ),
    );
    expect(r).toEqual(Result.success(42));
    expect(attempts).toBe(3);
  });

  it('does not retry when the predicate returns false', async () => {
    let attempts = 0;
    const r = await run(
      retryIfFailed(
        () => {
          attempts++;
          return Result.failure<number>(Err.failure('Permanent'));
        },
        { shouldRetry: (e) => e.code === 'Transient', maxAttempts: 3, delay: 1 },
      ),
    );
    expect(firstError(r)?.code).toBe('Permanent');
    expect(attempts).toBe(1);
  });

  it('overrides the default classification', async () => {
    let attempts = 0;
    const r = await run(
      retryIfFailed(
        () => {
          attempts++;
          return Result.failure<number>(Err.notFound());
        },
        { shouldRetry: () => true, maxAttempts: 2, delay: 1 },
      ),
    );
    expect(r.ok).toBe(false);
    expect(attempts).toBe(3);
  });

  it('stops at the first error the predicate rejects', async () => {
    let attempts = 0;
    const r = await run(
      retryIfFailed(
        () => {
          attempts++;
          return Result.failure<void>(Err.failure(attempts === 1 ? 'Transient' : 'Permanent'));
        },
        { shouldRetry: (e) => e.code === 'Transient', maxAttempts: 3, delay: 1 },
      ),
    );
    expect(firstError(r)?.code).toBe('Permanent');
    expect(attempts).toBe(2);
  });

  it('passes thrown exceptions through the predicate as Unexpected errors', async () => {
    let attempts = 0;
    const seen: AppError[] = [];
    const r = await run(
      retryIfFailed(
        (): Result<number> => {
          attempts++;
          throw new TypeError('boom');
        },
        {
          shouldRetry: (e) => {
            seen.push(e);
            return false;
          },
          maxAttempts: 3,
          delay: 1,
        },
      ),
    );
    expect(attempts).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: ErrorType.Unexpected, code: 'TypeError' });
    expect(firstError(r)?.type).toBe(ErrorType.Unexpected);
  });

  it('retries exceptions accepted by the predicate', async () => {
    let attempts = 0;
    const r = await run(
      retryIfFailed(
        () => {
          attempts++;
          if (attempts < 2) throw new RangeError('slow');
          return Result.ok();
        },
        { shouldRetry: (e) => e.code === 'RangeError', maxAttempts: 3, delay: 1 },
      ),
    );
    expect(r.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it('propagates an already-aborted signal without calling the predicate', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let predicateCalled = false;
    const outcome = await settle(
      retryIfFailed(
        (signal) => {
          signal.throwIfAborted();
          return Result.success(42);
        },
        {
          shouldRetry: () => {
            predicateCalled = true;
            return true;
          },
          maxAttempts: 3,
          delay: 1,
          signal: ctrl.signal,
        },
      ),
    );
    expect(outcome).toEqual({ status: 'rejected', reason: ctrl.signal.reason });
    expect(predicateCalled).toBe(false);
  });

  it('rejects when the caller aborts after a failure the predicate accepts', async () => {
    const ctrl = new AbortController();
    let attempts = 0;
    const outcome = await settle(
      retryIfFailed(
        async () => {
          attempts++;
          ctrl.abort();
          return Result.failure<void>(Err.failure('Transient'));
        },
        {
          shouldRetry: (e) => e.code === 'Transient',
          maxAttempts: 3,
          delay: 1,
          signal: ctrl.signal,
        },
      ),
    );
    expect(outcome.status).toBe('rejected');
    expect(attempts).toBe(1);
  });

  it('returns a failure the predicate rejects even when the caller aborts', async () => {
    const ctrl = new AbortController();
    const outcome = await settle(
      retryIfFailed(
        async () => {
          ctrl.abort();
          return Result.failure<number>(Err.failure('Permanent'));
        },
        {
          shouldRetry: (e) => e.code === 'Transient',
          maxAttempts: 3,
          delay: 1,
          signal: ctrl.signal,
        },
      ),
    );
    expect(outcome.status).toBe('fulfilled');
    if (outcome.status === 'fulfilled') expect(firstError(outcome.value)?.code).toBe('Permanent');
  });

  it('returns an Unexpected error when the predicate throws', async () => {
    let attempts = 0;
    const r = await run(
      retryIfFailed(
        () => {
          attempts++;
          return Result.failure<number>(Err.failure('Transient'));
        },
        {
          shouldRetry: () => {
            throw new TypeError('predicate failed');
          },
          maxAttempts: 3,
          delay: 1,
        },
      ),
    );
    expect(firstError(r)).toMatchObject({ type: ErrorType.Unexpected, code: 'TypeError' });
    expect(attempts).toBe(1);
  });
});

describe('retryIfFailed: throwing shouldRetry after a caller abort', () => {
  it('rejects with the abort reason when the predicate throws after the caller aborted', async () => {
    const ctrl = new AbortController();
    const outcome = await settle(
      retryIfFailed(
        async () => {
          ctrl.abort();
          return Result.failure<number>(Err.failure('Transient'));
        },
        {
          shouldRetry: () => {
            throw new TypeError('predicate failed');
          },
          maxAttempts: 3,
          delay: 1,
          signal: ctrl.signal,
        },
      ),
    );
    expect(outcome).toEqual({ status: 'rejected', reason: ctrl.signal.reason });
  });

  it('rejects with the abort reason when only the boundary re-check throws', async () => {
    const ctrl = new AbortController();
    let calls = 0;
    const outcome = await settle(
      retryIfFailed(
        async () => {
          ctrl.abort();
          return Result.failure<number>(Err.failure('Transient'));
        },
        {
          shouldRetry: () => {
            calls++;
            if (calls > 1) throw new TypeError('predicate failed on re-check');
            return true;
          },
          maxAttempts: 3,
          delay: 1,
          signal: ctrl.signal,
        },
      ),
    );
    expect(outcome).toEqual({ status: 'rejected', reason: ctrl.signal.reason });
    expect(calls).toBe(2);
  });
});

describe('retryIfFailed with shouldRetry: success after a caller abort', () => {
  it('returns the success instead of rejecting', async () => {
    const ctrl = new AbortController();
    const shouldRetry = vi.fn(() => true);
    const r = await run(
      retryIfFailed(
        () => {
          ctrl.abort(new Error('late abort'));
          return Result.success(7);
        },
        { shouldRetry, signal: ctrl.signal, delay: 1 },
      ),
    );
    expect(r).toEqual(Result.success(7));
    expect(shouldRetry).not.toHaveBeenCalled();
  });
});

describe('retryIfFailed with values String() rejects', () => {
  it('a thrown prototype-less object becomes a failure, never a rejection', async () => {
    let attempts = 0;
    const r = await run(
      retryIfFailed(
        () => {
          attempts++;
          throw Object.create(null);
        },
        { maxAttempts: 1, delay: 0 },
      ),
    );
    expect(attempts).toBe(2);
    expect(firstError(r)).toMatchObject({
      type: ErrorType.Unexpected,
      description: '[object Object]',
    });
  });
});
