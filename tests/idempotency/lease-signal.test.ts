import {
  IdempotencyErrorCodes,
  type IdempotencyStore,
  InMemoryIdempotencyStore,
  idempotencyBehavior,
  idempotencyKeys,
  idempotencyScopes,
  idempotent,
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
  const wrap = (s: IdempotencyStore, handler: (request: Request) => Promise<Response>) =>
    withIdempotency(handler, {
      store: s,
      leaseMs: leaseOf(s),
      scope: () => idempotencyScopes.tenant('1'),
    });

  it('gives the handler a request whose signal aborts when the lease is lost', async () => {
    const handler = wrap(
      store('lost'),
      async (request) => new Response(reasonName(await aborted(request.signal))),
    );
    expect(await (await handler(post())).text()).toBe('ReservationLost');
  });

  it('propagates the caller abort to the rebound request', async () => {
    const controller = new AbortController();
    const handler = wrap(store('real'), async (request) => {
      queueMicrotask(() => controller.abort('caller'));
      return new Response(String(await aborted(request.signal)));
    });
    expect(await (await handler(post(undefined, controller.signal))).text()).toBe('caller');
  });

  it('keeps the body readable after the rebind, for a string and a streamed body', async () => {
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

  it('passes the original request when the store has no extend', async () => {
    const original = post();
    let seen: Request | undefined;
    await wrap(store('none'), async (request) => {
      seen = request;
      return new Response('ok', { status: 201 });
    })(original);
    expect(seen).toBe(original);
  });

  it('keeps a Request subclass, and falls back to Request when it cannot be rebuilt', async () => {
    class Tagged extends Request {}
    let rebuilt = 0;
    class Strict extends Request {
      constructor(input: RequestInfo, init?: RequestInit) {
        if (rebuilt++ > 0) throw new TypeError('not rebuildable');
        super(input, init);
      }
    }
    const classes: string[] = [];
    const handler = wrap(store('real'), async (request) => {
      classes.push(request.constructor.name);
      return new Response(await request.text(), { status: 201 });
    });
    const tagged = new Tagged(post());
    expect(await (await handler(tagged)).text()).toBe('{"sku":"a"}');
    const strict = new Strict(post(), { headers: { 'Idempotency-Key': 'k2' } });
    expect(await (await handler(strict)).text()).toBe('{"sku":"a"}');
    expect(classes).toEqual(['Tagged', 'Request']);
  });
});
