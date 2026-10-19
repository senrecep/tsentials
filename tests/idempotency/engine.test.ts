import { type IdempotencyCall, runIdempotent } from '../../src/idempotency/engine.js';
import {
  type IdempotencyDecisionEvent,
  IdempotencyErrorCodes,
  IdempotencyEventNames,
  type IdempotencyStore,
  InMemoryIdempotencyStore,
  idempotencyScopes,
} from '../../src/idempotency/index.js';
import { type IdempotencySettings, resolveSettings } from '../../src/idempotency/options.js';
import type { MediatorLogLevel } from '../../src/mediator/index.js';

interface Harness {
  events: IdempotencyDecisionEvent[];
  logs: {
    level: MediatorLogLevel;
    message: string;
    properties: Readonly<Record<string, unknown>>;
  }[];
  runs: number;
  call: (overrides?: Partial<IdempotencyCall<string>>) => IdempotencyCall<string>;
}

function harness(settings: IdempotencySettings = {}): Harness {
  const h: Harness = {
    events: [],
    logs: [],
    runs: 0,
    call: (overrides = {}) => ({
      settings: resolveSettings([
        settings,
        {
          store: new InMemoryIdempotencyStore(),
          onDecision: (e) => h.events.push(e),
          logger: {
            log: (level, message, properties) => h.logs.push({ level, message, properties }),
          },
        },
      ]),
      source: 'function',
      target: 'orders',
      namespace: 'orders',
      unscopedKeyBehavior: 'reject',
      key: () => 'k1',
      scope: () => 'tenant:1',
      fingerprint: () => 'fp',
      run: async () => `out${++h.runs}`,
      complete: (output) => ({ action: 'store', payload: output, retentionMs: 10_000 }),
      replay: (payload) => `replay:${payload}`,
      reject: (code) => `reject:${code}`,
      ...overrides,
    }),
  };
  return h;
}

const decisions = (h: Harness) => h.events.map((e) => e.decision);
const names = (h: Harness) => h.logs.map((l) => l.properties.EventName);

