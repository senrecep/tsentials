import type { AppError } from '../../src/errors/app-error.js';
import { Err } from '../../src/errors/app-error.js';
import { ErrorType } from '../../src/errors/error-type.js';
import { ResiliencePolicy } from '../../src/resilience/index.js';
import { Result } from '../../src/result/result.js';
import { createFakeDateTimeProvider } from '../../src/time/date-time-provider.js';

const firstError = <T>(r: Result<T>): AppError | undefined => (r.ok ? undefined : r.errors[0]);
const fail = () => Result.failure(Err.unexpected());
const ok = () => Result.ok();
const isBroken = <T>(r: Result<T>): boolean => firstError(r)?.code === 'Resilience.CircuitBroken';

function setup(options: Parameters<ResiliencePolicy['withCircuitBreaker']>[0]) {
  const clock = createFakeDateTimeProvider(new Date('2026-01-01T00:00:00Z'));
  const policy = ResiliencePolicy.create({ time: { clock } }).withCircuitBreaker(options);
  return { clock, policy };
}

describe('circuit breaker', () => {
  it('opens after thrown failures', async () => {
    const policy = ResiliencePolicy.create().withCircuitBreaker({
      minimumThroughput: 3,
      samplingDuration: 1000,
      breakDuration: 1000,
    });

    for (let i = 0; i < 3; i++) {
      const r = await policy.execute((): Result<void> => {
        throw new Error('failure');
      });
      expect(firstError(r)?.type).toBe(ErrorType.Unexpected);
    }

    const after = await policy.execute(ok);
    expect(firstError(after)).toMatchObject({
      code: 'Resilience.CircuitBroken',
      description: 'Circuit breaker is open.',
      type: ErrorType.Failure,
    });
  });

  it('opens on transient failed Results', async () => {
    const policy = ResiliencePolicy.create().withCircuitBreaker({
      minimumThroughput: 3,
      samplingDuration: 1000,
      breakDuration: 1000,
    });
    for (let i = 0; i < 3; i++) await policy.execute(fail);
    expect(isBroken(await policy.execute(ok))).toBe(true);
  });

  it.each([
    ['Validation', Err.validation()],
    ['NotFound', Err.notFound()],
    ['Unauthorized', Err.unauthorized()],
    ['Forbidden', Err.forbidden()],
  ])('does not open on %s failures (counted as successes)', async (_, error) => {
    const policy = ResiliencePolicy.create().withCircuitBreaker({
      minimumThroughput: 3,
      samplingDuration: 1000,
      breakDuration: 1000,
    });
    for (let i = 0; i < 3; i++) await policy.execute(() => Result.failure(error));
    expect((await policy.execute(ok)).ok).toBe(true);
  });
});

