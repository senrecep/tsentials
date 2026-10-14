import { Err } from '../../src/errors/app-error.js';
import { resolveTime, runPipeline } from '../../src/resilience/pipeline.js';
import { Result } from '../../src/result/result.js';

describe('runPipeline boundary re-check', () => {
  it('rejects with the abort reason when isRetryable throws after a caller abort', async () => {
    const ctrl = new AbortController();
    const reason = new Error('caller abort');
    await expect(
      runPipeline<number>(
        [],
        () => {
          ctrl.abort(reason);
          return Result.failure<number>(Err.failure('Transient'));
        },
        ctrl.signal,
        () => {
          throw new TypeError('classifier failed');
        },
      ),
    ).rejects.toBe(reason);
  });

  it('does not call isRetryable when the caller did not abort', async () => {
    const isRetryable = vi.fn(() => {
      throw new TypeError('classifier failed');
    });
    const r = await runPipeline<number>(
      [],
      () => Result.failure<number>(Err.failure('Transient')),
      new AbortController().signal,
      isRetryable,
    );
    expect(r.ok).toBe(false);
    expect(isRetryable).not.toHaveBeenCalled();
  });
});

describe('default delay', () => {
  it('rejects with the reason when the signal is already aborted', async () => {
    const reason = new Error('already aborted');
    await expect(resolveTime(undefined).delay(60_000, AbortSignal.abort(reason))).rejects.toBe(
      reason,
    );
  });
});
