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
import {
  type IdempotencySettings,
  MAX_LEASE_MS,
  resolveSettings,
} from '../../src/idempotency/options.js';

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

  it('answers ReservationLost and releases the key when extend returns false', async () => {
    const { store, counts } = storeWith(async () => false);
    const h = harness({ store });
    const g = gate();
    const result = runIdempotent(h.call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe(`reject:${IdempotencyErrorCodes.ReservationLost}`);
    const reason = g.signals[0]?.reason as IdempotencyReservationLostError;
    expect(reason).toBeInstanceOf(IdempotencyReservationLostError);
    expect(reason.name).toBe('ReservationLost');
    expect(reason.cause).toBeUndefined();
    expect(h.lostLogs()).toEqual([
      { level: 'warning', name: IdempotencyEventNames.ReservationLost, exception: undefined },
    ]);
    expect(h.events.map((e) => e.decision)).toEqual(['reserved', 'released']);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(counts.extend).toBe(1);
    // Released: a retry runs again.
    expect(await runIdempotent(h.call(async () => 'retry'))).toBe('retry');
  });

  it('retries after a single thrown extend without aborting the handler', async () => {
    let calls = 0;
    const inner = new InMemoryIdempotencyStore();
    const { store, counts } = storeWith(async (...args) => {
      if (++calls === 1) throw new Error('blip');
      return inner.extend(...args);
    });
    // The wrapped store shares its records with `inner`.
    store.reserve = (...args) => inner.reserve(...args);
    store.complete = (...args) => inner.complete(...args);
    const h = harness({ store });
    const g = gate();
    const result = runIdempotent(h.call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(LEASE * 3);
    expect(counts.extend).toBe(9);
    expect(g.signals[0]?.aborted).toBe(false);
    g.finish('done');
    expect(await result).toBe('done');
    expect(h.lostLogs()).toEqual([]);
    expect(h.events.map((e) => e.decision)).toEqual(['reserved', 'stored']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('loses the lease at the deadline when extend keeps throwing', async () => {
    const { store, counts } = storeWith(async () => {
      throw new Error('store down');
    });
    const h = harness({ store });
    const g = gate();
    const result = runIdempotent(h.call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(LEASE - 1);
    expect(g.signals[0]?.aborted).toBe(false);
    expect(counts.extend).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(`reject:${IdempotencyErrorCodes.ReservationLost}`);
    const reason = g.signals[0]?.reason as IdempotencyReservationLostError;
    expect((reason.cause as Error).message).toBe('store down');
    expect(h.lostLogs()).toEqual([
      { level: 'warning', name: IdempotencyEventNames.ReservationLost, exception: reason.cause },
    ]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(counts.extend).toBe(2);
  });

  it('aborts a hung extend and the handler at the deadline', async () => {
    const extendSignals: (AbortSignal | undefined)[] = [];
    const { store, counts } = storeWith(
      (_key, _token, _lease, signal) =>
        new Promise<boolean>((_resolve, reject) => {
          extendSignals.push(signal);
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const h = harness({ store });
    const g = gate();
    const result = runIdempotent(h.call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(LEASE - 1);
    expect(counts.extend).toBe(1);
    expect(extendSignals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(extendSignals[0]?.aborted).toBe(true);
    expect(await result).toBe(`reject:${IdempotencyErrorCodes.ReservationLost}`);
    expect(h.lostLogs()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an extend in flight when the handler settles', async () => {
    const extendSignals: (AbortSignal | undefined)[] = [];
    const { store } = storeWith(
      (_key, _token, _lease, signal) =>
        new Promise<boolean>((_resolve, reject) => {
          extendSignals.push(signal);
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const h = harness({ store });
    const g = gate();
    const result = runIdempotent(h.call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(150);
    g.finish('done');
    expect(await result).toBe('done');
    expect(extendSignals[0]?.aborted).toBe(true);
    expect(h.lostLogs()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['enforce', `reject:${IdempotencyErrorCodes.ReservationLost}`, true],
    ['observe', 'done', false],
  ] as const)('stops extending at MAX_LEASE_MS in %s', async (mode, expected, aborts) => {
    const { store, counts } = storeWith(async () => true);
    const h = harness({ store, mode, leaseMs: 90_000 });
    const g = gate();
    const result = runIdempotent(h.call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(MAX_LEASE_MS - 1);
    expect(counts.extend).toBe(29);
    expect(h.logs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.logs).toEqual([
      { level: 'warning', name: IdempotencyEventNames.LeaseLimitReached, exception: undefined },
    ]);
    expect(vi.getTimerCount()).toBe(0);
    if (!aborts) g.finish('done');
    expect(await result).toBe(expected);
    if (aborts) {
      const reason = g.signals[0]?.reason as IdempotencyReservationLostError;
      expect(reason).toBeInstanceOf(IdempotencyReservationLostError);
      expect(reason.cause).toBeInstanceOf(RangeError);
    }
    await vi.advanceTimersByTimeAsync(100_000);
    expect(counts.extend).toBe(29);
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

  it('keeps beating after a caller abort and passes the caller reason through', async () => {
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
    await rejected;
    expect(g.signals[0]?.reason).toBe('stop');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(counts.extend).toBe(1);
    expect(h.lostLogs()).toEqual([]);
  });

  it('holds the key while a handler that ignores the caller abort keeps running', async () => {
    const { store } = storeWith();
    const h = harness({ store });
    const controller = new AbortController();
    let runs = 0;
    let finish: (value: string) => void = () => undefined;
    const first = started(() => {
      runs++;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    const result = runIdempotent(h.call(first.run, { signal: controller.signal }));
    await first.started;
    controller.abort('gone');
    await vi.advanceTimersByTimeAsync(LEASE * 4);
    const second = await runIdempotent(
      h.call(async () => {
        runs++;
        return 'second';
      }),
    );
    expect(second).toBe(`reject:${IdempotencyErrorCodes.InFlight}`);
    expect(runs).toBe(1);
    finish('first');
    expect(await result).toBe('first');
    expect(h.lostLogs()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts beating even when the caller aborted between reserve and run', async () => {
    const { store } = storeWith();
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
  });

  it('does not convert a handler error after a lost lease when the caller aborted', async () => {
    const { store } = storeWith(async () => false);
    const h = harness({ store });
    const controller = new AbortController();
    const handler = started(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => setTimeout(() => reject(new Error('after both')), 50),
            { once: true },
          );
        }),
    );
    const result = runIdempotent(h.call(handler.run, { signal: controller.signal }));
    await handler.started;
    const rejected = expect(result).rejects.toThrow('after both');
    await vi.advanceTimersByTimeAsync(100);
    controller.abort('caller');
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(h.events.map((e) => e.decision)).toEqual(['reserved']);
  });

  it('rethrows an unrelated handler error after a lost lease, logging the loss once', async () => {
    const { store } = storeWith(async () => false);
    const h = harness({ store });
    const handler = started(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('wrapped')), { once: true });
        }),
    );
    const result = runIdempotent(h.call(handler.run));
    const rejected = expect(result).rejects.toThrow('wrapped');
    await handler.started;
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(h.events.map((e) => e.decision)).toEqual(['reserved']);
    expect(h.lostLogs()).toHaveLength(1);
  });

  it('converts an abort-like handler error after a lost lease', async () => {
    const { store } = storeWith(async () => false);
    const h = harness({ store });
    const handler = started(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('stopped', 'AbortError')),
            { once: true },
          );
        }),
    );
    const result = runIdempotent(h.call(handler.run));
    await handler.started;
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe(`reject:${IdempotencyErrorCodes.ReservationLost}`);
    expect(h.events.map((e) => e.decision)).toEqual(['reserved', 'released']);
    expect(h.lostLogs()).toHaveLength(1);
  });

  it.each([
    ['the lease reason', (signal: AbortSignal) => signal.reason],
    ['an abort-like error', () => new DOMException('stopped', 'AbortError')],
  ] as const)('rejects with the caller reason when the caller aborts after a lost lease (%s)', async (_name, errorOf) => {
    const { store } = storeWith(async () => false);
    const h = harness({ store });
    const controller = new AbortController();
    let lease: AbortSignal | undefined;
    let fail: () => void = () => undefined;
    const handler = started(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          lease = signal;
          fail = () => reject(errorOf(signal!));
        }),
    );
    const result = runIdempotent(h.call(handler.run, { signal: controller.signal }));
    const rejected = expect(result).rejects.toBe('caller');
    await handler.started;
    await vi.advanceTimersByTimeAsync(100);
    expect(lease?.reason).toBeInstanceOf(IdempotencyReservationLostError);
    controller.abort('caller');
    // The combined signal keeps the lease reason; the engine still answers with the caller's.
    expect(lease?.reason).toBeInstanceOf(IdempotencyReservationLostError);
    fail();
    await rejected;
    expect(h.events.map((e) => e.decision)).toEqual(['reserved']);
  });

  it.each([
    ['enforce', ['reserved', 'released']],
    ['observe', ['reserved', 'stored']],
  ] as const)('after a lost lease a failure output is released in enforce only (%s)', async (mode, decisions) => {
    const { store } = storeWith(async () => false);
    const h = harness({ store, mode });
    const handler = started(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return 'failed';
    });
    const result = runIdempotent(
      h.call(handler.run, {
        complete: (output) => ({
          action: 'store',
          payload: output,
          retentionMs: 10,
          failure: true,
        }),
      }),
    );
    await handler.started;
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toBe('failed');
    expect(h.events.map((e) => e.decision)).toEqual(decisions);
    expect(h.lostLogs()).toHaveLength(1);
  });

  it('stores a success output after a lost lease (token-fenced)', async () => {
    const { store } = storeWith(async () => false);
    const h = harness({ store });
    const handler = started(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return 'done';
    });
    const result = runIdempotent(
      h.call(handler.run, {
        complete: (output) => ({
          action: 'store',
          payload: output,
          retentionMs: 10,
          failure: false,
        }),
      }),
    );
    await handler.started;
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toBe('done');
    expect(h.events.map((e) => e.decision)).toEqual(['reserved', 'stored']);
  });

  it('rethrows a handler error after a lost lease in observe', async () => {
    const { store } = storeWith(async () => false);
    const h = harness({ store, mode: 'observe' });
    const handler = started(
      () =>
        new Promise<string>((_resolve, reject) => {
          setTimeout(() => reject(new Error('late failure')), 200);
        }),
    );
    const result = runIdempotent(h.call(handler.run));
    const rejected = expect(result).rejects.toThrow('late failure');
    await handler.started;
    await vi.advanceTimersByTimeAsync(200);
    await rejected;
  });

  it('ignores a failing release after a lost lease', async () => {
    const { store } = storeWith(async () => false);
    store.release = async () => {
      throw new Error('release down');
    };
    const h = harness({ store });
    const g = gate();
    const result = runIdempotent(h.call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe(`reject:${IdempotencyErrorCodes.ReservationLost}`);
    expect(h.events.map((e) => e.decision)).toEqual(['reserved']);
  });

  it('releases the reservation when the handler setup throws', async () => {
    const { store, inner } = storeWith();
    const h = harness({ store });
    const run = () => {
      throw new TypeError('bind failed');
    };
    await expect(runIdempotent(h.call(run))).rejects.toThrow('bind failed');
    expect(h.events.map((e) => e.decision)).toEqual(['reserved', 'released']);
    expect(vi.getTimerCount()).toBe(0);
    expect(await runIdempotent(harness({ store: inner }).call(async () => 'again'))).toBe('again');
  });

  it('releases the reservation when the caller signal cannot be combined', async () => {
    const { store } = storeWith();
    // A store that ignores the signal, so only `AbortSignal.any` sees the foreign object.
    const inner = new InMemoryIdempotencyStore();
    store.reserve = (key, fingerprint, leaseMs) => inner.reserve(key, fingerprint, leaseMs);
    store.release = (...args) => inner.release(...args);
    const h = harness({ store });
    // Node versions differ on whether `AbortSignal.any` rejects a foreign object, so force the throw.
    const any = vi.spyOn(AbortSignal, 'any').mockImplementation(() => {
      throw new TypeError('not an AbortSignal');
    });
    const foreign = { aborted: false } as AbortSignal;
    let ran = false;
    await expect(
      runIdempotent(
        h.call(
          async () => {
            ran = true;
            return 'x';
          },
          { signal: foreign },
        ),
      ),
    ).rejects.toThrow(TypeError);
    any.mockRestore();
    expect(ran).toBe(false);
    expect(h.events.map((e) => e.decision)).toEqual(['reserved', 'released']);
    expect(vi.getTimerCount()).toBe(0);
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
      await new Promise((resolve) => setTimeout(resolve, 80));
      active--;
      return true;
    });
    const g = gate();
    const result = runIdempotent(harness({ store }).call(g.run));
    await g.started;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(maxActive).toBe(1);
    expect(counts.extend).toBe(6); // beats at 100, 280, 460, 640, 820, 1000
    expect(g.signals[0]?.aborted).toBe(false);
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
