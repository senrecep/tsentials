import type { AppError } from '../../src/errors/app-error.js';
import { Err } from '../../src/errors/app-error.js';
import { ErrorType } from '../../src/errors/error-type.js';
import { isRetryable, ResilienceErrorCode, ResiliencePolicy } from '../../src/resilience/index.js';
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

/** Drains timers and returns the Result (fails the test if the promise rejected). */
async function run<T>(p: PromiseLike<Result<T>>): Promise<Result<T>> {
  const outcome = await settle(p);
  if (outcome.status === 'rejected') throw new Error(`unexpected rejection: ${outcome.reason}`);
  return outcome.value;
}

const firstError = <T>(r: Result<T>): AppError | undefined => (r.ok ? undefined : r.errors[0]);

const NON_RETRYABLE: Array<[string, AppError]> = [
  ['Unauthorized', Err.unauthorized()],
  ['Forbidden', Err.forbidden()],
  ['NotFound', Err.notFound()],
  ['Validation', Err.validation()],
];

/** Abortable sleep the action can use (rejects with the signal's reason). */
const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isRetryable', () => {
  it.each(NON_RETRYABLE)('%s is not retryable', (_, error) => {
    expect(isRetryable(Result.failure(error))).toBe(false);
  });

  it.each([
    ['Failure', Err.failure()],
    ['Unexpected', Err.unexpected()],
    ['Conflict', Err.conflict()],
    ['Unknown', Err.unknown()],
  ])('%s is retryable', (_, error) => {
    expect(isRetryable(Result.failure(error))).toBe(true);
  });

  it('a success is never retryable', () => {
    expect(isRetryable(Result.success(1))).toBe(false);
  });

  it('only the FIRST error decides', () => {
    expect(isRetryable(Result.failure(Err.validation(), Err.unexpected()))).toBe(false);
    expect(isRetryable(Result.failure(Err.unexpected(), Err.validation()))).toBe(true);
  });

  it('exposes the error codes', () => {
    expect(ResilienceErrorCode).toEqual({
      Timeout: 'Resilience.Timeout',
      CircuitBroken: 'Resilience.CircuitBroken',
    });
  });
});

