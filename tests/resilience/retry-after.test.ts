import type { AppError } from '../../src/errors/app-error.js';
import { Err } from '../../src/errors/app-error.js';
import { ErrorMetadata } from '../../src/errors/error-metadata.js';
import { ResiliencePolicy, retryIfFailed } from '../../src/resilience/index.js';
import { Result } from '../../src/result/result.js';

function recordingTime() {
  const delays: number[] = [];
  return {
    delays,
    time: {
      delay: async (ms: number) => {
        delays.push(ms);
      },
    },
  };
}

const withRetryAfter = (ms: unknown): AppError =>
  Err.unexpected('Busy', 'busy', ErrorMetadata.fromRecord({ retryAfterMs: ms }));

describe('retry honours retryAfterMs metadata', () => {
  it('waits the server-requested time when longer than the backoff', async () => {
    const { delays, time } = recordingTime();
    let attempts = 0;
    const r = await ResiliencePolicy.create({ time })
      .withRetry({ maxAttempts: 2, delay: 100, backoff: 'constant' })
      .execute(async () => {
        attempts++;
        return attempts < 3 ? Result.failure<number>(withRetryAfter(2_000)) : Result.success(1);
      });
    expect(r).toEqual(Result.success(1));
    expect(delays).toEqual([2_000, 2_000]);
  });

  it('keeps the backoff when it is longer than retryAfterMs', async () => {
    const { delays, time } = recordingTime();
    await retryIfFailed(async () => Result.failure<number>(withRetryAfter(50)), {
      maxAttempts: 1,
      delay: 500,
      time,
    });
    expect(delays).toEqual([500]);
  });

  it('caps retryAfterMs at maxRetryAfterMs (default 30 s)', async () => {
    const { delays, time } = recordingTime();
    await retryIfFailed(async () => Result.failure<number>(withRetryAfter(120_000)), {
      maxAttempts: 1,
      delay: 0,
      time,
    });
    await retryIfFailed(async () => Result.failure<number>(withRetryAfter(120_000)), {
      maxAttempts: 1,
      delay: 0,
      maxRetryAfterMs: 5_000,
      time,
    });
    expect(delays).toEqual([30_000, 5_000]);
  });

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '1000',
    undefined,
  ])('ignores an invalid retryAfterMs (%s)', async (value) => {
    const { delays, time } = recordingTime();
    await retryIfFailed(async () => Result.failure<number>(withRetryAfter(value)), {
      maxAttempts: 1,
      delay: 10,
      time,
    });
    expect(delays).toEqual([10]);
  });

  it('ignores the metadata of a thrown value', async () => {
    const { delays, time } = recordingTime();
    await retryIfFailed(
      async (): Promise<Result<number>> => {
        throw new Error('boom');
      },
      { maxAttempts: 1, delay: 10, time },
    );
    expect(delays).toEqual([10]);
  });

  it('rejects maxRetryAfterMs outside 0 … 1 day', () => {
    expect(() => ResiliencePolicy.create().withRetry({ maxRetryAfterMs: -1 })).toThrow(RangeError);
    expect(() => ResiliencePolicy.create().withRetry({ maxRetryAfterMs: 86_400_001 })).toThrow(
      RangeError,
    );
  });
});

describe('withRetry shouldRetry', () => {
  it('replaces the default classification', async () => {
    const { time } = recordingTime();
    let attempts = 0;
    const r = await ResiliencePolicy.create({ time })
      .withRetry({ maxAttempts: 3, delay: 0, shouldRetry: (e) => e.code === 'Again' })
      .execute(async () => {
        attempts++;
        return attempts < 3
          ? Result.failure<number>(Err.validation('Again', 'again'))
          : Result.failure<number>(Err.unexpected('Stop', 'stop'));
      });
    expect(attempts).toBe(3);
    expect(r.ok ? undefined : r.errors[0]?.code).toBe('Stop');
  });

  it('classifies a thrown value as an Unexpected error', async () => {
    const { time } = recordingTime();
    const seen: AppError[] = [];
    let attempts = 0;
    await ResiliencePolicy.create({ time })
      .withRetry({
        maxAttempts: 2,
        delay: 0,
        shouldRetry: (e) => {
          seen.push(e);
          return true;
        },
      })
      .execute(async (): Promise<Result<number>> => {
        attempts++;
        throw new Error('boom');
      });
    expect(attempts).toBe(3);
    expect(seen[0]?.type).toBe('Unexpected');
  });

  it('a throwing predicate stops retrying with an Unexpected failure', async () => {
    const { time } = recordingTime();
    let attempts = 0;
    const r = await ResiliencePolicy.create({ time })
      .withRetry({
        maxAttempts: 3,
        delay: 0,
        shouldRetry: () => {
          throw new Error('predicate');
        },
      })
      .execute(async () => {
        attempts++;
        return Result.failure<number>(Err.unexpected());
      });
    expect(attempts).toBe(1);
    expect(r.ok).toBe(false);
  });

  it('a throwing predicate after a caller abort rejects with the abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const p = ResiliencePolicy.create()
      .withRetry({
        maxAttempts: 3,
        delay: 0,
        shouldRetry: () => {
          throw new Error('predicate');
        },
      })
      .execute(
        async () => {
          controller.abort(reason);
          return Result.failure<number>(Err.unexpected());
        },
        { signal: controller.signal },
      );
    await expect(p).rejects.toBe(reason);
  });

  it('never retries a caller abort', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    let attempts = 0;
    const p = ResiliencePolicy.create()
      .withRetry({ maxAttempts: 3, delay: 0, shouldRetry: () => true })
      .execute(
        async (): Promise<Result<number>> => {
          attempts++;
          controller.abort(reason);
          throw reason;
        },
        { signal: controller.signal },
      );
    await expect(p).rejects.toBe(reason);
    expect(attempts).toBe(1);
  });
});
