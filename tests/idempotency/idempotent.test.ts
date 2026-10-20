import { Err, ErrorType } from '../../src/errors/index.js';
import {
  createIdempotency,
  IdempotencyErrorCodes,
  InMemoryIdempotencyStore,
  idempotencyKeys,
  idempotencyScopes,
  idempotent,
} from '../../src/idempotency/index.js';
import { Result } from '../../src/result/index.js';
import { createFakeDateTimeProvider } from '../../src/time/index.js';

interface Cmd {
  orderId: string;
  tenantId?: string;
  amount: number;
}

const options = (store: InMemoryIdempotencyStore) => ({
  store,
  namespace: 'capture',
  key: (cmd: Cmd) => idempotencyKeys.for('capture', cmd.orderId),
  scope: (cmd: Cmd) => idempotencyScopes.tenant(cmd.tenantId),
});

const cmd: Cmd = { orderId: 'o1', tenantId: 't1', amount: 10 };

describe('idempotent', () => {
  it('runs once per key and replays the result', async () => {
    const fn = vi.fn((c: Cmd) => Result.success({ charged: c.amount }));
    const capture = idempotent(fn, options(new InMemoryIdempotencyStore()));
    expect(await capture(cmd)).toEqual(Result.success({ charged: 10 }));
    expect(await capture(cmd)).toEqual(Result.success({ charged: 10 }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects a reused key with other arguments', async () => {
    const capture = idempotent(
      (c: Cmd) => Result.success(c.amount),
      options(new InMemoryIdempotencyStore()),
    );
    await capture(cmd);
    const reused = await capture({ ...cmd, amount: 20 });
    expect(!reused.ok && reused.errors[0]?.code).toBe(IdempotencyErrorCodes.KeyReused);
  });

  it('uses a custom fingerprint', async () => {
    const capture = idempotent((c: Cmd) => Result.success(c.amount), {
      ...options(new InMemoryIdempotencyStore()),
      fingerprint: (c) => c.orderId,
    });
    await capture(cmd);
    expect(await capture({ ...cmd, amount: 20 })).toEqual(Result.success(10));
  });

  it('rejects an in-flight key with retryAfterMs metadata', async () => {
    let release: () => void = () => undefined;
    const fn = vi.fn(
      (_: Cmd) =>
        new Promise<Result<number>>((resolve) => {
          release = () => resolve(Result.success(1));
        }),
    );
    const capture = idempotent(fn, {
      ...options(new InMemoryIdempotencyStore()),
      retryAfterMs: 3_000,
    });
    const first = capture(cmd);
    await vi.waitFor(() => expect(fn).toHaveBeenCalled());
    const busy = await capture(cmd);
    expect(busy.ok).toBe(false);
    if (!busy.ok) {
      expect(busy.errors[0]?.code).toBe(IdempotencyErrorCodes.InFlight);
      expect(busy.errors[0]?.metadata?.get('retryAfterMs')).toBe(3_000);
    }
    release();
    expect(await first).toEqual(Result.success(1));
  });

  it('runs once and answers the other 9 same-key calls InFlight', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const fn = vi.fn(async (c: Cmd) => {
      await gate;
      return Result.success(c.amount);
    });
    const capture = idempotent(fn, options(new InMemoryIdempotencyStore()));
    let settled = 0;
    const calls = Array.from({ length: 10 }, () =>
      capture(cmd).then((r) => {
        settled += 1;
        return r;
      }),
    );
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(settled).toBe(9));
    open();
    const results = await Promise.all(calls);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const busy = results.filter((r) => !r.ok);
    expect(busy).toHaveLength(9);
    for (const r of busy) {
      expect(!r.ok && r.errors[0]?.code).toBe(IdempotencyErrorCodes.InFlight);
    }
  });

  it('rejects a key without a scope by default', async () => {
    const capture = idempotent(
      (_: Cmd) => Result.success(1),
      options(new InMemoryIdempotencyStore()),
    );
    const r = await capture({ orderId: 'o1', amount: 1 });
    expect(!r.ok && r.errors[0]?.code).toBe(IdempotencyErrorCodes.ScopeRequired);
  });

  it('treats a null scope as no scope', async () => {
    const store = new InMemoryIdempotencyStore();
    const rejected = idempotent((_: Cmd) => Result.success(1), {
      ...options(store),
      scope: () => null,
    });
    const r = await rejected({ orderId: 'o1', amount: 1 });
    expect(!r.ok && r.errors[0]?.code).toBe(IdempotencyErrorCodes.ScopeRequired);
    const fn = vi.fn((_: Cmd) => Result.success(1));
    const shared = idempotent(fn, {
      ...options(store),
      scope: async () => null,
      unscopedKeyBehavior: 'global',
    });
    await shared({ orderId: 'o1', amount: 1 });
    await shared({ orderId: 'o1', amount: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stores failures: Unexpected for the server error retention, others for retention', async () => {
    const clock = createFakeDateTimeProvider(new Date('2026-01-01T00:00:00Z'));
    const store = new InMemoryIdempotencyStore({ clock });
    let calls = 0;
    const capture = idempotent(
      (c: Cmd) => {
        calls++;
        return c.orderId === 'boom'
          ? Result.failure<number>(Err.unexpected('Pay.Down', 'down'))
          : Result.failure<number>(Err.validation('Pay.Bad', 'bad'));
      },
      { ...options(store), retentionMs: 100_000, serverErrorRetentionMs: 1_000, leaseMs: 500 },
    );
    const server = { ...cmd, orderId: 'boom' };
    await capture(server);
    await capture(cmd);
    await capture(server);
    await capture(cmd);
    expect(calls).toBe(2);
    clock.advance(1_001);
    await capture(server);
    await capture(cmd);
    expect(calls).toBe(3);
    const replayed = await capture(cmd);
    expect(!replayed.ok && replayed.errors[0]?.type).toBe(ErrorType.Validation);
  });

  it('releases failures with storeFailures: false', async () => {
    let calls = 0;
    const capture = idempotent(
      (_: Cmd) => {
        calls++;
        return Result.failure<number>(Err.failure('X', 'x'));
      },
      { ...options(new InMemoryIdempotencyStore()), storeFailures: false },
    );
    await capture(cmd);
    await capture(cmd);
    expect(calls).toBe(2);
  });

  it('runs without idempotency when the key is undefined', async () => {
    const fn = vi.fn((_: Cmd) => Result.success(1));
    const run = idempotent(fn, {
      ...options(new InMemoryIdempotencyStore()),
      key: () => undefined,
    });
    await run(cmd);
    await run(cmd);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws for the raw scope string global and accepts idempotencyScopes.global', async () => {
    const fn = vi.fn((c: Cmd) => Result.success(c.amount));
    const store = new InMemoryIdempotencyStore();
    const raw = idempotent(fn, { ...options(store), scope: (c: Cmd) => c.tenantId as never });
    await expect(raw({ ...cmd, tenantId: 'global' })).rejects.toThrow(TypeError);
    expect(fn).not.toHaveBeenCalled();
    const shared = idempotent(fn, { ...options(store), scope: () => idempotencyScopes.global });
    await shared(cmd);
    await shared(cmd);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws for an invalid key', async () => {
    const run = idempotent((_: Cmd) => Result.success(1), {
      ...options(new InMemoryIdempotencyStore()),
      key: () => 'has space',
    });
    await expect(run(cmd)).rejects.toThrow(TypeError);
  });

  it('passes the signal to the store', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const run = idempotent((_: Cmd) => Result.success(1), {
      ...options(new InMemoryIdempotencyStore()),
      signal: () => controller.signal,
    });
    await expect(run(cmd)).rejects.toThrow('cancelled');
  });

  it('throws when a stored record is not a result', async () => {
    const store = new InMemoryIdempotencyStore();
    const run = idempotent((_: Cmd) => Result.success(1), {
      ...options(store),
      serializer: { serialize: () => 'x', deserialize: () => undefined },
    });
    await run(cmd);
    await expect(run(cmd)).rejects.toThrow('not a result');
  });

  it('checks its options at setup', () => {
    expect(() =>
      idempotent((_: Cmd) => Result.success(1), {
        ...options(new InMemoryIdempotencyStore()),
        namespace: '',
      }),
    ).toThrow(TypeError);
    const { store: _store, ...withoutStore } = options(new InMemoryIdempotencyStore());
    expect(() => idempotent((_: Cmd) => Result.success(1), withoutStore)).toThrow(
      'a store is required',
    );
    expect(() =>
      idempotent((_: Cmd) => Result.success(1), {
        ...options(new InMemoryIdempotencyStore()),
        profile: 'p',
      }),
    ).toThrow(RangeError);
  });
});

describe('createIdempotency().idempotent', () => {
  it('inherits the store and applies a profile under the call settings', async () => {
    const store = new InMemoryIdempotencyStore();
    const events: string[] = [];
    const idem = createIdempotency({
      store,
      onDecision: (e) => events.push(`${e.mode}:${e.decision}`),
      profiles: { shadow: { mode: 'observe' } },
    });
    const { store: _s, ...rest } = options(store);
    const fn = vi.fn((_: Cmd) => Result.success(1));
    const shadow = idem.idempotent(fn, { ...rest, profile: 'shadow' });
    await shadow(cmd);
    await shadow(cmd);
    expect(fn).toHaveBeenCalledTimes(2);
    const enforced = idem.idempotent(fn, {
      ...rest,
      namespace: 'other',
      profile: 'shadow',
      mode: 'enforce',
    });
    await enforced(cmd);
    await enforced(cmd);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(events).toEqual([
      'observe:reserved',
      'observe:stored',
      'observe:replay',
      'enforce:reserved',
      'enforce:stored',
      'enforce:replay',
    ]);
  });
});
