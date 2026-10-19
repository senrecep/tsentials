import { Err, ErrorType } from '../../src/errors/index.js';
import {
  createIdempotency,
  type IdempotencyDecisionEvent,
  IdempotencyErrorCodes,
  type IdempotencyScope,
  type IdempotencyStore,
  InMemoryIdempotencyStore,
  idempotencyBehavior,
  idempotencyScopes,
} from '../../src/idempotency/index.js';
import {
  createMediator,
  type GenericBehavior,
  type TransactionRunner,
  transactionBehavior,
} from '../../src/mediator/index.js';
import { Result } from '../../src/result/index.js';
import { createFakeDateTimeProvider } from '../../src/time/index.js';

interface Capture {
  orderId: string;
  amount: number;
  idempotencyKey?: string | undefined;
  idempotencyScope?: IdempotencyScope | undefined;
  idempotencyRetentionMs?: number;
  idempotencyLeaseMs?: number;
  transactional?: boolean;
}

type Requests = {
  Capture: { request: Capture; response: { charged: number } };
  Refund: { request: Capture; response: { charged: number } };
};

const capture = (overrides: Partial<Capture> = {}): Capture => ({
  orderId: 'o1',
  amount: 10,
  idempotencyKey: 'k1',
  idempotencyScope: idempotencyScopes.tenant('t1'),
  ...overrides,
});

function setup(
  behavior: GenericBehavior,
  handler: (req: Capture) => Result<{ charged: number }> | Promise<Result<{ charged: number }>>,
  extra: readonly GenericBehavior[] = [],
) {
  const fn = vi.fn(handler);
  const mediator = createMediator<Requests>({ behaviors: [behavior, ...extra] })
    .register('Capture', (req) => fn(req))
    .register('Refund', (req) => fn(req));
  return { mediator, fn };
}

const charge = (req: Capture) => Result.success({ charged: req.amount });

