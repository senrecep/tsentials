import { describe, it } from 'vitest';
import {
  type ContractClock,
  describeIdempotencyStoreContract,
  IDEMPOTENCY_STORAGE_PREFIX,
  RedisIdempotencyScripts,
  RedisIdempotencyStore,
  type RedisLike,
} from '../../src/idempotency/index.js';

interface Hash {
  fields: Map<string, string>;
  expiresAt: number;
}

/** Runs the three scripts in JavaScript over hashes with a TTL; the Lua itself runs in examples/. */
function fakeRedis(clock: ContractClock) {
  const data = new Map<string, Hash>();
  const calls: { script: string; keys: string[]; args: string[] }[] = [];
  const live = (key: string) => {
    const hash = data.get(key);
    if (hash !== undefined && hash.expiresAt <= clock.utcNowMs()) data.delete(key);
    return data.get(key)?.fields;
  };
  const write = (key: string, fields: Record<string, string>, ttl: string) => {
    const existing = live(key) ?? new Map<string, string>();
    for (const [field, value] of Object.entries(fields)) existing.set(field, value);
    data.set(key, { fields: existing, expiresAt: clock.utcNowMs() + Number(ttl) });
  };
  const redis: RedisLike = {
    eval: async (script, keys, args) => {
      calls.push({ script, keys, args });
      const key = keys[0]!;
      const h = live(key);
      if (script === RedisIdempotencyScripts.reserve) {
        const [fingerprint, lease, token] = args as [string, string, string];
        if (h !== undefined) {
          if (h.get('f') !== fingerprint) return ['mismatch'];
          const payload = h.get('p');
          return payload !== undefined ? ['completed', payload] : ['inFlight'];
        }
        write(key, { t: token, f: fingerprint }, lease);
        return ['reserved'];
      }
      if (script === RedisIdempotencyScripts.complete) {
        const [token, fingerprint, payload, retention] = args as [string, string, string, string];
        if (h !== undefined && (h.has('p') || h.get('t') !== token)) return 0;
        write(key, { t: token, f: fingerprint, p: payload }, retention);
        return 1;
      }
      if (h?.get('t') === args[0] && !h.has('p')) {
        data.delete(key);
        return 1;
      }
      return 0;
    },
  };
  return { redis, calls };
}

describeIdempotencyStoreContract(
  'RedisIdempotencyStore',
  (clock) => new RedisIdempotencyStore(fakeRedis(clock).redis),
  { describe, it },
);

const recordKey = { namespace: 'orders', scope: 'tenant:1', key: 'k' };

function storeWith(reply: unknown) {
  return new RedisIdempotencyStore({ eval: async () => reply });
}

describe('RedisIdempotencyStore', () => {
  it('sends one script per call with the storage key, rounded TTLs and a fresh token', async () => {
    const { redis, calls } = fakeRedis({ utcNowMs: () => 0 } as unknown as ContractClock);
    const store = new RedisIdempotencyStore(redis, { tokenFactory: () => 'tok' });
    expect(await store.reserve(recordKey, 'fp', 1000.2)).toEqual({
      status: 'reserved',
      token: 'tok',
    });
    expect(await store.complete(recordKey, 'tok', 'fp', 'payload', 500.5)).toBe(true);
    expect(calls).toEqual([
      {
        script: RedisIdempotencyScripts.reserve,
        keys: [`${IDEMPOTENCY_STORAGE_PREFIX}6:orders|8:tenant:1|1:k`],
        args: ['fp', '1001', 'tok'],
      },
      {
        script: RedisIdempotencyScripts.complete,
        keys: [`${IDEMPOTENCY_STORAGE_PREFIX}6:orders|8:tenant:1|1:k`],
        args: ['tok', 'fp', 'payload', '501'],
      },
    ]);
  });

  it('uses a custom key prefix', async () => {
    const { redis, calls } = fakeRedis({ utcNowMs: () => 0 } as unknown as ContractClock);
    await new RedisIdempotencyStore(redis, { prefix: 'app:' }).release(recordKey, 't');
    expect(calls[0]?.keys).toEqual(['app:6:orders|8:tenant:1|1:k']);
  });

  it('reads replies given as buffers and bigints', async () => {
    const bytes = (s: string) => new TextEncoder().encode(s);
    expect(await storeWith([bytes('completed'), bytes('p')]).reserve(recordKey, 'fp', 1)).toEqual({
      status: 'completed',
      payload: 'p',
    });
    expect(await storeWith([bytes('inFlight')]).reserve(recordKey, 'fp', 1)).toEqual({
      status: 'inFlight',
    });
    expect(await storeWith(1n).release(recordKey, 't')).toBe(true);
    expect(await storeWith(0).complete(recordKey, 't', 'fp', 'p', 1)).toBe(false);
  });

  it.each([
    ['not an array', 'OK'],
    ['an unknown status', ['nope']],
    ['completed without a payload', ['completed']],
    ['a non-text status', [42]],
  ])('throws on a reserve reply that is %s', async (_name, reply) => {
    await expect(storeWith(reply).reserve(recordKey, 'fp', 1)).rejects.toThrow(
      /unexpected reserve reply/,
    );
  });

  it.each([null, '1', 2])('throws on a complete or release reply %j', async (reply) => {
    await expect(storeWith(reply).complete(recordKey, 't', 'fp', 'p', 1)).rejects.toThrow(
      /unexpected complete reply/,
    );
    await expect(storeWith(reply).release(recordKey, 't')).rejects.toThrow(
      /unexpected release reply/,
    );
  });

  it('checks the arguments before calling Redis', async () => {
    let called = false;
    const store = new RedisIdempotencyStore({
      eval: async () => {
        called = true;
        return 0;
      },
    });
    await expect(store.reserve(recordKey, 'fp', Number.NaN)).rejects.toThrow(RangeError);
    await expect(store.release(recordKey, '')).rejects.toThrow(TypeError);
    expect(called).toBe(false);
  });
});
