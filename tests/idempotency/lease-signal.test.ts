import { Err } from '../../src/errors/index.js';
import {
  IdempotencyErrorCodes,
  type IdempotencyStore,
  InMemoryIdempotencyStore,
  idempotencyBehavior,
  idempotencyKeys,
  idempotencyScopes,
  idempotent,
  type WithIdempotencyOptions,
  withIdempotency,
} from '../../src/idempotency/index.js';
import { createMediator, exceptionHandlingBehavior } from '../../src/mediator/index.js';
import { Result } from '../../src/result/index.js';

/** An in-memory store whose `extend` always reports a lost lease (or that has no `extend`). */
function store(extend: 'lost' | 'none' | 'real'): IdempotencyStore {
  const inner = new InMemoryIdempotencyStore();
  const base: IdempotencyStore = {
    reserve: (...args) => inner.reserve(...args),
    complete: (...args) => inner.complete(...args),
    release: (...args) => inner.release(...args),
  };
  if (extend === 'none') return base;
  return {
    ...base,
    extend:
      extend === 'lost'
        ? async function lost() {
            return false;
          }
        : (...args) => inner.extend(...args),
  };
}

const aborted = (signal: AbortSignal) =>
  new Promise<unknown>((resolve) => {
    if (signal.aborted) resolve(signal.reason);
    else signal.addEventListener('abort', () => resolve(signal.reason), { once: true });
  });

const reasonName = (reason: unknown) => (reason as Error).name;

/** Longer than the first beat of a 'lost' store (10 ms), so the lease is lost by then. */
const afterLoss = () => new Promise((resolve) => setTimeout(resolve, 50));

// The first beat runs after 10 ms. A 'real' store uses a long lease, so a slow machine never
// misses a deadline.
const LEASE = 30;
const leaseOf = (s: IdempotencyStore) => (s.extend?.name === 'lost' ? LEASE : 60_000);

describe('lease signal: mediator', () => {
  type Requests = {
    Capture: { request: { idempotencyKey: string; idempotencyScope: unknown }; response: string };
  };
  const request = { idempotencyKey: 'k1', idempotencyScope: idempotencyScopes.tenant('t1') };

  function mediator(
    s: IdempotencyStore,
    onSignal: (signal: AbortSignal) => Promise<unknown>,
    order: 'none' | 'inner' | 'outer' = 'none',
  ) {
    const idem = idempotencyBehavior({ store: s, leaseMs: leaseOf(s) });
    const behaviors =
      order === 'none'
        ? [idem]
        : order === 'inner'
          ? [idem, exceptionHandlingBehavior()]
          : [exceptionHandlingBehavior(), idem];
    return createMediator<Requests>({ behaviors }).register('Capture', async (_req, ctx) =>
      Result.success(String(await onSignal(ctx.signal))),
    );
  }

  it.each([
    'inner',
    'outer',
  ] as const)('answers ReservationLost when the handler rethrows the lease abort (exception handling %s)', async (order) => {
    const s = store('lost');
    const send = mediator(
      s,
      async (signal) => {
        await aborted(signal);
        signal.throwIfAborted();
      },
      order,
    );
    const result = await send.send('Capture', request);
    expect(result.ok).toBe(false);
    expect(Result.firstError(result)?.code).toBe(IdempotencyErrorCodes.ReservationLost);
    // The key was released: a retry runs the handler again.
    const again = await createMediator<Requests>({
      behaviors: [idempotencyBehavior({ store: s, leaseMs: 60_000 })],
    })
      .register('Capture', async () => Result.success('again'))
      .send('Capture', request);
    expect(again).toEqual(Result.success('again'));
  });

  it('still rejects with the caller reason when the caller aborts', async () => {
    const controller = new AbortController();
    const send = mediator(
      store('real'),
      async (signal) => {
        queueMicrotask(() => controller.abort('caller'));
        await aborted(signal);
        signal.throwIfAborted();
      },
      'inner',
    );
    await expect(send.send('Capture', request, { signal: controller.signal })).rejects.toBe(
      'caller',
    );
  });

  it('aborts ctx.signal with ReservationLost when the lease is lost', async () => {
    const result = await mediator(store('lost'), async (signal) =>
      reasonName(await aborted(signal)),
    ).send('Capture', request);
    expect(result).toEqual(Result.success('ReservationLost'));
  });

  it('aborts ctx.signal with the caller reason', async () => {
    const controller = new AbortController();
    const result = await mediator(store('real'), async (signal) => {
      queueMicrotask(() => controller.abort('caller'));
      return aborted(signal);
    }).send('Capture', request, { signal: controller.signal });
    expect(result).toEqual(Result.success('caller'));
  });

  it('keeps the caller signal when the store has no extend', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    await mediator(store('none'), async (signal) => {
      seen = signal;
      return 'ok';
    }).send('Capture', request, { signal: controller.signal });
    expect(seen).toBe(controller.signal);
  });
});

