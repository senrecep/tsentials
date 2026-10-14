import { Err } from '../../src/errors/app-error.js';
import { ErrorType } from '../../src/errors/error-type.js';
import { ResiliencePolicy, retryIfFailed } from '../../src/resilience/index.js';
import { Result } from '../../src/result/result.js';

type Settled<T> = { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown };

/** Attaches handlers first (no unhandled rejection), then drains every fake timer. */
async function settle<T>(p: PromiseLike<T>): Promise<Settled<T>> {
  const settled = Promise.resolve(p).then(
    (value): Settled<T> => ({ status: 'fulfilled', value }),
    (reason: unknown): Settled<T> => ({ status: 'rejected', reason }),
  );
  await vi.runAllTimersAsync();
  return settled;
}

/** An abort raised by some other controller. */
function internalAbort(): never {
  const internal = new AbortController();
  internal.abort();
  throw internal.signal.reason;
}

const LONG_DELAY = 30_000;
const CANCEL_AFTER = 20;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Resilience cancellation', () => {
  it('withRetry rejects with the abort reason when the caller aborts during the delay', async () => {
    const ctrl = new AbortController();
    let attempts = 0;
    const policy = ResiliencePolicy.create<number>().withRetry({
      maxAttempts: 3,
      delay: LONG_DELAY,
      exponentialBackoff: false,
    });

    const outcome = await settle(
      policy.execute(
        () => {
          attempts++;
          setTimeout(() => ctrl.abort(), CANCEL_AFTER);
          return Result.failure<number>(Err.unexpected());
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome).toEqual({ status: 'rejected', reason: ctrl.signal.reason });
    expect(attempts).toBe(1);
  });

  it('withRetry rejects when the caller aborts during the attempt', async () => {
    const ctrl = new AbortController();
    let attempts = 0;
    const policy = ResiliencePolicy.create().withRetry({ maxAttempts: 3, delay: 1 });

    const outcome = await settle(
      policy.execute(
        async () => {
          attempts++;
          ctrl.abort();
          return Result.failure<number>(Err.unexpected());
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome.status).toBe('rejected');
    expect(attempts).toBe(1);
  });

  it('withRetry rejects when the caller aborts during the final attempt', async () => {
    const ctrl = new AbortController();
    let attempts = 0;
    const policy = ResiliencePolicy.create<number>().withRetry({ maxAttempts: 1, delay: 1 });

    const outcome = await settle(
      policy.execute(
        async () => {
          attempts++;
          if (attempts === 2) ctrl.abort();
          return Result.failure<number>(Err.unexpected());
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome.status).toBe('rejected');
    expect(attempts).toBe(2);
  });

  it('returns a non-retryable failure even when the caller aborts', async () => {
    const ctrl = new AbortController();
    const policy = ResiliencePolicy.create<number>().withRetry({ maxAttempts: 3, delay: 1 });

    const outcome = await settle(
      policy.execute(
        async () => {
          ctrl.abort();
          return Result.failure<number>(Err.notFound());
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome.status).toBe('fulfilled');
    if (outcome.status === 'fulfilled') {
      expect(outcome.value.ok).toBe(false);
      if (!outcome.value.ok) expect(outcome.value.errors[0]?.type).toBe(ErrorType.NotFound);
    }
  });

  it('returns a success even when the caller aborts concurrently', async () => {
    const ctrl = new AbortController();
    const policy = ResiliencePolicy.create<number>().withRetry({ maxAttempts: 3, delay: 1 });

    const outcome = await settle(
      policy.execute(
        async () => {
          ctrl.abort();
          return Result.success(42);
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome).toEqual({ status: 'fulfilled', value: Result.success(42) });
  });

  it('retryIfFailed returns a success even when the caller aborts concurrently', async () => {
    const ctrl = new AbortController();

    const outcome = await settle(
      retryIfFailed(
        async () => {
          ctrl.abort();
          return Result.success(42);
        },
        { maxAttempts: 3, delay: 1, signal: ctrl.signal },
      ),
    );

    expect(outcome).toEqual({ status: 'fulfilled', value: Result.success(42) });
  });

  it('retryIfFailed rejects when the caller aborts during the delay', async () => {
    const ctrl = new AbortController();
    let attempts = 0;

    const outcome = await settle(
      retryIfFailed(
        () => {
          attempts++;
          setTimeout(() => ctrl.abort(), CANCEL_AFTER);
          return Result.failure<number>(Err.unexpected());
        },
        { maxAttempts: 3, delay: LONG_DELAY, exponentialBackoff: false, signal: ctrl.signal },
      ),
    );

    expect(outcome).toEqual({ status: 'rejected', reason: ctrl.signal.reason });
    expect(attempts).toBe(1);
  });

  it('a circuit-breaker-only policy rejects when the caller aborts after a retryable failure', async () => {
    const ctrl = new AbortController();
    const policy = ResiliencePolicy.create<number>().withCircuitBreaker();

    const outcome = await settle(
      policy.execute(
        async () => {
          ctrl.abort();
          return Result.failure<number>(Err.unexpected());
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome.status).toBe('rejected');
  });

  it('a timeout-only policy rejects when the caller aborts after a retryable failure', async () => {
    const ctrl = new AbortController();
    const policy = ResiliencePolicy.create().withTimeout(30_000);

    const outcome = await settle(
      policy.execute(
        async () => {
          ctrl.abort();
          return Result.failure<void>(Err.unexpected());
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome.status).toBe('rejected');
  });

  it('a fallback is skipped and the call rejects when the caller aborts', async () => {
    const ctrl = new AbortController();
    let attempts = 0;
    let fallbackCalled = false;
    const policy = ResiliencePolicy.create<number>()
      .withRetry({ maxAttempts: 2, delay: 1 })
      .withFallbackResult(() => {
        fallbackCalled = true;
        return Result.success(99);
      });

    const outcome = await settle(
      policy.execute(
        async () => {
          attempts++;
          ctrl.abort();
          return Result.failure<number>(Err.unexpected());
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome.status).toBe('rejected');
    expect(attempts).toBe(1);
    expect(fallbackCalled).toBe(false);
  });
});

describe('Resilience cancellation regressions', () => {
  it('fallback propagates the caller abort thrown by the action', async () => {
    const ctrl = new AbortController();
    const policy = ResiliencePolicy.create<number>().withFallback(() => 99);

    const outcome = await settle(
      policy.executeValue(
        async (signal) => {
          ctrl.abort();
          signal.throwIfAborted();
          return 42;
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome).toEqual({ status: 'rejected', reason: ctrl.signal.reason });
  });

  it('fallback propagates the caller abort thrown by the fallback', async () => {
    const ctrl = new AbortController();
    const policy = ResiliencePolicy.create<number>().withFallbackResult((signal) => {
      signal.throwIfAborted();
      return Result.success(99);
    });

    const outcome = await settle(
      policy.execute(
        async () => {
          ctrl.abort();
          return Result.failure<number>(Err.unexpected());
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome.status).toBe('rejected');
  });

  it('retryIfFailed with an already-aborted signal rejects without running the operation', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let calls = 0;

    const outcome = await settle(
      retryIfFailed(
        (signal) => {
          calls++;
          signal.throwIfAborted();
          return Result.success(42);
        },
        { maxAttempts: 2, delay: 1, signal: ctrl.signal },
      ),
    );

    expect(outcome).toEqual({ status: 'rejected', reason: ctrl.signal.reason });
    expect(calls).toBe(0);
  });

  it('retryIfFailed rejects when the caller aborts before the retry', async () => {
    const ctrl = new AbortController();
    let attempts = 0;

    const outcome = await settle(
      retryIfFailed(
        async () => {
          attempts++;
          ctrl.abort();
          return Result.failure<number>(Err.unexpected());
        },
        { maxAttempts: 2, delay: 1, signal: ctrl.signal },
      ),
    );

    expect(outcome.status).toBe('rejected');
    expect(attempts).toBe(1);
  });

  it('retryIfFailed retries an abort that did not come from the caller', async () => {
    const ctrl = new AbortController();
    let attempts = 0;

    const outcome = await settle(
      retryIfFailed(
        () => {
          attempts++;
          if (attempts === 1) internalAbort();
          return Result.success(42);
        },
        { maxAttempts: 2, delay: 1, signal: ctrl.signal },
      ),
    );

    expect(outcome).toEqual({ status: 'fulfilled', value: Result.success(42) });
    expect(attempts).toBe(2);
  });

  it('fallback propagates the caller abort that happens before a retry', async () => {
    const ctrl = new AbortController();
    let attempts = 0;
    let fallbackCalled = false;
    const policy = ResiliencePolicy.create<number>()
      .withRetry({ maxAttempts: 2, delay: 1 })
      .withFallback(() => {
        fallbackCalled = true;
        return 99;
      });

    const outcome = await settle(
      policy.execute(
        async () => {
          attempts++;
          ctrl.abort();
          return Result.failure<number>(Err.unexpected());
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome.status).toBe('rejected');
    expect(attempts).toBe(1);
    expect(fallbackCalled).toBe(false);
  });

  it('fallback runs for an abort that did not come from the caller', async () => {
    const ctrl = new AbortController();
    const policy = ResiliencePolicy.create<number>().withFallback(() => 99);

    const outcome = await settle(policy.execute(() => internalAbort(), { signal: ctrl.signal }));

    expect(outcome).toEqual({ status: 'fulfilled', value: Result.success(99) });
  });

  it('an unrelated abort without a caller signal becomes an Unexpected failure', async () => {
    const outcome = await settle(ResiliencePolicy.create().execute(() => internalAbort()));

    expect(outcome.status).toBe('fulfilled');
    if (outcome.status === 'fulfilled' && !outcome.value.ok) {
      expect(outcome.value.errors[0]?.type).toBe(ErrorType.Unexpected);
    } else {
      expect.unreachable();
    }
  });
});

describe('signal pre-checks', () => {
  it('a strategy does not run the action when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let calls = 0;
    const policy = ResiliencePolicy.create().withTimeout(1000);

    const outcome = await settle(
      policy.execute(
        () => {
          calls++;
          return Result.success(1);
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome).toEqual({ status: 'rejected', reason: ctrl.signal.reason });
    expect(calls).toBe(0);
  });

  it('an empty policy runs the action even when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let calls = 0;

    const outcome = await settle(
      ResiliencePolicy.create().execute(
        () => {
          calls++;
          return Result.success(1);
        },
        { signal: ctrl.signal },
      ),
    );

    expect(outcome).toEqual({ status: 'fulfilled', value: Result.success(1) });
    expect(calls).toBe(1);
  });

  it('an open circuit with an aborted signal rejects with the abort, not CircuitBroken', async () => {
    const policy = ResiliencePolicy.create().withCircuitBreaker({ minimumThroughput: 2 });
    for (let i = 0; i < 2; i++) await settle(policy.execute(() => Result.failure(Err.failure())));
    const broken = await settle(policy.execute(() => Result.success(1)));
    expect(broken.status === 'fulfilled' && !broken.value.ok && broken.value.errors[0]?.code).toBe(
      'Resilience.CircuitBroken',
    );

    const ctrl = new AbortController();
    ctrl.abort();
    const outcome = await settle(policy.execute(() => Result.success(1), { signal: ctrl.signal }));

    expect(outcome).toEqual({ status: 'rejected', reason: ctrl.signal.reason });
  });
});
