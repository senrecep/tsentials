import { Err } from '../../src/errors/app-error.js';
import { ErrorType } from '../../src/errors/error-type.js';
import { Result } from '../../src/result/result.js';
import { fromAsync } from '../../src/result/result-async.js';

const success = Result.success(1);
const never = (): never => {
  throw new Error('must not be called');
};

describe('Result edge cases', () => {
  it('mapEachErrorAsync returns a success unchanged', async () => {
    expect(await Result.mapEachErrorAsync(success, never)).toBe(success);
  });

  it('recoverFirst returns a success unchanged', () => {
    expect(Result.recoverFirst(success, ErrorType.Validation, never)).toBe(success);
  });

  it('recoverFirstAsync returns a success unchanged', async () => {
    expect(await Result.recoverFirstAsync(success, ErrorType.Validation, never)).toBe(success);
  });

  it('ResultAsync.recoverFirst returns a success unchanged', async () => {
    expect(
      await fromAsync(Promise.resolve(success)).recoverFirst(ErrorType.Validation, never),
    ).toBe(success);
  });

  it('traverseAsync rethrows the first exception when concurrent items both throw', async () => {
    const first = new Error('first');
    const second = new Error('second');
    const fn = (item: number): Promise<Result<number>> =>
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(item === 0 ? first : second), item),
      );
    await expect(Result.traverseAsync([0, 5], fn, { concurrency: 2 })).rejects.toBe(first);
  });

  it('tapErrorFirst reports only the first error', () => {
    const fn = vi.fn();
    const a = Err.validation('A', 'a');
    Result.tapErrorFirst(Result.failureFrom([a, Err.validation('B', 'b')]), fn);
    expect(fn).toHaveBeenCalledExactlyOnceWith(a);
  });

  it('tapErrorFirst skips a hand-built failure without errors', () => {
    const fn = vi.fn();
    const empty = { ok: false, errors: [] } as unknown as Result<number>;
    expect(Result.tapErrorFirst(empty, fn)).toBe(empty);
    expect(fn).not.toHaveBeenCalled();
  });
});