describe('lease signal: idempotent', () => {
  interface Cmd {
    orderId: string;
    signal?: AbortSignal;
  }
  const options = (s: IdempotencyStore) => ({
    store: s,
    leaseMs: leaseOf(s),
    namespace: 'capture',
    key: (cmd: Cmd) => idempotencyKeys.for('capture', cmd.orderId),
    scope: () => idempotencyScopes.tenant('t1'),
    fingerprint: (cmd: Cmd) => cmd.orderId,
  });

  it('passes the lease signal through bindSignal', async () => {
    const capture = idempotent(
      async (cmd: Cmd) => Result.success(reasonName(await aborted(cmd.signal!))),
      { ...options(store('lost')), bindSignal: (signal, cmd) => [{ ...cmd, signal }] },
    );
    expect(await capture({ orderId: 'o1' })).toEqual(Result.success('ReservationLost'));
  });

  it('answers ReservationLost when fn rejects after the loss', async () => {
    const capture = idempotent(
      async (cmd: Cmd) => {
        await aborted(cmd.signal!);
        cmd.signal!.throwIfAborted();
        return Result.success('unreachable');
      },
      { ...options(store('lost')), bindSignal: (signal, cmd) => [{ ...cmd, signal }] },
    );
    const result = await capture({ orderId: 'o1' });
    expect(Result.firstError(result)?.code).toBe(IdempotencyErrorCodes.ReservationLost);
  });

  it('rethrows an unrelated error after the loss without bindSignal', async () => {
    const capture = idempotent(
      async (_cmd: Cmd) => {
        await afterLoss();
        throw new Error('db');
      },
      options(store('lost')),
    );
    await expect(capture({ orderId: 'o1' })).rejects.toThrow('db');
  });

  it('releases a failure returned after the loss, so a retry runs again', async () => {
    const s = store('lost');
    let runs = 0;
    const capture = idempotent(
      async (cmd: Cmd) => {
        runs++;
        const reason = await aborted(cmd.signal!);
        return Result.failure<string>(Err.fromException(reason));
      },
      { ...options(s), bindSignal: (signal, cmd) => [{ ...cmd, signal }] },
    );
    expect(Result.isFailure(await capture({ orderId: 'o1' }))).toBe(true);
    expect(Result.isFailure(await capture({ orderId: 'o1' }))).toBe(true);
    expect(runs).toBe(2);
  });

  it('releases the key when bindSignal throws', async () => {
    const s = store('real');
    let fail = true;
    const capture = idempotent(async (cmd: Cmd) => Result.success(cmd.orderId), {
      ...options(s),
      bindSignal: (signal, cmd) => {
        if (fail) throw new TypeError('cannot bind');
        return [{ ...cmd, signal }];
      },
    });
    await expect(capture({ orderId: 'o1' })).rejects.toThrow('cannot bind');
    fail = false;
    expect(await capture({ orderId: 'o1' })).toEqual(Result.success('o1'));
  });

  it('calls fn with the original arguments without bindSignal or without extend', async () => {
    const cmd: Cmd = { orderId: 'o1' };
    const seen: Cmd[] = [];
    const fn = async (c: Cmd) => {
      seen.push(c);
      return Result.success('ok');
    };
    await idempotent(fn, options(store('real')))(cmd);
    const bind = vi.fn((signal: AbortSignal, c: Cmd): [Cmd] => [{ ...c, signal }]);
    await idempotent(fn, { ...options(store('none')), bindSignal: bind })(cmd);
    expect(seen).toEqual([cmd, cmd]);
    expect(seen[0]).toBe(cmd);
    expect(seen[1]).toBe(cmd);
    expect(bind).not.toHaveBeenCalled();
  });
});