describe('ResiliencePolicy basics', () => {
  it('create() returns success when nothing fails', async () => {
    const r = await run(ResiliencePolicy.create().execute(() => Result.ok()));
    expect(r.ok).toBe(true);
  });

  it('executeValue wraps the value', async () => {
    const r = await run(ResiliencePolicy.create().executeValue(async () => 42));
    expect(r).toEqual(Result.success(42));
  });

  it('execute returns a ResultAsync', () => {
    expect(ResiliencePolicy.create().execute(() => Result.ok())).toBeInstanceOf(ResultAsync);
  });

  it('withRetry retries a thrown exception', async () => {
    let attempts = 0;
    const policy = ResiliencePolicy.create().withRetry({ maxAttempts: 2, delay: 10 });

    const r = await run(
      policy.execute(() => {
        attempts++;
        if (attempts < 2) throw new TypeError('Transient failure');
        return Result.ok();
      }),
    );

    expect(r.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it('a persistent exception becomes an Unexpected failure named after the error class', async () => {
    const policy = ResiliencePolicy.create().withRetry({ maxAttempts: 1, delay: 10 });

    const r = await run(
      policy.execute((): Result<void> => {
        throw new TypeError('Persistent failure');
      }),
    );

    expect(firstError(r)?.type).toBe(ErrorType.Unexpected);
    expect(firstError(r)?.code).toBe('TypeError');
    expect(firstError(r)?.description).toBe('Persistent failure');
  });

  it('a thrown exception without any strategy becomes an Unexpected failure', async () => {
    const r = await run(
      ResiliencePolicy.create().executeValue((): number => {
        throw new RangeError('boom');
      }),
    );
    expect(firstError(r)?.type).toBe(ErrorType.Unexpected);
  });

  it('withRetry retries a transient failed Result and returns the success', async () => {
    let attempts = 0;
    const policy = ResiliencePolicy.create().withRetry({ maxAttempts: 2, delay: 1 });

    const r = await run(
      policy.execute(() => {
        attempts++;
        return attempts < 3 ? Result.failure<number>(Err.conflict()) : Result.success(42);
      }),
    );

    expect(r).toEqual(Result.success(42));
    expect(attempts).toBe(3);
  });

  it('returns the last failure when retries are exhausted', async () => {
    let attempts = 0;
    const policy = ResiliencePolicy.create().withRetry({ maxAttempts: 2, delay: 1 });

    const r = await run(
      policy.execute(() => {
        attempts++;
        return Result.failure<number>(Err.failure('Transient.Failure', `transient ${attempts}`));
      }),
    );

    expect(firstError(r)?.code).toBe('Transient.Failure');
    expect(firstError(r)?.description).toBe('transient 3');
    expect(attempts).toBe(3);
  });

  it.each(NON_RETRYABLE)('does not retry %s failures', async (_, error) => {
    let attempts = 0;
    const policy = ResiliencePolicy.create<number>().withRetry({ maxAttempts: 2, delay: 10 });

    const r = await run(
      policy.execute(() => {
        attempts++;
        return Result.failure<number>(error);
      }),
    );

    expect(r.ok).toBe(false);
    expect(attempts).toBe(1);
  });

  it('does not retry a success', async () => {
    let attempts = 0;
    const policy = ResiliencePolicy.create().withRetry({ maxAttempts: 2, delay: 1 });

    await run(
      policy.execute(() => {
        attempts++;
        return Result.ok();
      }),
    );

    expect(attempts).toBe(1);
  });

  it('withTimeout returns Resilience.Timeout when the action honours its signal', async () => {
    const policy = ResiliencePolicy.create().withTimeout(1000);

    const r = await run(
      policy.execute(async (signal) => {
        await sleep(10_000, signal);
        return Result.ok();
      }),
    );

    expect(firstError(r)).toMatchObject({
      code: 'Resilience.Timeout',
      description: 'Operation timed out.',
      type: ErrorType.Failure,
    });
  });

  it('retry + timeout succeeds when nothing fails', async () => {
    const policy = ResiliencePolicy.create()
      .withRetry({ maxAttempts: 1, delay: 10 })
      .withTimeout(1000);

    const r = await run(policy.execute(() => Result.ok()));
    expect(r.ok).toBe(true);
  });

  it('fallback returns the fallback value after retries are exhausted', async () => {
    let attempts = 0;
    const policy = ResiliencePolicy.create<number>()
      .withRetry({ maxAttempts: 2, delay: 10 })
      .withFallback(async () => 99);

    const r = await run(
      policy.execute(() => {
        attempts++;
        return Result.failure<number>(Err.unexpected());
      }),
    );

    expect(r).toEqual(Result.success(99));
    expect(attempts).toBe(3);
  });

  it('withFallbackResult returns the fallback Result as is', async () => {
    const policy = ResiliencePolicy.create<number>().withFallbackResult(() =>
      Result.failure<number>(Err.conflict('Fallback.Failed')),
    );

    const r = await run(policy.execute(() => Result.failure<number>(Err.unexpected())));
    expect(firstError(r)?.code).toBe('Fallback.Failed');
  });

  it('fallback replaces non-retryable failures too (any failure)', async () => {
    const policy = ResiliencePolicy.create<number>().withFallback(() => 7);
    const r = await run(policy.execute(() => Result.failure<number>(Err.validation())));
    expect(r).toEqual(Result.success(7));
  });

  it('fallback does not run on success', async () => {
    const fallback = vi.fn(() => 7);
    const policy = ResiliencePolicy.create<number>().withFallback(fallback);
    const r = await run(policy.execute(() => Result.success(1)));
    expect(r).toEqual(Result.success(1));
    expect(fallback).not.toHaveBeenCalled();
  });

  it('a throwing fallback becomes Err.fromException (type Failure)', async () => {
    const policy = ResiliencePolicy.create<number>().withFallback((): number => {
      throw new TypeError('fallback broke');
    });
    const r = await run(policy.execute(() => Result.failure<number>(Err.unexpected())));
    expect(firstError(r)).toMatchObject({ code: 'TypeError', type: ErrorType.Failure });
  });

  it('a fallback that aborts the caller rejects with the abort reason', async () => {
    const ctrl = new AbortController();
    const reason = new Error('caller gave up');
    const policy = ResiliencePolicy.create<number>().withFallbackResult((signal) => {
      ctrl.abort(reason);
      throw signal.reason;
    });
    const outcome = await settle(
      policy.execute(() => Result.failure<number>(Err.unexpected()), { signal: ctrl.signal }),
    );
    expect(outcome).toEqual({ status: 'rejected', reason });
  });

  it('fallback replaces a thrown exception', async () => {
    const policy = ResiliencePolicy.create<number>().withFallback(() => 5);
    const r = await run(
      policy.execute((): Result<number> => {
        throw new Error('boom');
      }),
    );
    expect(r).toEqual(Result.success(5));
  });
});

describe('ResiliencePolicy.create(options)', () => {
  it('applies retry', async () => {
    let attempts = 0;
    const policy = ResiliencePolicy.create({
      retry: { maxAttempts: 2, delay: 10, exponentialBackoff: false },
    });
    await run(
      policy.execute(() => {
        attempts++;
        return Result.failure(Err.unexpected());
      }),
    );
    expect(attempts).toBe(3);
  });

  it('applies the circuit breaker', async () => {
    const policy = ResiliencePolicy.create({
      circuitBreaker: { minimumThroughput: 5, samplingDuration: 1000, breakDuration: 1000 },
    });
    for (let i = 0; i < 5; i++) await run(policy.execute(() => Result.failure(Err.unexpected())));
    const r = await run(policy.execute(() => Result.ok()));
    expect(firstError(r)?.code).toBe('Resilience.CircuitBroken');
  });

  it('applies the timeout', async () => {
    const policy = ResiliencePolicy.create({ timeout: { timeout: 5000 } });
    const r = await run(
      policy.execute(async (signal) => {
        await sleep(6000, signal);
        return Result.ok();
      }),
    );
    expect(firstError(r)?.code).toBe('Resilience.Timeout');
  });

  it('applies all three in order retry → circuit breaker → timeout (timeout per attempt)', async () => {
    let attempts = 0;
    const policy = ResiliencePolicy.create({
      retry: { maxAttempts: 2, delay: 10, exponentialBackoff: false },
      circuitBreaker: { minimumThroughput: 10 },
      timeout: { timeout: 100 },
    });

    const r = await run(
      policy.execute(async (signal) => {
        attempts++;
        if (attempts < 3) await sleep(1000, signal);
        return Result.success(attempts);
      }),
    );

    expect(r).toEqual(Result.success(3));
    expect(attempts).toBe(3);
  });

  it('a TimeoutOptions object without timeout uses the 30 s default', async () => {
    const policy = ResiliencePolicy.create().withTimeout({});
    let elapsed = -1;
    const start = Date.now();
    const r = await run(
      policy.execute(async (signal) => {
        await sleep(60_000, signal).catch((e: unknown) => {
          elapsed = Date.now() - start;
          throw e;
        });
        return Result.ok();
      }),
    );
    expect(firstError(r)?.code).toBe('Resilience.Timeout');
    expect(elapsed).toBe(30_000);
  });
});

describe('retry backoff timing', () => {
  async function attemptTimes(policy: ResiliencePolicy, calls: number): Promise<number[]> {
    const start = Date.now();
    const times: number[] = [];
    await run(
      policy.execute(() => {
        times.push(Date.now() - start);
        return Result.failure(Err.unexpected());
      }),
    );
    expect(times).toHaveLength(calls);
    return times;
  }

  it('defaults: 3 retries, 1 s base, exponential (0, 1 s, 3 s, 7 s)', async () => {
    expect(await attemptTimes(ResiliencePolicy.create().withRetry(), 4)).toEqual([
      0, 1000, 3000, 7000,
    ]);
  });

  it('exponential: delay · 2^attempt', async () => {
    const policy = ResiliencePolicy.create().withRetry({ maxAttempts: 3, delay: 100 });
    expect(await attemptTimes(policy, 4)).toEqual([0, 100, 300, 700]);
  });

  it('constant (exponentialBackoff: false)', async () => {
    const policy = ResiliencePolicy.create().withRetry({
      maxAttempts: 3,
      delay: 100,
      exponentialBackoff: false,
    });
    expect(await attemptTimes(policy, 4)).toEqual([0, 100, 200, 300]);
  });

  it("linear: (attempt + 1) · delay (backoff: 'linear')", async () => {
    const policy = ResiliencePolicy.create().withRetry({
      maxAttempts: 3,
      delay: 100,
      backoff: 'linear',
    });
    expect(await attemptTimes(policy, 4)).toEqual([0, 100, 300, 600]);
  });

  it('backoff overrides exponentialBackoff', async () => {
    const policy = ResiliencePolicy.create().withRetry({
      maxAttempts: 2,
      delay: 100,
      exponentialBackoff: true,
      backoff: 'constant',
    });
    expect(await attemptTimes(policy, 3)).toEqual([0, 100, 200]);
  });

  it('delay 0 retries immediately', async () => {
    const policy = ResiliencePolicy.create().withRetry({ maxAttempts: 2, delay: 0 });
    expect(await attemptTimes(policy, 3)).toEqual([0, 0, 0]);
  });

  it('uses an injected delay function', async () => {
    const delays: number[] = [];
    const policy = ResiliencePolicy.create({
      time: {
        delay: async (ms) => {
          delays.push(ms);
        },
      },
    }).withRetry({ maxAttempts: 3, delay: 50 });

    await run(policy.execute(() => Result.failure(Err.unexpected())));
    expect(delays).toEqual([50, 100, 200]);
  });
});

describe('cooperative timeout', () => {
  it('an action that ignores its signal is not abandoned; its own result is returned', async () => {
    const policy = ResiliencePolicy.create().withTimeout(100);
    const r = await run(
      policy.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return Result.success('late');
      }),
    );
    expect(r).toEqual(Result.success('late'));
  });

  it('a non-abort error thrown after the deadline passes through as Unexpected', async () => {
    const policy = ResiliencePolicy.create().withTimeout(100);
    const r = await run(
      policy.execute(async (): Promise<Result<void>> => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        throw new TypeError('late failure');
      }),
    );
    expect(firstError(r)).toMatchObject({ code: 'TypeError', type: ErrorType.Unexpected });
  });

  it('the action signal carries a TimeoutError reason', async () => {
    let reason: unknown;
    const policy = ResiliencePolicy.create().withTimeout(100);
    await run(
      policy.execute(async (signal) => {
        await sleep(1000, signal).catch((e: unknown) => {
          reason = e;
          throw e;
        });
        return Result.ok();
      }),
    );
    expect((reason as Error).name).toBe('TimeoutError');
  });

  it('a timeout inside retry is retried (retry outside timeout)', async () => {
    let attempts = 0;
    const policy = ResiliencePolicy.create()
      .withRetry({ maxAttempts: 2, delay: 10 })
      .withTimeout(100);

    const r = await run(
      policy.execute(async (signal) => {
        attempts++;
        await sleep(1000, signal);
        return Result.ok();
      }),
    );

    expect(firstError(r)?.code).toBe('Resilience.Timeout');
    expect(attempts).toBe(3);
  });

  it('a timeout outside retry caps the whole execution', async () => {
    let attempts = 0;
    const policy = ResiliencePolicy.create()
      .withTimeout(250)
      .withRetry({ maxAttempts: 10, delay: 100, exponentialBackoff: false });

    const r = await run(
      policy.execute(() => {
        attempts++;
        return Result.failure(Err.unexpected());
      }),
    );

    expect(firstError(r)?.code).toBe('Resilience.Timeout');
    expect(attempts).toBe(3);
  });

  it('a caller abort during a timed attempt rejects with the caller reason, not Timeout', async () => {
    const ctrl = new AbortController();
    const policy = ResiliencePolicy.create().withTimeout(1000);
    setTimeout(() => ctrl.abort(new Error('caller stop')), 10);

    const outcome = await settle(
      policy.execute(
        async (signal) => {
          await sleep(5000, signal);
          return Result.ok();
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome).toEqual({ status: 'rejected', reason: ctrl.signal.reason });
  });
});

describe('strategy ordering', () => {
  it('the first strategy added is the outermost', async () => {
    const policy = ResiliencePolicy.create()
      .withCircuitBreaker({ minimumThroughput: 2 })
      .withRetry({ maxAttempts: 4, delay: 1 });

    // Circuit breaker outside retry: one execute (5 attempts) is ONE failure for the breaker.
    let attempts = 0;
    const action = () => {
      attempts++;
      return Result.failure(Err.unexpected());
    };
    await run(policy.execute(action));
    expect(attempts).toBe(5);

    await run(policy.execute(action));
    const r = await run(policy.execute(() => Result.ok()));
    expect(firstError(r)?.code).toBe('Resilience.CircuitBroken');
  });

  it('retry outside circuit breaker sees CircuitBroken as a retryable throw', async () => {
    let attempts = 0;
    const policy = ResiliencePolicy.create()
      .withRetry({ maxAttempts: 4, delay: 1 })
      .withCircuitBreaker({ minimumThroughput: 2 });

    const r = await run(
      policy.execute(() => {
        attempts++;
        return Result.failure(Err.unexpected());
      }),
    );

    expect(attempts).toBe(2);
    expect(firstError(r)?.code).toBe('Resilience.CircuitBroken');
  });

  it('withFallback is outermost even when added before other strategies', async () => {
    let attempts = 0;
    const policy = ResiliencePolicy.create<number>()
      .withFallback(() => -1)
      .withRetry({ maxAttempts: 2, delay: 1 });

    const r = await run(
      policy.execute(() => {
        attempts++;
        return Result.failure<number>(Err.unexpected());
      }),
    );

    expect(r).toEqual(Result.success(-1));
    expect(attempts).toBe(3);
  });

  it('policies are immutable: with… returns a new policy', async () => {
    let attempts = 0;
    const base = ResiliencePolicy.create();
    base.withRetry({ maxAttempts: 3, delay: 1 });

    await run(
      base.execute(() => {
        attempts++;
        return Result.failure(Err.unexpected());
      }),
    );
    expect(attempts).toBe(1);
  });
});

describe('option validation ranges', () => {
  const policy = ResiliencePolicy.create();

  it.each([0, -1, 1.5, Number.NaN])('rejects maxAttempts %s', (maxAttempts) => {
    expect(() => policy.withRetry({ maxAttempts })).toThrow(RangeError);
  });

  it.each([-1, 86_400_001, Number.POSITIVE_INFINITY])('rejects retry delay %s', (delay) => {
    expect(() => policy.withRetry({ delay })).toThrow(RangeError);
  });

  it('rejects an unknown backoff type', () => {
    expect(() => policy.withRetry({ backoff: 'random' as unknown as 'constant' })).toThrow(
      "backoff must be 'constant', 'linear' or 'exponential' (got random).",
    );
  });

  it('accepts retry delay bounds 0 and 1 day', () => {
    expect(() => policy.withRetry({ delay: 0 })).not.toThrow();
    expect(() => policy.withRetry({ delay: 86_400_000 })).not.toThrow();
  });

  it.each([9, 86_400_001, Number.NaN])('rejects timeout %s', (timeout) => {
    expect(() => policy.withTimeout(timeout)).toThrow(RangeError);
    expect(() => policy.withTimeout({ timeout })).toThrow(RangeError);
  });

  it('accepts timeout bounds 10 ms and 1 day', () => {
    expect(() => policy.withTimeout(10)).not.toThrow();
    expect(() => policy.withTimeout(86_400_000)).not.toThrow();
  });

  it.each([1, 0, 2.5])('rejects minimumThroughput %s', (minimumThroughput) => {
    expect(() => policy.withCircuitBreaker({ minimumThroughput })).toThrow(RangeError);
  });

  it.each([-0.1, 1.1, Number.NaN])('rejects failureRatio %s', (failureRatio) => {
    expect(() => policy.withCircuitBreaker({ failureRatio })).toThrow(RangeError);
  });

  it.each([499, 86_400_001])('rejects samplingDuration / breakDuration %s', (ms) => {
    expect(() => policy.withCircuitBreaker({ samplingDuration: ms })).toThrow(RangeError);
    expect(() => policy.withCircuitBreaker({ breakDuration: ms })).toThrow(RangeError);
  });

  it('accepts circuit breaker bounds', () => {
    expect(() =>
      policy.withCircuitBreaker({
        minimumThroughput: 2,
        failureRatio: 0,
        samplingDuration: 500,
        breakDuration: 86_400_000,
      }),
    ).not.toThrow();
    expect(() => policy.withCircuitBreaker({ failureRatio: 1 })).not.toThrow();
  });

  it('create(options) validates eagerly', () => {
    expect(() => ResiliencePolicy.create({ retry: { maxAttempts: 0 } })).toThrow(RangeError);
  });
});

describe('ResiliencePolicy.execute with values String() rejects', () => {
  it('a thrown prototype-less object becomes a failure without strategies', async () => {
    const r = await run(
      ResiliencePolicy.create().execute(() => {
        throw Object.create(null);
      }),
    );
    expect(r.ok || r.errors[0]).toMatchObject({
      type: ErrorType.Unexpected,
      description: '[object Object]',
    });
  });

  it('a thrown prototype-less object becomes a failure after retries', async () => {
    let attempts = 0;
    const r = await run(
      ResiliencePolicy.create()
        .withRetry({ maxAttempts: 2, delay: 0 })
        .execute(() => {
          attempts++;
          throw Object.create(null);
        }),
    );
    expect(attempts).toBe(3);
    expect(r.ok || r.errors[0]?.description).toBe('[object Object]');
  });
});

describe('retry with delay 0 yields between attempts', () => {
  it('an outer timeout interrupts a synchronously failing action', async () => {
    let attempts = 0;
    const pending = ResiliencePolicy.create()
      .withTimeout(10)
      .withRetry({ maxAttempts: 3000, delay: 0 })
      .execute(() => {
        attempts++;
        return Result.failure<number>(Err.unexpected('X', 'down'));
      });
    await vi.advanceTimersByTimeAsync(50);
    const r = await pending;
    expect(r.ok || r.errors[0]?.code).toBe(ResilienceErrorCode.Timeout);
    expect(attempts).toBeLessThan(100);
  });

  it('a caller abort between zero-delay attempts rejects with the reason', async () => {
    const controller = new AbortController();
    const reason = new Error('stop');
    let attempts = 0;
    const pending = ResiliencePolicy.create()
      .withRetry({ maxAttempts: 3000, delay: 0 })
      .execute(
        () => {
          attempts++;
          return Result.failure<number>(Err.unexpected('X', 'down'));
        },
        { signal: controller.signal },
      );
    const settled = pending.then(
      () => 'resolved',
      (e: unknown) => e,
    );
    setTimeout(() => controller.abort(reason), 5);
    await vi.advanceTimersByTimeAsync(50);
    expect(await settled).toBe(reason);
    expect(attempts).toBeLessThan(100);
  });
});
