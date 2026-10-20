import { type IdempotencyCall, runIdempotent } from '../../src/idempotency/engine.js';
import {
  type IdempotencyDecisionEvent,
  IdempotencyErrorCodes,
  IdempotencyEventNames,
  IdempotencyReservationLostError,
  type IdempotencyStore,
  InMemoryIdempotencyStore,
  idempotencyScopes,
} from '../../src/idempotency/index.js';
import { type IdempotencySettings, resolveSettings } from '../../src/idempotency/options.js';

const LEASE = 300; // heartbeat every 100 ms

interface Log {
  level: string;
  name: unknown;
  exception: unknown;
}

function harness(settings: IdempotencySettings) {
  const events: IdempotencyDecisionEvent[] = [];
  const logs: Log[] = [];
  const call = <O = string>(
    run: (signal?: AbortSignal) => Promise<O>,
    overrides: Partial<IdempotencyCall<O>> = {},
  ): IdempotencyCall<O> => ({
    settings: resolveSettings([
      { leaseMs: LEASE, ...settings },
      {
        onDecision: (e) => events.push(e),
        logger: {
          log: (level, _message, properties) =>
            logs.push({ level, name: properties.EventName, exception: properties.Exception }),
        },
      },
    ]),
    source: 'function',
    target: 'orders',
    namespace: 'orders',
    unscopedKeyBehavior: 'reject',
    key: () => 'k1',
    scope: () => idempotencyScopes.tenant('1'),
    fingerprint: () => 'fp',
    run,
    complete: (output) => ({ action: 'store', payload: String(output), retentionMs: 10_000 }),
    replay: (payload) => `replay:${payload}` as O,
    reject: (code) => `reject:${code}` as O,
    ...overrides,
  });
  const lostLogs = () => logs.filter((l) => l.name === IdempotencyEventNames.ReservationLost);
  return { events, logs, call, lostLogs };
}

/** An InMemory store whose `extend` can be replaced, counting the calls. */
function storeWith(extend?: IdempotencyStore['extend']) {
  const inner = new InMemoryIdempotencyStore();
  const counts = { extend: 0 };
  const store: IdempotencyStore = {
    reserve: (...args) => inner.reserve(...args),
    complete: (...args) => inner.complete(...args),
    release: (...args) => inner.release(...args),
    extend: (...args) => {
      counts.extend++;
      return extend === undefined ? inner.extend(...args) : extend(...args);
    },
  };
  return { store, inner, counts };
}

function withoutExtend(): IdempotencyStore {
  const inner = new InMemoryIdempotencyStore();
  return {
    reserve: (...args) => inner.reserve(...args),
    complete: (...args) => inner.complete(...args),
    release: (...args) => inner.release(...args),
  };
}

/**
 * Wraps a handler so a test can await its start: the key hash uses the real WebCrypto, which
 * fake timers do not advance.
 */
function started<O>(fn: (signal?: AbortSignal) => Promise<O>) {
  let markStarted: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const run = (...args: [AbortSignal?]) => {
    markStarted();
    return fn(...args);
  };
  return { run, started: promise };
}