describe('lease signal: withIdempotency', () => {
  const post = (body: BodyInit = '{"sku":"a"}', signal?: AbortSignal) =>
    new Request('https://api.test/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'k1' },
      body,
      ...(signal === undefined ? {} : { signal }),
      ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
    } as RequestInit);
  const bindRequest = (req: Request, signal: AbortSignal) => new Request(req, { signal });
  const wrap = (
    s: IdempotencyStore,
    handler: (request: Request) => Promise<Response>,
    bind: WithIdempotencyOptions['bindRequest'] = bindRequest,
  ) =>
    withIdempotency(handler, {
      store: s,
      leaseMs: leaseOf(s),
      scope: () => idempotencyScopes.tenant('1'),
      bindRequest: bind,
    });

  it('passes the original request by default, with the heartbeat still running', async () => {
    const original = post();
    let seen: Request | undefined;
    const s = store('real');
    let extendCalls = 0;
    const counting: IdempotencyStore = {
      ...s,
      extend: (...args) => {
        extendCalls++;
        return s.extend!(...args);
      },
    };
    const handler = withIdempotency(
      async (request) => {
        seen = request;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return new Response('ok', { status: 201 });
      },
      { store: counting, leaseMs: 30, scope: () => idempotencyScopes.tenant('1') },
    );
    await handler(original);
    expect(seen).toBe(original);
    expect(extendCalls).toBeGreaterThan(0);
  });

  it('gives the bound request a signal that aborts when the lease is lost', async () => {
    const handler = wrap(
      store('lost'),
      async (request) => new Response(reasonName(await aborted(request.signal))),
    );
    expect(await (await handler(post())).text()).toBe('ReservationLost');
  });

  it('answers 503 ReservationLost with Retry-After when the handler throws after the loss', async () => {
    const s = store('lost');
    const handler = wrap(s, async (request) => {
      await aborted(request.signal);
      request.signal.throwIfAborted();
      return new Response('unreachable');
    });
    const response = await handler(post());
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await response.json()).toMatchObject({
      status: 503,
      code: IdempotencyErrorCodes.ReservationLost,
    });
    // Released: a retry runs again.
    const retry = await wrap(s, async () => new Response('again', { status: 201 }))(post());
    expect(await retry.text()).toBe('again');
  });

  it('rethrows an unrelated handler error after the loss, with or without bindRequest', async () => {
    const failing = async () => {
      await afterLoss();
      throw new Error('db');
    };
    const unbound = withIdempotency(failing, {
      store: store('lost'),
      leaseMs: LEASE,
      scope: () => idempotencyScopes.tenant('1'),
    });
    await expect(unbound(post())).rejects.toThrow('db');
    await expect(wrap(store('lost'), failing)(post())).rejects.toThrow('db');
  });

  it('releases a 500 returned after the loss, so a retry runs again', async () => {
    const s = store('lost');
    const handler = wrap(s, async (request) => {
      await aborted(request.signal);
      return new Response('failed', { status: 500 });
    });
    expect((await handler(post())).status).toBe(500);
    const retry = await wrap(s, async () => new Response('again', { status: 201 }))(post());
    expect(await retry.text()).toBe('again');
  });

  it('propagates the caller abort to the bound request', async () => {
    const controller = new AbortController();
    const handler = wrap(store('real'), async (request) => {
      queueMicrotask(() => controller.abort('caller'));
      return new Response(String(await aborted(request.signal)));
    });
    expect(await (await handler(post(undefined, controller.signal))).text()).toBe('caller');
  });

  it('keeps the body readable after the bind, for a string and a streamed body', async () => {
    const echo = async (request: Request) => new Response(await request.text(), { status: 201 });
    const original = post();
    let seen: Request | undefined;
    const response = await wrap(store('real'), async (request) => {
      seen = request;
      return echo(request);
    })(original);
    expect(await response.text()).toBe('{"sku":"a"}');
    expect(seen).not.toBe(original);
    expect(seen?.method).toBe('POST');
    expect(seen?.headers.get('Idempotency-Key')).toBe('k1');

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"sku":"b"}'));
        controller.close();
      },
    });
    const streamed = await wrap(store('real'), echo)(post(stream));
    expect(await streamed.text()).toBe('{"sku":"b"}');
  });

  it('never calls bindRequest when the store has no extend', async () => {
    const original = post();
    let seen: Request | undefined;
    const bind = vi.fn(bindRequest);
    await wrap(
      store('none'),
      async (request) => {
        seen = request;
        return new Response('ok', { status: 201 });
      },
      bind,
    )(original);
    expect(seen).toBe(original);
    expect(bind).not.toHaveBeenCalled();
  });

  it('releases the key and rethrows when bindRequest throws', async () => {
    const s = store('real');
    let runs = 0;
    const handler = async () => {
      runs++;
      return new Response('ok', { status: 201 });
    };
    const failing = wrap(s, handler, () => {
      throw new TypeError('cannot bind');
    });
    await expect(failing(post())).rejects.toThrow('cannot bind');
    expect(runs).toBe(0);
    const response = await wrap(s, handler)(post());
    expect(response.status).toBe(201);
    expect(runs).toBe(1);
  });
});
