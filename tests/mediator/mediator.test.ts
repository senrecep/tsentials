import { Err } from '../../src/errors/index.js';
import {
  type Behavior,
  createMediator,
  exceptionHandlingBehavior,
  type GenericBehavior,
  pipeline,
} from '../../src/mediator/index.js';
import { Result } from '../../src/result/index.js';

type Requests = {
  Double: { request: { n: number }; response: number };
  Greet: { request: string; response: string };
};

describe('pipeline', () => {
  it('runs behaviors outermost first', async () => {
    const calls: string[] = [];
    const tag =
      (name: string): Behavior<number, number> =>
      async (_req, next) => {
        calls.push(`${name}:before`);
        const r = await next();
        calls.push(`${name}:after`);
        return r;
      };
    const run = pipeline<number, number>(
      (n) => {
        calls.push('handler');
        return Result.success(n);
      },
      tag('a'),
      tag('b'),
    );
    await run(1, { requestName: 'X', signal: undefined });
    expect(calls).toEqual(['a:before', 'b:before', 'handler', 'b:after', 'a:after']);
  });

  it('lets a behavior replace the request and the signal', async () => {
    const controller = new AbortController();
    const run = pipeline<number, string>(
      (n, ctx) => Result.success(`${n}:${ctx.signal === controller.signal}`),
      (n, next) => next(n * 10, controller.signal),
    );
    const r = await run(2, { requestName: 'X', signal: undefined });
    expect(r).toEqual(Result.success('20:true'));
  });

  it('short-circuits when a behavior does not call next', async () => {
    const handler = vi.fn(() => Result.success(1));
    const run = pipeline<number, number>(handler, () =>
      Result.failure(Err.validation('Stop', 'stopped')),
    );
    const r = await run(1, { requestName: 'X', signal: undefined });
    expect(r.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('turns a synchronous throw into a rejection', async () => {
    const run = pipeline<number, number>(() => {
      throw new Error('boom');
    });
    await expect(run(1, { requestName: 'X', signal: undefined })).rejects.toThrow('boom');
  });
});

describe('createMediator', () => {
  it('dispatches by name with the request context', async () => {
    const controller = new AbortController();
    const mediator = createMediator<Requests>()
      .register('Double', (req, ctx) => {
        expect(ctx).toEqual({ requestName: 'Double', signal: controller.signal });
        return Result.success(req.n * 2);
      })
      .register('Greet', async (name) => Result.success(`hi ${name}`));
    expect(await mediator.send('Double', { n: 21 }, { signal: controller.signal })).toEqual(
      Result.success(42),
    );
    expect(await mediator.send('Greet', 'bob')).toEqual(Result.success('hi bob'));
    expect(mediator.has('Greet')).toBe(true);
  });

  it('rejects unknown requests and duplicate registrations', async () => {
    const mediator = createMediator<Requests>().register('Greet', (s) => Result.success(s));
    await expect(mediator.send('Double', { n: 1 })).rejects.toThrow(
      "No handler registered for request 'Double'.",
    );
    expect(mediator.has('Double')).toBe(false);
    expect(() => mediator.register('Greet', (s) => Result.success(s))).toThrow(TypeError);
  });

  it('wraps per-request behaviors in the mediator-wide behaviors', async () => {
    const calls: string[] = [];
    const global: GenericBehavior = async (_req, next) => {
      calls.push('global');
      return next();
    };
    const mediator = createMediator<Requests>({ behaviors: [global] }).register(
      'Greet',
      (s) => Result.success(s),
      async (_req, next) => {
        calls.push('local');
        return next();
      },
    );
    await mediator.send('Greet', 'x');
    expect(calls).toEqual(['global', 'local']);
  });

  it('converts handler exceptions with the exception behavior', async () => {
    const mediator = createMediator<Requests>({
      behaviors: [exceptionHandlingBehavior()],
    }).register('Greet', () => {
      throw new RangeError('bad');
    });
    const r = await mediator.send('Greet', 'x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ code: 'RangeError', description: 'bad' });
  });
});
