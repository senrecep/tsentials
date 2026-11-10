import { Err } from '../../src/errors/app-error.js';
import { Result } from '../../src/result/result.js';
import { chain } from '../../src/result/result-chain.js';

const ok = Result.success(1);
const fail = Result.failure(Err.validation('Test.Invalid', 'invalid'));

// A fake thenable, so a test never creates a real unhandled rejection.
function thenable() {
  const then = vi.fn();
  return { then, value: { then } };
}

function rejectionHandler(then: ReturnType<typeof vi.fn>): (error: unknown) => never {
  expect(then).toHaveBeenCalledTimes(1);
  const [onFulfilled, onRejected] = then.mock.calls[0] as [unknown, (error: unknown) => never];
  expect(onFulfilled).toBeUndefined();
  return onRejected;
}

describe('sync callbacks that return a promise', () => {
  const cases: [string, (cb: () => never) => void, RegExp][] = [
    ['Result.tap', (cb) => Result.tap(ok, cb), /Result\.tap callback.*Result\.tapAsync\(\)/],
    [
      'Result.tapError',
      (cb) => Result.tapError(fail, cb),
      /Result\.tapError callback.*Result\.tapErrorAsync\(\)/,
    ],
    [
      'Result.tapErrorFirst',
      (cb) => Result.tapErrorFirst(fail, cb),
      /Result\.tapErrorFirst callback.*Result\.tapErrorAsync\(\)/,
    ],
    ['Result.tapIf', (cb) => Result.tapIf(ok, true, cb), /Result\.tapIf callback.*tapIf\(\)/],
    [
      'Result.tapErrorIf',
      (cb) => Result.tapErrorIf(fail, true, cb),
      /Result\.tapErrorIf callback.*tapErrorIf\(\)/,
    ],
    [
      'Result.switch success',
      (cb) => Result.switch(ok, cb, () => {}),
      /Result\.switch callback.*Result\.match\(\)/,
    ],
    [
      'Result.switch failure',
      (cb) => Result.switch(fail, () => {}, cb),
      /Result\.switch callback.*Result\.match\(\)/,
    ],
    [
      'Result.switchFirst',
      (cb) => Result.switchFirst(fail, () => {}, cb),
      /Result\.switchFirst callback/,
    ],
    [
      'Result.switchLast',
      (cb) => Result.switchLast(fail, () => {}, cb),
      /Result\.switchLast callback/,
    ],
    ['ResultChain.tap', (cb) => chain(ok).tap(cb), /Result\.tap callback/],
    ['ResultChain.tapError', (cb) => chain(fail).tapError(cb), /Result\.tapError callback/],
    ['ResultChain.tapIf', (cb) => chain(ok).tapIf(true, cb), /Result\.tapIf callback/],
    [
      'ResultChain.tapErrorIf',
      (cb) => chain(fail).tapErrorIf(true, cb),
      /Result\.tapErrorIf callback/,
    ],
  ];

  it.each(cases)(
    '%s rethrows the rejection as a TypeError naming the async variant',
    (_, call, message) => {
      const { then, value } = thenable();
      call((() => value) as unknown as () => never);
      const cause = new Error('boom');
      let thrown: unknown;
      try {
        rejectionHandler(then)(cause);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      expect((thrown as TypeError).message).toMatch(message);
      expect((thrown as TypeError).cause).toBe(cause);
    },
  );

  it('leaves a non-thenable return value alone and returns the result unchanged', () => {
    const fn = vi.fn(() => 42 as unknown as void);
    expect(Result.tap(ok, fn)).toBe(ok);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('does not touch a fulfilled promise', async () => {
    await expect(
      new Promise<void>((resolve) => {
        Result.tap(ok, async () => resolve());
      }),
    ).resolves.toBeUndefined();
  });
});