describe('runIdempotent: enforce', () => {
  it('runs once, stores and replays', async () => {
    const store = new InMemoryIdempotencyStore();
    const h = harness({ store });
    expect(await runIdempotent(h.call())).toBe('out1');
    expect(await runIdempotent(h.call())).toBe('replay:out1');
    expect(h.runs).toBe(1);
    expect(decisions(h)).toEqual(['reserved', 'stored', 'replay']);
    const event = h.events[0];
    expect(event).toEqual({
      name: IdempotencyEventNames.Decision,
      decision: 'reserved',
      mode: 'enforce',
      source: 'function',
      target: 'orders',
      keyHash: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    expect(h.logs).toEqual([]);
  });

  it('rejects a reused key and an in-flight key', async () => {
    const store = new InMemoryIdempotencyStore();
    const h = harness({ store });
    let release: () => void = () => undefined;
    const first = runIdempotent(
      h.call({ run: () => new Promise<string>((resolve) => (release = () => resolve('slow'))) }),
    );
    await vi.waitFor(() => expect(decisions(h)).toContain('reserved'));
    expect(await runIdempotent(h.call())).toBe(`reject:${IdempotencyErrorCodes.InFlight}`);
    expect(await runIdempotent(h.call({ fingerprint: () => 'other' }))).toBe(
      `reject:${IdempotencyErrorCodes.KeyReused}`,
    );
    release();
    expect(await first).toBe('slow');
    expect(decisions(h)).toEqual(['reserved', 'in_flight', 'key_reused', 'stored']);
  });

  it('releases and keeps', async () => {
    const store = new InMemoryIdempotencyStore();
    const h = harness({ store });
    await runIdempotent(h.call({ complete: () => ({ action: 'release' }) }));
    expect(decisions(h)).toEqual(['reserved', 'released']);
    expect(store.size).toBe(0);
    await runIdempotent(h.call({ complete: () => ({ action: 'keep' }) }));
    expect(await runIdempotent(h.call())).toBe(`reject:${IdempotencyErrorCodes.InFlight}`);
  });

  it('does not report a release that found no reservation', async () => {
    const store: IdempotencyStore = {
      reserve: async () => ({ status: 'reserved', token: 't' }),
      complete: async () => false,
      release: async () => false,
    };
    const h = harness({ store });
    expect(await runIdempotent(h.call({ complete: () => ({ action: 'release' }) }))).toBe('out1');
    expect(decisions(h)).toEqual(['reserved']);
    expect(await runIdempotent(h.call())).toBe('out2');
    expect(names(h)).toEqual([IdempotencyEventNames.ReservationLost]);
  });

  it('returns the output when writing the outcome throws', async () => {
    const h = harness();
    expect(
      await runIdempotent(
        h.call({
          complete: () => {
            throw new Error('serialize');
          },
        }),
      ),
    ).toBe('out1');
    expect(names(h)).toEqual([IdempotencyEventNames.CompleteFailed]);
    expect(h.logs[0]?.properties.Exception).toBeInstanceOf(Error);
    expect(h.logs[0]?.level).toBe('warning');
  });

  it('propagates a throwing handler and keeps the key in flight', async () => {
    const h = harness({ store: new InMemoryIdempotencyStore() });
    await expect(
      runIdempotent(h.call({ run: () => Promise.reject(new Error('boom')) })),
    ).rejects.toThrow('boom');
    expect(await runIdempotent(h.call())).toBe(`reject:${IdempotencyErrorCodes.InFlight}`);
  });

  it('rethrows a store outage', async () => {
    const store: IdempotencyStore = {
      reserve: () => Promise.reject(new Error('down')),
      complete: async () => true,
      release: async () => true,
    };
    const h = harness({ store });
    await expect(runIdempotent(h.call())).rejects.toThrow('down');
    expect(h.runs).toBe(0);
  });

  it('runs without a key and skips off mode entirely', async () => {
    const h = harness();
    const key = vi.fn(() => 'k');
    expect(await runIdempotent(h.call({ key: () => undefined }))).toBe('out1');
    const off = harness({ mode: 'off' });
    expect(await runIdempotent(off.call({ key }))).toBe('out1');
    expect(key).not.toHaveBeenCalled();
    expect(h.events).toEqual([]);
  });
});

describe('runIdempotent: unscoped keys', () => {
  it('rejects in enforce', async () => {
    const h = harness();
    expect(await runIdempotent(h.call({ scope: () => undefined }))).toBe(
      `reject:${IdempotencyErrorCodes.ScopeRequired}`,
    );
    expect(decisions(h)).toEqual(['unscoped']);
    expect(h.runs).toBe(0);
  });

  it('runs and reports in observe', async () => {
    const h = harness({ mode: 'observe' });
    expect(await runIdempotent(h.call({ scope: () => undefined }))).toBe('out1');
    expect(h.events[0]?.name).toBe(IdempotencyEventNames.WouldRejectScopeRequired);
    expect(h.logs[0]?.level).toBe('information');
  });

  it('skips with a warning', async () => {
    const h = harness();
    expect(
      await runIdempotent(h.call({ scope: () => undefined, unscopedKeyBehavior: 'skip' })),
    ).toBe('out1');
    expect(h.events[0]?.name).toBe(IdempotencyEventNames.UnscopedKeySkipped);
    expect(h.logs[0]?.level).toBe('warning');
  });

  it('uses the global scope', async () => {
    const reserve = vi.fn<IdempotencyStore['reserve']>(async () => ({
      status: 'reserved',
      token: 't',
    }));
    const h = harness({
      store: { reserve, complete: async () => true, release: async () => true },
    });
    await runIdempotent(h.call({ scope: () => undefined, unscopedKeyBehavior: 'global' }));
    expect(reserve.mock.calls[0]?.[0]).toEqual({ namespace: 'orders', scope: 'global', key: 'k1' });
  });

  it('stores idempotencyScopes.global as global and rejects the raw string global', async () => {
    const reserve = vi.fn<IdempotencyStore['reserve']>(async () => ({
      status: 'reserved',
      token: 't',
    }));
    const h = harness({
      store: { reserve, complete: async () => true, release: async () => true },
    });
    await runIdempotent(h.call({ scope: () => idempotencyScopes.global }));
    expect(reserve.mock.calls[0]?.[0]).toEqual({ namespace: 'orders', scope: 'global', key: 'k1' });
    await expect(runIdempotent(h.call({ scope: async () => 'global' }))).rejects.toThrow(TypeError);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(h.runs).toBe(1);
  });

  it('shares records between idempotencyScopes.global and unscopedKeyBehavior global', async () => {
    const h = harness({ store: new InMemoryIdempotencyStore() });
    expect(await runIdempotent(h.call({ scope: () => idempotencyScopes.global }))).toBe('out1');
    expect(
      await runIdempotent(h.call({ scope: () => undefined, unscopedKeyBehavior: 'global' })),
    ).toBe('replay:out1');
    expect(h.runs).toBe(1);
  });
});

describe('runIdempotent: observe', () => {
  it('runs every call and only reports conflicts', async () => {
    const store = new InMemoryIdempotencyStore();
    const h = harness({ store, mode: 'observe' });
    expect(await runIdempotent(h.call())).toBe('out1');
    expect(await runIdempotent(h.call())).toBe('out2');
    expect(await runIdempotent(h.call({ fingerprint: () => 'other' }))).toBe('out3');
    await runIdempotent(h.call({ key: () => 'k2', complete: () => ({ action: 'keep' }) }));
    expect(await runIdempotent(h.call({ key: () => 'k2' }))).toBe('out5');
    expect(h.events.map((e) => [e.decision, e.name])).toEqual([
      ['reserved', IdempotencyEventNames.Decision],
      ['stored', IdempotencyEventNames.Decision],
      ['replay', IdempotencyEventNames.WouldReplay],
      ['key_reused', IdempotencyEventNames.WouldRejectKeyReused],
      ['reserved', IdempotencyEventNames.Decision],
      ['in_flight', IdempotencyEventNames.WouldRejectInFlight],
    ]);
    expect(h.events.every((e) => e.mode === 'observe')).toBe(true);
  });

  it('logs a store outage and runs', async () => {
    const store: IdempotencyStore = {
      reserve: () => Promise.reject(new Error('down')),
      complete: async () => true,
      release: async () => true,
    };
    const h = harness({ store, mode: 'observe' });
    expect(await runIdempotent(h.call())).toBe('out1');
    expect(names(h)).toEqual([IdempotencyEventNames.StoreFailed]);
  });

  it.each([
    ['key', { key: () => Promise.reject(new Error('bad key')) }, false],
    [
      'scope',
      {
        scope: () => {
          throw new Error('bad scope');
        },
      },
      true,
    ],
    ['fingerprint', { fingerprint: () => Promise.reject(new Error('bad body')) }, true],
  ] as const)('runs without idempotency when the %s resolver throws', async (_name, overrides, hashed) => {
    const store = new InMemoryIdempotencyStore();
    const h = harness({ store, mode: 'observe' });
    expect(await runIdempotent(h.call(overrides))).toBe('out1');
    expect(await runIdempotent(h.call(overrides))).toBe('out2');
    expect(h.events).toEqual([]);
    expect(names(h)).toEqual([
      IdempotencyEventNames.ResolutionFailed,
      IdempotencyEventNames.ResolutionFailed,
    ]);
    expect(h.logs[0]?.level).toBe('warning');
    expect(h.logs[0]?.properties.Exception).toBeInstanceOf(Error);
    expect('KeyHash' in (h.logs[0]?.properties ?? {})).toBe(hashed);
  });

  it('rethrows a resolver error in enforce mode and after a caller abort', async () => {
    const throwing = { fingerprint: () => Promise.reject(new Error('bad body')) };
    const enforce = harness();
    await expect(runIdempotent(enforce.call(throwing))).rejects.toThrow('bad body');
    expect(enforce.runs).toBe(0);
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    const observe = harness({ mode: 'observe' });
    await expect(
      runIdempotent(
        observe.call({
          signal: controller.signal,
          key: () => Promise.reject(controller.signal.reason),
        }),
      ),
    ).rejects.toThrow('stop');
    expect(observe.runs).toBe(0);
  });

  it('runs without idempotency in observe when the scope is the raw string global', async () => {
    const reserve = vi.fn<IdempotencyStore['reserve']>();
    const h = harness({
      mode: 'observe',
      store: { reserve, complete: async () => true, release: async () => true },
    });
    expect(await runIdempotent(h.call({ scope: () => 'global' }))).toBe('out1');
    expect(reserve).not.toHaveBeenCalled();
    expect(names(h)).toEqual([IdempotencyEventNames.ResolutionFailed]);
    expect(h.logs[0]?.properties.Exception).toBeInstanceOf(TypeError);
  });

  it('runs a throwing handler once in observe, with or without a failing resolver', async () => {
    for (const resolver of [{}, { scope: () => Promise.reject(new Error('no scope')) }]) {
      const h = harness({ mode: 'observe' });
      const call = h.call({
        ...resolver,
        run: async () => {
          h.runs++;
          throw new Error('handler');
        },
      });
      await expect(runIdempotent(call)).rejects.toThrow('handler');
      expect(h.runs).toBe(1);
    }
  });

  it('rethrows a store error when the caller aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    const h = harness({ mode: 'observe' });
    await expect(runIdempotent(h.call({ signal: controller.signal }))).rejects.toThrow('stop');
  });
});

describe('runIdempotent: observers', () => {
  it('ignores a throwing onDecision and a throwing logger', async () => {
    const h = harness({
      onDecision: () => {
        throw new Error('observer');
      },
      logger: {
        log: () => {
          throw new Error('logger');
        },
      },
    });
    expect(
      await runIdempotent(h.call({ scope: () => undefined, unscopedKeyBehavior: 'skip' })),
    ).toBe('out1');
  });

  it('honours logger.isEnabled', async () => {
    const log = vi.fn();
    const h = harness({ logger: { log, isEnabled: (level) => level === 'warning' } });
    await runIdempotent(h.call({ scope: () => undefined, unscopedKeyBehavior: 'skip' }));
    expect(log).toHaveBeenCalledTimes(1);
    const quiet = harness({ mode: 'observe', logger: { log, isEnabled: () => false } });
    await runIdempotent(quiet.call({ scope: () => undefined }));
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('never reports the key itself', async () => {
    const h = harness({ mode: 'observe' });
    await runIdempotent(h.call({ key: () => 'secret-key', scope: () => undefined }));
    expect(JSON.stringify([h.events, h.logs])).not.toContain('secret-key');
    expect(h.logs[0]?.message).toContain('orders');
  });
});