describe('circuit breaker state machine', () => {
  it('does not break before minimumThroughput (default 10)', async () => {
    const { policy } = setup(undefined);
    for (let i = 0; i < 9; i++) await policy.execute(fail);
    expect((await policy.execute(ok)).ok).toBe(true);
  });

  it('breaks at the 10th failure with the defaults', async () => {
    const { policy } = setup(undefined);
    for (let i = 0; i < 10; i++) await policy.execute(fail);
    expect(isBroken(await policy.execute(ok))).toBe(true);
  });

  it('breaks only once failureRate >= failureRatio (5 of 10 with ratio 0.5)', async () => {
    const { policy } = setup({ minimumThroughput: 2 });
    for (let i = 0; i < 3; i++) await policy.execute(ok);
    await policy.execute(fail); // 1/4
    await policy.execute(fail); // 2/5
    expect((await policy.execute(ok)).ok).toBe(true); // 2/6 — still closed
    await policy.execute(fail); // 3/7 < 0.5
    expect((await policy.execute(ok)).ok).toBe(true); // 3/8
    await policy.execute(fail); // 4/9
    await policy.execute(fail); // 5/10 >= 0.5 → open
    expect(isBroken(await policy.execute(ok))).toBe(true);
  });

  it('a rejected call does not run the action', async () => {
    const { policy } = setup({ minimumThroughput: 2 });
    await policy.execute(fail);
    await policy.execute(fail);
    const action = vi.fn(ok);
    await policy.execute(action);
    expect(action).not.toHaveBeenCalled();
  });

  it('stays open for breakDuration, then lets one trial call through; success closes', async () => {
    const { clock, policy } = setup({ minimumThroughput: 2, breakDuration: 1000 });
    await policy.execute(fail);
    await policy.execute(fail);

    clock.advance(999);
    expect(isBroken(await policy.execute(ok))).toBe(true);

    clock.advance(1);
    const trial = vi.fn(ok);
    expect((await policy.execute(trial)).ok).toBe(true);
    expect(trial).toHaveBeenCalledTimes(1);

    // Closed again with fresh metrics: one failure does not re-open it.
    await policy.execute(fail);
    expect((await policy.execute(ok)).ok).toBe(true);
  });

  it('a failed trial re-opens the circuit for another breakDuration', async () => {
    const { clock, policy } = setup({ minimumThroughput: 2, breakDuration: 1000 });
    await policy.execute(fail);
    await policy.execute(fail);

    clock.advance(1000);
    await policy.execute(fail); // trial fails
    expect(isBroken(await policy.execute(ok))).toBe(true);

    clock.advance(999);
    expect(isBroken(await policy.execute(ok))).toBe(true);
    clock.advance(1);
    expect((await policy.execute(ok)).ok).toBe(true);
  });

  it('a non-retryable failure in the trial closes the circuit (counted as success)', async () => {
    const { clock, policy } = setup({ minimumThroughput: 2, breakDuration: 1000 });
    await policy.execute(fail);
    await policy.execute(fail);
    clock.advance(1000);
    await policy.execute(() => Result.failure(Err.validation()));
    expect((await policy.execute(ok)).ok).toBe(true);
  });

  it('rejects every other call while the trial is in flight, even after breakDuration passes again', async () => {
    const { clock, policy } = setup({ minimumThroughput: 2, breakDuration: 1000 });
    await policy.execute(fail);
    await policy.execute(fail);
    clock.advance(1000);

    let release: () => void = () => undefined;
    const trial = policy.execute(
      () =>
        new Promise<Result<void>>((resolve) => {
          release = () => resolve(Result.ok());
        }),
    );

    expect(isBroken(await policy.execute(ok))).toBe(true);
    clock.advance(5000);
    expect(isBroken(await policy.execute(ok))).toBe(true);

    release();
    expect((await trial).ok).toBe(true);
    expect((await policy.execute(ok)).ok).toBe(true);
  });

  it('failures older than samplingDuration expire (rolling window)', async () => {
    const { clock, policy } = setup({ minimumThroughput: 3, samplingDuration: 1000 });
    await policy.execute(fail);
    await policy.execute(fail);
    clock.advance(1000);
    await policy.execute(fail); // the two old failures dropped → throughput 1
    expect((await policy.execute(ok)).ok).toBe(true);
  });

  it('failures inside samplingDuration across buckets still count', async () => {
    const { clock, policy } = setup({ minimumThroughput: 3, samplingDuration: 1000 });
    await policy.execute(fail);
    clock.advance(400);
    await policy.execute(fail);
    clock.advance(500);
    await policy.execute(fail); // all within 900 ms → 3/3
    expect(isBroken(await policy.execute(ok))).toBe(true);
  });

  it('a caller abort during the call counts as a failure', async () => {
    const { policy } = setup({ minimumThroughput: 2 });
    for (let i = 0; i < 2; i++) {
      const ctrl = new AbortController();
      await expect(
        Promise.resolve(
          policy.execute(
            (signal) => {
              ctrl.abort();
              signal.throwIfAborted();
              return Result.ok();
            },
            { signal: ctrl.signal },
          ),
        ),
      ).rejects.toBe(ctrl.signal.reason);
    }
    expect(isBroken(await policy.execute(ok))).toBe(true);
  });

  it('state is shared by policies derived from the one that added the breaker', async () => {
    const { policy } = setup({ minimumThroughput: 2 });
    const derived = policy.withTimeout(1000);
    await policy.execute(fail);
    await policy.execute(fail);
    expect(isBroken(await derived.execute(ok))).toBe(true);
  });

  it('separate withCircuitBreaker calls have separate state', async () => {
    const base = ResiliencePolicy.create();
    const a = base.withCircuitBreaker({ minimumThroughput: 2 });
    const b = base.withCircuitBreaker({ minimumThroughput: 2 });
    await a.execute(fail);
    await a.execute(fail);
    expect(isBroken(await a.execute(ok))).toBe(true);
    expect((await b.execute(ok)).ok).toBe(true);
  });

  it('uses fake timers through the default clock', async () => {
    vi.useFakeTimers();
    try {
      const policy = ResiliencePolicy.create().withCircuitBreaker({
        minimumThroughput: 2,
        breakDuration: 500,
      });
      await policy.execute(fail);
      await policy.execute(fail);
      expect(isBroken(await policy.execute(ok))).toBe(true);
      vi.advanceTimersByTime(500);
      expect((await policy.execute(ok)).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('circuit breaker edge cases', () => {
  it('a failure that completes after another call opened the circuit leaves it open', async () => {
    const { policy } = setup({ minimumThroughput: 2, samplingDuration: 1000, breakDuration: 1000 });
    const gates: Array<() => void> = [];
    const slowFail = () =>
      new Promise<Result<void>>((resolve) => {
        gates.push(() => resolve(fail()));
      });
    const calls = [policy.execute(slowFail), policy.execute(slowFail), policy.execute(slowFail)];
    await vi.waitFor(() => expect(gates).toHaveLength(3));
    for (const open of gates) open();
    const results = await Promise.all(calls);
    const code = Err.unexpected().code;
    expect(results.map((r) => firstError(r)?.code)).toEqual([code, code, code]);
    expect(isBroken(await policy.execute(ok))).toBe(true);
  });

  it('does not open when the clock leaves the sampling window before the ratio is read', async () => {
    let nowMs = Date.UTC(2026, 0, 1);
    const jumpingClock = {
      utcNow: () => new Date(nowMs),
      utcNowDate: () => new Date(nowMs),
      utcNowMs: () => {
        nowMs += 1000;
        return nowMs;
      },
    };
    const policy = ResiliencePolicy.create({ time: { clock: jumpingClock } }).withCircuitBreaker({
      minimumThroughput: 2,
      samplingDuration: 1000,
      breakDuration: 1000,
    });
    for (let i = 0; i < 5; i++) await policy.execute(fail);
    expect(isBroken(await policy.execute(ok))).toBe(false);
  });
});
