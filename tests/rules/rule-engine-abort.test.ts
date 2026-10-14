import { Err } from '../../src/errors/app-error.js';
import type { Result as ResultT, VoidResult } from '../../src/result/result.js';
import { Result } from '../../src/result/result.js';
import type { AsyncRule, TypedAsyncRule } from '../../src/rules/rule.js';
import { RuleEngine } from '../../src/rules/rule-engine.js';

const abortError = (): Error => Object.assign(new Error('aborted'), { name: 'AbortError' });
const err = Err.validation('R.Fail', 'failed');

const ok: AsyncRule<unknown> = async () => Result.ok();
const fail: AsyncRule<unknown> = async () => Result.failure(err);
const okTyped: TypedAsyncRule<unknown, number> = async () => Result.success(1);

/** Rule that never settles on its own; rejects with signal.reason when aborted. */
const waitForAbort: AsyncRule<unknown> = (_ctx, signal) =>
  new Promise<VoidResult>((_, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

describe('RuleEngine.evaluate (sync exception guard)', () => {
  it('returns Rule.EvaluationFailed when the rule throws', () => {
    const r = RuleEngine.evaluate(() => {
      throw new Error('boom');
    }, {});
    expect(r.ok).toBe(false);
    expect(Result.firstError(r)?.code).toBe('Rule.EvaluationFailed');
    expect(Result.firstError(r)?.description).toBe('boom');
  });

  it('catches throws from nested combinators', () => {
    const throwing = (): VoidResult => {
      throw 'nested';
    };
    const r = RuleEngine.evaluate(
      RuleEngine.and(() => Result.ok(), throwing),
      {},
    );
    expect(Result.firstError(r)?.code).toBe('Rule.EvaluationFailed');
    expect(Result.firstError(r)?.description).toBe('nested');
  });

  it('passes through rule results unchanged', () => {
    const r = RuleEngine.evaluate(() => Result.failure(err), {});
    expect(Result.firstError(r)).toBe(err);
  });
});

describe('RuleEngine.evaluateAsync with signal', () => {
  it('passes the signal to the rule', async () => {
    const controller = new AbortController();
    const rule = vi.fn(async (_ctx: unknown, _s?: AbortSignal) => Result.ok());
    await RuleEngine.evaluateAsync(rule, 'ctx', { signal: controller.signal });
    expect(rule).toHaveBeenCalledWith('ctx', controller.signal);
  });

  it('already-aborted signal rejects without running the rule', async () => {
    const controller = new AbortController();
    controller.abort();
    const rule = vi.fn(ok);
    await expect(
      RuleEngine.evaluateAsync(rule, {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(rule).not.toHaveBeenCalled();
  });

  it('already-aborted signal with custom reason rejects with that reason', async () => {
    const controller = new AbortController();
    controller.abort('stop');
    await expect(RuleEngine.evaluateAsync(ok, {}, { signal: controller.signal })).rejects.toBe(
      'stop',
    );
  });

  it('caller abort during evaluation propagates', async () => {
    const controller = new AbortController();
    const pending = RuleEngine.evaluateAsync(waitForAbort, {}, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('caller abort with custom reason propagates that reason', async () => {
    const controller = new AbortController();
    const pending = RuleEngine.evaluateAsync(waitForAbort, {}, { signal: controller.signal });
    controller.abort('custom');
    await expect(pending).rejects.toBe('custom');
  });

  it('foreign AbortError while caller signal is not aborted becomes a failure', async () => {
    const controller = new AbortController();
    const r = await RuleEngine.evaluateAsync(
      async () => {
        throw abortError();
      },
      {},
      { signal: controller.signal },
    );
    expect(Result.firstError(r)?.code).toBe('Rule.EvaluationFailed');
  });

  it('AbortError without a signal becomes a failure', async () => {
    const r = await RuleEngine.evaluateAsync(async () => {
      throw abortError();
    }, {});
    expect(Result.firstError(r)?.code).toBe('Rule.EvaluationFailed');
  });

  it('awaits an in-flight rule that ignores the signal and returns its result', async () => {
    const controller = new AbortController();
    const rule: AsyncRule<unknown> = async () => {
      controller.abort();
      return Result.failure(err);
    };
    const r = await RuleEngine.evaluateAsync(rule, {}, { signal: controller.signal });
    expect(Result.firstError(r)).toBe(err);
  });

  it('still rejects (not throws synchronously) on an aborted signal', () => {
    const controller = new AbortController();
    controller.abort();
    const p = RuleEngine.evaluateAsync(ok, {}, { signal: controller.signal });
    expect(p).toBeInstanceOf(Promise);
    return expect(p).rejects.toBeDefined();
  });
});

describe('async combinators forward the signal and stop on abort', () => {
  const abortingFirst =
    (controller: AbortController): AsyncRule<unknown> =>
    async () => {
      controller.abort();
      return Result.ok();
    };

  it.each([
    ['linearAsync', RuleEngine.linearAsync, ok],
    ['andAsync', RuleEngine.andAsync, ok],
    ['andAllAsync', RuleEngine.andAllAsync, ok],
    ['orAsync', RuleEngine.orAsync, fail],
  ] as const)('%s forwards the signal to every child', async (_name, combinator, cont) => {
    const controller = new AbortController();
    const a = vi.fn(cont);
    const b = vi.fn(fail);
    await combinator(a, b)({}, controller.signal);
    expect(a).toHaveBeenCalledWith({}, controller.signal);
    expect(b).toHaveBeenCalledWith({}, controller.signal);
  });

  it.each([
    ['linearAsync', RuleEngine.linearAsync, ok],
    ['andAsync', RuleEngine.andAsync, ok],
    ['andAllAsync', RuleEngine.andAllAsync, ok],
    ['orAsync', RuleEngine.orAsync, fail],
  ] as const)('%s does not run the next child after the caller aborts', async (_name, combinator, cont) => {
    const controller = new AbortController();
    const next = vi.fn(fail);
    const first: AsyncRule<unknown> = async (ctx) => {
      controller.abort();
      return cont(ctx);
    };
    await expect(
      RuleEngine.evaluateAsync(combinator(first, next), {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['linearTypedAsync', RuleEngine.linearTypedAsync, true],
    ['andTypedAsync', RuleEngine.andTypedAsync, true],
    ['orTypedAsync', RuleEngine.orTypedAsync, false],
  ] as const)('%s forwards the signal and stops after abort', async (_name, combinator, succeed) => {
    const controller = new AbortController();
    const first = vi.fn(async (_ctx: unknown, s?: AbortSignal): Promise<ResultT<number>> => {
      expect(s).toBe(controller.signal);
      controller.abort();
      return succeed ? Result.success(1) : Result.failure(err);
    });
    const next = vi.fn(okTyped);
    await expect(combinator(first, next)({}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('ifAsync forwards the signal to condition and branch', async () => {
    const controller = new AbortController();
    const cond = vi.fn(ok);
    const onTrue = vi.fn(ok);
    await RuleEngine.ifAsync(cond, onTrue)({}, controller.signal);
    expect(cond).toHaveBeenCalledWith({}, controller.signal);
    expect(onTrue).toHaveBeenCalledWith({}, controller.signal);
  });

  it('ifAsync does not run the branch after the caller aborts', async () => {
    const controller = new AbortController();
    const onTrue = vi.fn(ok);
    await expect(
      RuleEngine.evaluateAsync(
        RuleEngine.ifAsync(abortingFirst(controller), onTrue),
        {},
        {
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(onTrue).not.toHaveBeenCalled();
  });

  it('fromPredicateAsync passes the signal to the predicate', async () => {
    const controller = new AbortController();
    const pred = vi.fn(async (_ctx: unknown, _s?: AbortSignal) => true);
    const r = await RuleEngine.evaluateAsync(RuleEngine.fromPredicateAsync(pred, err), 'c', {
      signal: controller.signal,
    });
    expect(r.ok).toBe(true);
    expect(pred).toHaveBeenCalledWith('c', controller.signal);
  });

  it('combinators without a signal behave as before', async () => {
    const r = await RuleEngine.evaluateAsync(RuleEngine.andAllAsync(ok, fail, fail), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
    const first = await RuleEngine.evaluateAsync(RuleEngine.andAsync(ok, fail, fail), {});
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.errors).toHaveLength(1);
  });
});

describe('per-node exception guard (every node turns a throw into a failure)', () => {
  const throwing = (): VoidResult => {
    throw new Error('boom');
  };
  const throwingAsync = async (): Promise<VoidResult> => {
    throw new Error('boom');
  };

  it('or(throwing, ok) succeeds', () => {
    expect(RuleEngine.or(throwing, () => Result.ok())({}).ok).toBe(true);
  });

  it('orAsync(throwing, ok) succeeds', async () => {
    expect((await RuleEngine.orAsync(throwingAsync, ok)({})).ok).toBe(true);
  });

  it('andAll(throwing, failing) keeps both errors', () => {
    const r = RuleEngine.andAll(throwing, () => Result.failure(err))({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toEqual(['Rule.EvaluationFailed', 'R.Fail']);
  });

  it('andAllAsync(throwing, failing) keeps both errors', async () => {
    const r = await RuleEngine.andAllAsync(throwingAsync, fail)({});
    if (!r.ok) expect(r.errors.map((e) => e.code)).toEqual(['Rule.EvaluationFailed', 'R.Fail']);
    expect(r.ok).toBe(false);
  });

  it('and(throwing, failing) stops at the throwing child', () => {
    const next = vi.fn(() => Result.failure(err));
    const r = RuleEngine.and(throwing, next)({});
    if (!r.ok) expect(r.errors.map((e) => e.code)).toEqual(['Rule.EvaluationFailed']);
    expect(r.ok).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it('andAsync(throwing, failing) stops at the throwing child', async () => {
    const next = vi.fn(fail);
    const r = await RuleEngine.andAsync(throwingAsync, next)({});
    if (!r.ok) expect(r.errors.map((e) => e.code)).toEqual(['Rule.EvaluationFailed']);
    expect(r.ok).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it('linear stops at a throwing child with Rule.EvaluationFailed', () => {
    const next = vi.fn(() => Result.ok());
    const r = RuleEngine.linear(throwing, next)({});
    expect(Result.firstError(r)?.code).toBe('Rule.EvaluationFailed');
    expect(next).not.toHaveBeenCalled();
  });

  it('if(throwingCond, a, onFalse) runs onFalse', () => {
    const onTrue = vi.fn(() => Result.ok());
    const onFalse = vi.fn(() => Result.failure(err));
    const r = RuleEngine.if(throwing, onTrue, onFalse)({});
    expect(onTrue).not.toHaveBeenCalled();
    expect(Result.firstError(r)).toBe(err);
  });

  it('ifAsync(throwingCond, a, onFalse) runs onFalse', async () => {
    const onTrue = vi.fn(ok);
    const r = await RuleEngine.ifAsync(throwingAsync, onTrue, fail)({});
    expect(onTrue).not.toHaveBeenCalled();
    expect(Result.firstError(r)).toBe(err);
  });

  it('typed combinators guard throwing children', async () => {
    const throwingTyped = (): ResultT<number> => {
      throw new Error('boom');
    };
    expect(RuleEngine.orTyped(throwingTyped, () => Result.success(2))({})).toEqual(
      Result.success(2),
    );
    const r = await RuleEngine.orTypedAsync(async () => throwingTyped(), okTyped)({});
    expect(r).toEqual(Result.success(1));
  });

  it('a caller abort thrown by a child inside orAsync still rejects', async () => {
    const controller = new AbortController();
    const next = vi.fn(ok);
    const pending = RuleEngine.evaluateAsync(
      RuleEngine.orAsync(waitForAbort, next),
      {},
      {
        signal: controller.signal,
      },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(next).not.toHaveBeenCalled();
  });

  it('a foreign AbortError from a child inside orAsync is a failure, next child runs', async () => {
    const controller = new AbortController();
    const r = await RuleEngine.evaluateAsync(
      RuleEngine.orAsync(async () => {
        throw abortError();
      }, ok),
      {},
      { signal: controller.signal },
    );
    expect(r.ok).toBe(true);
  });
});
