import { type AppError, Err, ErrorType } from '../../src/errors/index.js';
import {
  loggingValidationFailureObserver,
  type MediatorLogLevel,
  type NextHandler,
  type RequestContext,
  type RequestValidator,
  type ValidationFailure,
  validationBehavior,
} from '../../src/mediator/index.js';
import { Result } from '../../src/result/index.js';
import { RuleEngine } from '../../src/rules/index.js';

interface Cmd {
  readonly name: string;
  readonly validationMode?: 'enforce' | 'logOnly' | 'off';
}

const ctx = (signal?: AbortSignal): RequestContext => ({ requestName: 'CreateUser', signal });

function handler() {
  const fn = vi.fn(() => Result.success('done'));
  const next: NextHandler<Cmd, string> = async () => fn();
  return { fn, next };
}

const failWith =
  (...errors: AppError[]) =>
  (_req: Cmd): Result<Cmd> =>
    Result.failureFrom(errors);
const pass = (req: Cmd): Result<Cmd> => Result.success(req);

const e1 = Err.validation('Name.Empty', 'Name is empty');
const e2 = Err.validation('Name.Long', 'Name is too long');

describe('validationBehavior', () => {
  it('calls next when there are no validators', async () => {
    const h = handler();
    expect(await validationBehavior<Cmd>([])({ name: '' }, h.next, ctx())).toEqual(
      Result.success('done'),
    );
  });

  it('calls next when validation succeeds', async () => {
    const h = handler();
    await validationBehavior([pass])({ name: 'a' }, h.next, ctx());
    expect(h.fn).toHaveBeenCalled();
  });

  it('returns the failure without calling the handler', async () => {
    const h = handler();
    const r = await validationBehavior([failWith(e1)])({ name: '' }, h.next, ctx());
    expect(r).toEqual(Result.failure(e1));
    expect(h.fn).not.toHaveBeenCalled();
  });

  it('accepts rules from tsentials/rules', async () => {
    const h = handler();
    const rule = RuleEngine.fromPredicate<Cmd>((c) => c.name.length > 0, e1);
    const r = await validationBehavior([rule])({ name: '' }, h.next, ctx());
    expect(r).toEqual(Result.failure(e1));
  });

  it('aggregates errors from multiple validators and removes duplicates', async () => {
    const h = handler();
    const r = await validationBehavior([failWith(e1), failWith(e2), failWith(e1)])(
      { name: '' },
      h.next,
      ctx(),
    );
    expect(r.ok || r.errors).toEqual([e1, e2]);
  });

  it('keeps duplicates from a single validator', async () => {
    const h = handler();
    const r = await validationBehavior([failWith(e1, e1)])({ name: '' }, h.next, ctx());
    expect(r.ok || r.errors).toEqual([e1, e1]);
  });

  it('accumulates errors in group order and runs a group concurrently', async () => {
    const h = handler();
    const started: string[] = [];
    const slow = (tag: string, error: AppError, ms: number): RequestValidator<Cmd> => ({
      order: tag === 'late' ? 2 : 1,
      validate: async () => {
        started.push(tag);
        await new Promise((r) => setTimeout(r, ms));
        return Result.failure(error);
      },
    });
    const e3 = Err.validation('Late', 'late');
    const r = await validationBehavior([slow('late', e3, 0), slow('a', e1, 10), slow('b', e2, 0)])(
      { name: '' },
      h.next,
      ctx(),
    );
    expect(started).toEqual(['a', 'b', 'late']);
    expect(r.ok || r.errors).toEqual([e1, e2, e3]);
  });

  it('calls next when all ordered groups pass', async () => {
    const h = handler();
    await validationBehavior([
      { order: 2, validate: pass },
      { order: -1, validate: pass },
    ])({ name: 'a' }, h.next, ctx());
    expect(h.fn).toHaveBeenCalled();
  });

  it('treats a validator object without an order as order 0', async () => {
    const h = handler();
    const r = await validationBehavior<Cmd>([
      { validate: failWith(e2) },
      { order: -1, validate: failWith(e1) },
    ])({ name: '' }, h.next, ctx());
    expect(r.ok || r.errors).toEqual([e1, e2]);
    expect(h.fn).not.toHaveBeenCalled();
  });

  it('throws the abort reason when the signal is already aborted', async () => {
    const h = handler();
    const validate = vi.fn(pass);
    const controller = new AbortController();
    controller.abort();
    await expect(
      validationBehavior([validate])({ name: 'a' }, h.next, ctx(controller.signal)),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(validate).not.toHaveBeenCalled();
  });

  it('turns a throwing validator into Validator.Exception', async () => {
    const h = handler();
    const r = await validationBehavior<Cmd>([
      () => {
        throw new Error('bug');
      },
    ])({ name: 'a' }, h.next, ctx());
    expect(r.ok || r.errors[0]).toMatchObject({
      code: 'Validator.Exception',
      description: 'bug',
      type: ErrorType.Failure,
    });
  });

  it('propagates abort errors from validators', async () => {
    const h = handler();
    const abort = new DOMException('aborted', 'AbortError');
    await expect(
      validationBehavior<Cmd>([
        pass,
        async () => {
          throw abort;
        },
      ])({ name: 'a' }, h.next, ctx()),
    ).rejects.toBe(abort);
  });

  it('passes the signal to validators', async () => {
    const h = handler();
    const controller = new AbortController();
    const validate = vi.fn(pass);
    await validationBehavior([validate])({ name: 'a' }, h.next, ctx(controller.signal));
    expect(validate).toHaveBeenCalledWith({ name: 'a' }, controller.signal);
  });
});

describe('validation modes and observers', () => {
  function recorder() {
    const seen: ValidationFailure[] = [];
    return { seen, observer: (f: ValidationFailure) => void seen.push(f) };
  }

  it('enforce returns the failure and notifies observers', async () => {
    const h = handler();
    const rec = recorder();
    const r = await validationBehavior([failWith(e1)], { observers: [rec.observer] })(
      { name: '' },
      h.next,
      ctx(),
    );
    expect(r.ok).toBe(false);
    expect(rec.seen).toEqual([
      { requestName: 'CreateUser', request: { name: '' }, errors: [e1], mode: 'enforce' },
    ]);
  });

  it('logOnly notifies observers and continues', async () => {
    const h = handler();
    const rec = recorder();
    const r = await validationBehavior([failWith(e1), { order: 1, validate: failWith(e2) }], {
      observers: [rec.observer],
      defaultMode: 'logOnly',
    })({ name: '' }, h.next, ctx());
    expect(r).toEqual(Result.success('done'));
    expect(rec.seen[0]?.errors).toEqual([e1, e2]);
    expect(rec.seen[0]?.mode).toBe('logOnly');
  });

  it('logOnly reports validator exceptions and continues', async () => {
    const h = handler();
    const rec = recorder();
    await validationBehavior<Cmd>(
      [
        () => {
          throw new Error('bug');
        },
      ],
      { observers: [rec.observer], defaultMode: 'logOnly' },
    )({ name: '' }, h.next, ctx());
    expect(h.fn).toHaveBeenCalled();
    expect(rec.seen[0]?.errors[0]?.code).toBe('Validator.Exception');
  });

  it('off skips validators and observers', async () => {
    const h = handler();
    const rec = recorder();
    const validate = vi.fn(failWith(e1));
    await validationBehavior([validate], { observers: [rec.observer], defaultMode: 'off' })(
      { name: '' },
      h.next,
      ctx(),
    );
    expect(validate).not.toHaveBeenCalled();
    expect(rec.seen).toHaveLength(0);
    expect(h.fn).toHaveBeenCalled();
  });

  it('valid requests do not notify observers', async () => {
    const h = handler();
    const rec = recorder();
    await validationBehavior([pass], { observers: [rec.observer] })({ name: 'a' }, h.next, ctx());
    expect(rec.seen).toHaveLength(0);
  });

  it.each([
    ['enforce', 'logOnly', false],
    ['logOnly', 'enforce', true],
    ['off', 'enforce', true],
  ] as const)('request mode %s wins over default %s', async (mode, defaultMode, continues) => {
    const h = handler();
    await validationBehavior([failWith(e1)], { defaultMode })(
      { name: '', validationMode: mode },
      h.next,
      ctx(),
    );
    expect(h.fn.mock.calls.length > 0).toBe(continues);
  });

  it('ignores an invalid request mode', async () => {
    const h = handler();
    const request = { name: '', validationMode: 'bogus' } as unknown as Cmd;
    const r = await validationBehavior([failWith(e1)])(request, h.next, ctx());
    expect(r.ok).toBe(false);
  });

  it('runs observers sequentially in registration order', async () => {
    const h = handler();
    const order: string[] = [];
    await validationBehavior([failWith(e1)], {
      observers: [
        async () => {
          await new Promise((r) => setTimeout(r, 5));
          order.push('first');
        },
        () => void order.push('second'),
      ],
    })({ name: '' }, h.next, ctx());
    expect(order).toEqual(['first', 'second']);
  });

  it('observers cannot change the returned errors', async () => {
    const h = handler();
    const r = await validationBehavior([failWith(e1)], {
      observers: [
        (f) => {
          expect(() => (f.errors as AppError[]).push(e2)).toThrow(TypeError);
        },
      ],
    })({ name: '' }, h.next, ctx());
    expect(r.ok || r.errors).toEqual([e1]);
  });

  it('observer exceptions propagate', async () => {
    const h = handler();
    await expect(
      validationBehavior([failWith(e1)], {
        observers: [
          () => {
            throw new Error('observer');
          },
        ],
      })({ name: '' }, h.next, ctx()),
    ).rejects.toThrow('observer');
  });
});

describe('loggingValidationFailureObserver', () => {
  function logger(disabled: MediatorLogLevel[] = []) {
    const entries: { level: MediatorLogLevel; message: string }[] = [];
    return {
      entries,
      log: (level: MediatorLogLevel, message: string) => void entries.push({ level, message }),
      isEnabled: (level: MediatorLogLevel) => !disabled.includes(level),
    };
  }
  const failure = (mode: ValidationFailure['mode']): ValidationFailure => ({
    requestName: 'CreateUser',
    request: {},
    errors: [e1, e2],
    mode,
  });

  it.each([
    ['logOnly', 'warning', 'log_only'],
    ['enforce', 'debug', 'enforce'],
    ['off', 'debug', 'off'],
  ] as const)('logs %s at %s', async (mode, level, text) => {
    const l = logger();
    await loggingValidationFailureObserver(l)(failure(mode), undefined);
    expect(l.entries).toEqual([
      {
        level,
        message: `Validation of CreateUser failed in ${text} mode with 2 error(s): Name.Empty, Name.Long`,
      },
    ]);
  });

  it('logs when the logger does not implement isEnabled', async () => {
    const entries: string[] = [];
    const plain = {
      log: (_level: MediatorLogLevel, message: string) => void entries.push(message),
    };
    await loggingValidationFailureObserver(plain)(failure('enforce'), undefined);
    expect(entries).toHaveLength(1);
  });

  it('counts failures with request and mode tags', async () => {
    const count = vi.fn();
    await loggingValidationFailureObserver(undefined, { count })(failure('logOnly'), undefined);
    expect(count).toHaveBeenCalledWith({ request: 'CreateUser', mode: 'log_only' });
  });

  it('does not log when the level is disabled', async () => {
    const l = logger(['debug']);
    const count = vi.fn();
    await loggingValidationFailureObserver(l, { count })(failure('enforce'), undefined);
    expect(l.entries).toHaveLength(0);
    expect(count).toHaveBeenCalledTimes(1);
  });
});