/** A handler that waits until `finish` is called or its signal aborts. */
function gate() {
  let finish: (value: string) => void = () => undefined;
  const signals: (AbortSignal | undefined)[] = [];
  let argCount = -1;
  let markStarted: () => void = () => undefined;
  const startedPromise = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const run = (...args: [AbortSignal?]) => {
    markStarted();
    argCount = args.length;
    const signal = args[0];
    signals.push(signal);
    return new Promise<string>((resolve, reject) => {
      finish = resolve;
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
  return {
    run,
    started: startedPromise,
    signals,
    argCount: () => argCount,
    finish: (value: string) => finish(value),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runIdempotent: lease heartbeat', () => {
  it('extends every leaseMs / 3 while the handler runs, and stops after it', async () => {
    const { store, counts } = storeWith();
    const h = harness({ store });
    const g = gate();
    const result = runIdempotent(h.call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(99);
    expect(counts.extend).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(counts.extend).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(counts.extend).toBe(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(counts.extend).toBe(5);
    g.finish('done');
    expect(await result).toBe('done');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(counts.extend).toBe(5);
    expect(h.events.map((e) => e.decision)).toEqual(['reserved', 'stored']);
    expect(h.logs).toEqual([]);
  });

  it('beats at least every millisecond for a tiny lease', async () => {
    const { store, counts } = storeWith();
    const h = harness({ store, leaseMs: 2 });
    const g = gate();
    const result = runIdempotent(h.call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(3);
    expect(counts.extend).toBe(3);
    g.finish('done');
    await result;
  });

  it('keeps the key in flight past the lease while the handler runs', async () => {
    const { store } = storeWith();
    const h = harness({ store });
    const g = gate();
    const first = runIdempotent(h.call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(LEASE * 4);
    expect(await runIdempotent(h.call(async () => 'second'))).toBe(
      `reject:${IdempotencyErrorCodes.InFlight}`,
    );
    g.finish('first');
    expect(await first).toBe('first');
    expect(await runIdempotent(h.call(async () => 'third'))).toBe('replay:first');
  });

  it('lets another call take over an expired lease when the store has no extend', async () => {
    const store = withoutExtend();
    const h = harness({ store });
    const g = gate();
    const first = runIdempotent(h.call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(g.argCount()).toBe(0);
    vi.setSystemTime(Date.now() + LEASE + 1);
    expect(await runIdempotent(h.call(async () => 'second'))).toBe('second');
    g.finish('first');
    expect(await first).toBe('first');
    expect(h.lostLogs()).toHaveLength(1);
  });

  it('passes a signal to the handler only in enforce with an extend-capable store', async () => {
    const { store } = storeWith();
    const g = gate();
    const result = runIdempotent(harness({ store }).call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(0);
    expect(g.signals[0]).toBeInstanceOf(AbortSignal);
    expect(g.signals[0]?.aborted).toBe(false);
    g.finish('done');
    await result;

    const observe = gate();
    const observed = runIdempotent(harness({ store, mode: 'observe' }).call(observe.run));
    await observe.started;
    await vi.advanceTimersByTimeAsync(0);
    expect(observe.argCount()).toBe(0);
    observe.finish('done');
    await observed;
  });

  it.each([
    ['returns false', async () => false, undefined],
    [
      'throws',
      async () => {
        throw new Error('store down');
      },
      'store down',
    ],
  ])('aborts the handler in enforce when extend %s', async (_name, extend, cause) => {
    const { store, counts } = storeWith(extend);
    const h = harness({ store });
    const g = gate();
    const result = runIdempotent(h.call(g.run));
    await g.started;
    const rejected = expect(result).rejects.toBeInstanceOf(IdempotencyReservationLostError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    const reason = g.signals[0]?.reason as IdempotencyReservationLostError;
    expect(reason.name).toBe('ReservationLost');
    expect((reason.cause as Error | undefined)?.message).toBe(cause);
    expect(h.lostLogs()).toEqual([
      {
        level: 'warning',
        name: IdempotencyEventNames.ReservationLost,
        exception: cause === undefined ? undefined : reason.cause,
      },
    ]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(counts.extend).toBe(1);
  });

  it('logs a lost lease once even when complete is then refused', async () => {
    const untilAbort = (signal?: AbortSignal) =>
      new Promise<string>((resolve) =>
        signal?.addEventListener('abort', () => resolve('partial'), { once: true }),
      );
    const { store } = storeWith(async () => false);
    const h = harness({ store });
    const first = started(untilAbort);
    const result = runIdempotent(
      h.call(first.run, {
        complete: () => ({ action: 'store', payload: 'p', retentionMs: 10 }),
      }),
    );
    await first.started;
    await vi.advanceTimersByTimeAsync(100);
    // The handler returned after the abort; the in-memory record still holds the token.
    expect(await result).toBe('partial');
    expect(h.lostLogs()).toHaveLength(1);
    expect(h.events.map((e) => e.decision)).toEqual(['reserved', 'stored']);

    const refused = storeWith(async () => false);
    refused.store.complete = async () => false;
    const h2 = harness({ store: refused.store });
    const next = started(untilAbort);
    const second = runIdempotent(h2.call(next.run));
    await next.started;
    await vi.advanceTimersByTimeAsync(100);
    expect(await second).toBe('partial');
    expect(h2.lostLogs()).toHaveLength(1);
  });

  it('still logs ReservationLost when complete is refused without a lost heartbeat', async () => {
    const { store } = storeWith();
    store.complete = async () => false;
    const h = harness({ store });
    expect(await runIdempotent(h.call(async () => 'done'))).toBe('done');
    expect(h.lostLogs()).toHaveLength(1);
  });

  it('only logs in observe when extend fails, and keeps the handler running', async () => {
    const { store, counts } = storeWith(async () => false);
    const h = harness({ store, mode: 'observe' });
    const g = gate();
    const result = runIdempotent(h.call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(500);
    expect(counts.extend).toBe(1);
    expect(h.lostLogs()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    g.finish('done');
    expect(await result).toBe('done');
    expect(h.events.map((e) => e.decision)).toEqual(['reserved', 'stored']);
  });

  it('leaves no timer after a throwing handler', async () => {
    const { store } = storeWith();
    const h = harness({ store });
    const handler = started(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      throw new Error('boom');
    });
    const result = runIdempotent(h.call(handler.run));
    const rejected = expect(result).rejects.toThrow('boom');
    await handler.started;
    await vi.advanceTimersByTimeAsync(150);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops on a caller abort and passes the caller reason through the combined signal', async () => {
    const { store, counts } = storeWith();
    const h = harness({ store });
    const controller = new AbortController();
    const g = gate();
    const result = runIdempotent(h.call(g.run, { signal: controller.signal }));
    await g.started;
    const rejected = expect(result).rejects.toBe('stop');
    await vi.advanceTimersByTimeAsync(150);
    expect(counts.extend).toBe(1);
    controller.abort('stop');
    expect(vi.getTimerCount()).toBe(0);
    await rejected;
    expect(g.signals[0]?.reason).toBe('stop');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(counts.extend).toBe(1);
    expect(h.lostLogs()).toEqual([]);
  });

  it('never starts beating when the caller aborted between reserve and run', async () => {
    const { store, counts } = storeWith();
    const controller = new AbortController();
    const h = harness({ store });
    const call = h.call(async (signal) => (signal?.aborted === true ? 'saw abort' : 'ran'), {
      signal: controller.signal,
    });
    const aborting = {
      ...call,
      settings: resolveSettings([
        { store, leaseMs: LEASE },
        { onDecision: (e) => e.decision === 'reserved' && controller.abort('late') },
      ]),
    };
    expect(await runIdempotent(aborting)).toBe('saw abort');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(counts.extend).toBe(0);
  });

  it('ignores an extend result that arrives after the handler settled', async () => {
    let settleExtend: (value: boolean) => void = () => undefined;
    let failExtend: (error: unknown) => void = () => undefined;
    const { store } = storeWith(
      () =>
        new Promise<boolean>((resolve, reject) => {
          settleExtend = resolve;
          failExtend = reject;
        }),
    );
    const h = harness({ store });
    const g = gate();
    const result = runIdempotent(h.call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(100);
    g.finish('done');
    expect(await result).toBe('done');
    settleExtend(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(g.signals[0]?.aborted).toBe(false);

    const g2 = gate();
    const second = runIdempotent(harness({ store }).call(g2.run, { key: () => 'k2' }));
    await g2.started;
    await vi.advanceTimersByTimeAsync(100);
    g2.finish('done');
    await second;
    failExtend(new Error('late'));
    await vi.advanceTimersByTimeAsync(0);
    expect(g2.signals[0]?.aborted).toBe(false);
    expect(h.lostLogs()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never runs two extends at once against a slow store', async () => {
    let active = 0;
    let maxActive = 0;
    const { store, counts } = storeWith(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 250));
      active--;
      return true;
    });
    const g = gate();
    const result = runIdempotent(harness({ store }).call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(maxActive).toBe(1);
    expect(counts.extend).toBe(3); // beats at 100, 450, 800
    g.finish('done');
    await result;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('works when timers have no unref', async () => {
    const real = globalThis.setTimeout;
    const spy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((fn: () => void, ms?: number) =>
        Number(real(fn, ms))) as unknown as typeof setTimeout);
    try {
      const { store, counts } = storeWith();
      const g = gate();
      const result = runIdempotent(harness({ store }).call(g.run));
      await g.started;
      await vi.advanceTimersByTimeAsync(100);
      expect(counts.extend).toBe(1);
      g.finish('done');
      await result;
    } finally {
      spy.mockRestore();
    }
  });
});