describe('idempotencyBehavior', () => {
  it('runs the handler once per key and replays the result', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore() }),
      charge,
    );
    expect(await mediator.send('Capture', capture())).toEqual(Result.success({ charged: 10 }));
    expect(await mediator.send('Capture', capture())).toEqual(Result.success({ charged: 10 }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes requests without a key through', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore() }),
      charge,
    );
    await mediator.send('Capture', capture({ idempotencyKey: undefined }));
    await mediator.send('Capture', capture({ idempotencyKey: undefined }));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('passes non-object requests through', async () => {
    const behavior = idempotencyBehavior({ store: new InMemoryIdempotencyStore() });
    const next = vi.fn(async () => Result.success(1));
    expect(await behavior(null, next, { requestName: 'X', signal: undefined })).toEqual(
      Result.success(1),
    );
    expect(await behavior('raw', next, { requestName: 'X', signal: undefined })).toEqual(
      Result.success(1),
    );
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('uses the request name as namespace', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore() }),
      charge,
    );
    await mediator.send('Capture', capture());
    await mediator.send('Refund', capture());
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honours a namespace override per request type', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({
        store: new InMemoryIdempotencyStore(),
        forRequest: { Capture: { namespace: 'payments' }, Refund: { namespace: 'payments' } },
      }),
      charge,
    );
    await mediator.send('Capture', capture());
    await mediator.send('Refund', capture());
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects a key without a scope by default', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore() }),
      charge,
    );
    const r = await mediator.send('Capture', capture({ idempotencyScope: undefined }));
    expect(Result.firstError(r)?.code).toBe(IdempotencyErrorCodes.ScopeRequired);
    expect(Result.firstError(r)?.type).toBe(ErrorType.Validation);
    expect(fn).not.toHaveBeenCalled();
  });

  it('applies unscopedKeyBehavior from the options and per request type', async () => {
    const store = new InMemoryIdempotencyStore();
    const { mediator, fn } = setup(
      idempotencyBehavior({
        store,
        unscopedKeyBehavior: 'global',
        forRequest: { Refund: { unscopedKeyBehavior: 'skip' } },
      }),
      charge,
    );
    const unscoped = capture({ idempotencyScope: undefined });
    await mediator.send('Capture', unscoped);
    await mediator.send('Capture', unscoped);
    expect(fn).toHaveBeenCalledTimes(1);
    await mediator.send('Refund', unscoped);
    await mediator.send('Refund', unscoped);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('rejects a reused key with another request', async () => {
    const { mediator } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore() }),
      charge,
    );
    await mediator.send('Capture', capture());
    const r = await mediator.send('Capture', capture({ amount: 99 }));
    expect(Result.firstError(r)?.code).toBe(IdempotencyErrorCodes.KeyReused);
  });

  it('uses the fingerprint from custom settings', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({
        store: new InMemoryIdempotencyStore(),
        settings: (req) => {
          const r = req as Capture;
          return { key: r.idempotencyKey, scope: idempotencyScopes.global, fingerprint: r.orderId };
        },
      }),
      charge,
    );
    await mediator.send('Capture', capture());
    expect(await mediator.send('Capture', capture({ amount: 99 }))).toEqual(
      Result.success({ charged: 10 }),
    );
    expect(fn).toHaveBeenCalledTimes(1);
    await mediator.send('Capture', capture({ idempotencyKey: undefined }));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rejects a concurrent request as in flight with Retry-After metadata', async () => {
    let finish: (v: Result<{ charged: number }>) => void = () => {};
    const { mediator, fn } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore(), retryAfterMs: 2_000 }),
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = mediator.send('Capture', capture());
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    const second = await mediator.send('Capture', capture());
    const error = Result.firstError(second);
    expect(error?.code).toBe(IdempotencyErrorCodes.InFlight);
    expect(error?.type).toBe(ErrorType.Conflict);
    expect(error?.metadata?.get('retryAfterMs')).toBe(2_000);
    finish(Result.success({ charged: 10 }));
    expect(await first).toEqual(Result.success({ charged: 10 }));
  });

  it('keeps the key in flight when the handler throws', async () => {
    const { mediator } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore() }),
      () => {
        throw new Error('boom');
      },
    );
    await expect(mediator.send('Capture', capture())).rejects.toThrow('boom');
    const r = await mediator.send('Capture', capture());
    expect(Result.firstError(r)?.code).toBe(IdempotencyErrorCodes.InFlight);
  });

  it('stores failures of non-transactional requests', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore() }),
      () => Result.failure(Err.conflict('Order.Closed', 'closed')),
    );
    await mediator.send('Capture', capture());
    const r = await mediator.send('Capture', capture());
    expect(Result.firstError(r)?.code).toBe('Order.Closed');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('releases failures of transactional requests so a retry runs again', async () => {
    const runner: TransactionRunner = {
      execute: async (work, shouldCommit) => {
        const result = await work(undefined);
        shouldCommit(result);
        return result;
      },
    };
    const { mediator, fn } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore() }),
      () => Result.failure(Err.conflict('Order.Closed', 'closed')),
      [transactionBehavior(runner)],
    );
    await mediator.send('Capture', capture({ transactional: true }));
    await mediator.send('Capture', capture({ transactional: true }));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('lets releaseFailures be decided by options and per request type', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({
        store: new InMemoryIdempotencyStore(),
        releaseFailures: () => true,
        forRequest: { Refund: { releaseFailures: false } },
      }),
      () => Result.failure(Err.failure('X', 'x')),
    );
    await mediator.send('Capture', capture());
    await mediator.send('Capture', capture());
    expect(fn).toHaveBeenCalledTimes(2);
    await mediator.send('Refund', capture());
    await mediator.send('Refund', capture());
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('keeps Unexpected failures for serverErrorRetentionMs only', async () => {
    const clock = createFakeDateTimeProvider(new Date('2026-01-01T00:00:00Z'));
    const { mediator, fn } = setup(
      idempotencyBehavior({
        store: new InMemoryIdempotencyStore({ clock }),
        serverErrorRetentionMs: 5_000,
      }),
      () => Result.failure(Err.unexpected('Db.Down', 'down')),
    );
    await mediator.send('Capture', capture());
    await mediator.send('Capture', capture());
    expect(fn).toHaveBeenCalledTimes(1);
    clock.advance(5_001);
    await mediator.send('Capture', capture());
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('applies request retention and lease overrides', async () => {
    const clock = createFakeDateTimeProvider(new Date('2026-01-01T00:00:00Z'));
    const { mediator, fn } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore({ clock }) }),
      charge,
    );
    const short = capture({ idempotencyRetentionMs: 2_000, idempotencyLeaseMs: 1_000 });
    await mediator.send('Capture', short);
    await mediator.send('Capture', short);
    expect(fn).toHaveBeenCalledTimes(1);
    clock.advance(2_001);
    await mediator.send('Capture', short);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws for an out-of-range request duration', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore() }),
      charge,
    );
    await expect(
      mediator.send('Capture', capture({ idempotencyRetentionMs: -1 })),
    ).rejects.toBeInstanceOf(RangeError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('throws for an invalid key', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore() }),
      charge,
    );
    await expect(mediator.send('Capture', capture({ idempotencyKey: 'a b' }))).rejects.toThrow(
      /not a valid idempotency key/,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('reads idempotencyScopes.global from the request and rejects the raw string global', async () => {
    const reserve = vi.fn<IdempotencyStore['reserve']>(async () => ({
      status: 'reserved',
      token: 't',
    }));
    const store: IdempotencyStore = {
      reserve,
      complete: async () => true,
      release: async () => true,
    };
    const { mediator, fn } = setup(idempotencyBehavior({ store }), charge);
    await mediator.send('Capture', capture({ idempotencyScope: idempotencyScopes.global }));
    expect(reserve.mock.calls[0]?.[0]).toEqual({
      namespace: 'Capture',
      scope: 'global',
      key: 'k1',
    });
    await expect(
      mediator.send('Capture', capture({ idempotencyScope: 'global' as never })),
    ).rejects.toThrow(TypeError);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects the raw string global from custom settings', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({
        store: new InMemoryIdempotencyStore(),
        settings: () => ({ key: 'k1', scope: 'global' as never }),
      }),
      charge,
    );
    await expect(mediator.send('Capture', capture())).rejects.toThrow(TypeError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('replays a request whose scope went through JSON', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore() }),
      charge,
    );
    const request = capture({ idempotencyScope: idempotencyScopes.user('42') });
    expect(await mediator.send('Capture', request)).toEqual(Result.success({ charged: 10 }));
    const queued = JSON.parse(JSON.stringify(request)) as Capture;
    expect(queued.idempotencyScope).toEqual({ kind: 'user', value: '42' });
    expect(await mediator.send('Capture', queued)).toEqual(Result.success({ charged: 10 }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps a JSON scope and a raw string apart', async () => {
    const reserve = vi.fn<IdempotencyStore['reserve']>(async () => ({
      status: 'reserved',
      token: 't',
    }));
    const store: IdempotencyStore = {
      reserve,
      complete: async () => true,
      release: async () => true,
    };
    const { mediator, fn } = setup(idempotencyBehavior({ store }), charge);
    const json = { kind: 'tenant', value: 'user:42' } as unknown as IdempotencyScope;
    await mediator.send('Capture', capture({ idempotencyScope: json }));
    expect(reserve.mock.calls[0]?.[0]).toEqual({
      namespace: 'Capture',
      scope: 'tenant:user:42',
      key: 'k1',
    });
    for (const bad of ['user:42', { kind: 'admin', value: 'x' }, 0]) {
      await expect(
        mediator.send('Capture', capture({ idempotencyScope: bad as never })),
      ).rejects.toThrow(TypeError);
    }
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects a raw string scope even when unscoped keys use the global scope', async () => {
    const reserve = vi.fn<IdempotencyStore['reserve']>();
    const store: IdempotencyStore = {
      reserve,
      complete: async () => true,
      release: async () => true,
    };
    const { mediator, fn } = setup(
      idempotencyBehavior({ store, unscopedKeyBehavior: 'global' }),
      charge,
    );
    await expect(
      mediator.send('Capture', capture({ idempotencyScope: 'user:42' as never })),
    ).rejects.toThrow(TypeError);
    expect(reserve).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  it('treats a null scope as no scope', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({ store: new InMemoryIdempotencyStore(), unscopedKeyBehavior: 'reject' }),
      charge,
    );
    const result = await mediator.send('Capture', capture({ idempotencyScope: null as never }));
    expect(result.ok ? undefined : result.errors[0]?.code).toBe(
      IdempotencyErrorCodes.ScopeRequired,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('passes a custom settings scope to the engine without reading JSON', async () => {
    const { mediator, fn } = setup(
      idempotencyBehavior({
        store: new InMemoryIdempotencyStore(),
        settings: () => ({ key: 'k1', scope: { kind: 'global' } as never }),
      }),
      charge,
    );
    await expect(mediator.send('Capture', capture())).rejects.toThrow(TypeError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('skips everything in off mode, per request type', async () => {
    const store: IdempotencyStore = {
      reserve: vi.fn(),
      complete: vi.fn(),
      release: vi.fn(),
    };
    const settings = vi.fn(() => ({ key: 'k', scope: idempotencyScopes.global }));
    const { mediator, fn } = setup(
      idempotencyBehavior({ store, settings, forRequest: { Capture: { mode: 'off' } } }),
      charge,
    );
    await mediator.send('Capture', capture());
    await mediator.send('Capture', capture());
    expect(fn).toHaveBeenCalledTimes(2);
    expect(settings).not.toHaveBeenCalled();
    expect(store.reserve).not.toHaveBeenCalled();
  });

  it('reports decisions with source mediator and the request name as target', async () => {
    const events: IdempotencyDecisionEvent[] = [];
    const { mediator } = setup(
      idempotencyBehavior({
        store: new InMemoryIdempotencyStore(),
        onDecision: (e) => events.push(e),
      }),
      charge,
    );
    await mediator.send('Capture', capture());
    await mediator.send('Capture', capture());
    expect(events.map((e) => e.decision)).toEqual(['reserved', 'stored', 'replay']);
    expect(events.every((e) => e.source === 'mediator' && e.target === 'Capture')).toBe(true);
  });

  it('passes the context signal to the store', async () => {
    const store = new InMemoryIdempotencyStore();
    const reserve = vi.spyOn(store, 'reserve');
    const { mediator } = setup(idempotencyBehavior({ store }), charge);
    const controller = new AbortController();
    await mediator.send('Capture', capture(), { signal: controller.signal });
    expect(reserve.mock.calls[0]?.[3]).toBe(controller.signal);
  });

  it('throws at setup without a store, for bad durations and unknown profiles', () => {
    expect(() => idempotencyBehavior({})).toThrow(TypeError);
    const store = new InMemoryIdempotencyStore();
    expect(() => idempotencyBehavior({ store, forRequest: { X: { leaseMs: 0 } } })).toThrow(
      RangeError,
    );
    expect(() => idempotencyBehavior({ store, profile: 'nope' })).toThrow(/unknown profile/);
  });
});

describe('createIdempotency().idempotencyBehavior', () => {
  it('inherits the defaults and applies profiles with the documented precedence', async () => {
    const clock = createFakeDateTimeProvider(new Date('2026-01-01T00:00:00Z'));
    const idem = createIdempotency({
      store: new InMemoryIdempotencyStore({ clock }),
      retentionMs: 1_000,
      profiles: {
        long: { retentionMs: 10_000 },
        observe: { mode: 'observe' },
      },
    });
    const { mediator, fn } = setup(
      idem.idempotencyBehavior({ profile: 'long', forRequest: { Refund: { retentionMs: 3_000 } } }),
      charge,
    );
    await mediator.send('Capture', capture());
    await mediator.send('Refund', capture());
    clock.advance(5_000);
    await mediator.send('Capture', capture()); // profile 'long': still replayed
    await mediator.send('Refund', capture()); // request type 3 s: expired, runs again
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('lets a request type profile replace the behavior profile', async () => {
    const idem = createIdempotency({
      store: new InMemoryIdempotencyStore(),
      profiles: { observe: { mode: 'observe' }, enforce: { mode: 'enforce' } },
    });
    const { mediator, fn } = setup(
      idem.idempotencyBehavior({
        profile: 'enforce',
        forRequest: { Capture: { profile: 'observe' } },
      }),
      charge,
    );
    await mediator.send('Capture', capture());
    await mediator.send('Capture', capture());
    expect(fn).toHaveBeenCalledTimes(2);
    await mediator.send('Refund', capture());
    await mediator.send('Refund', capture());
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('works without options', async () => {
    const idem = createIdempotency({ store: new InMemoryIdempotencyStore() });
    const { mediator, fn } = setup(idem.idempotencyBehavior(), charge);
    await mediator.send('Capture', capture());
    await mediator.send('Capture', capture());
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
