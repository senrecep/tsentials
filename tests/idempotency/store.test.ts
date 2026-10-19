import {
  describeIdempotencyStoreContract,
  IDEMPOTENCY_STORAGE_PREFIX,
  InMemoryIdempotencyStore,
  idempotencyStorageKey,
} from '../../src/idempotency/index.js';
import { createFakeDateTimeProvider } from '../../src/time/index.js';

describeIdempotencyStoreContract(
  'InMemoryIdempotencyStore',
  (clock) => new InMemoryIdempotencyStore({ clock }),
  { describe, it },
);

describeIdempotencyStoreContract(
  'InMemoryIdempotencyStore with custom options',
  (clock) => new InMemoryIdempotencyStore({ clock, sweepIntervalMs: 1 }),
  { describe, it },
  { leaseMs: 50, retentionMs: 500, parallelism: 5, advance: (ms, clock) => clock.advance(ms) },
);

const key = { namespace: 'orders', scope: 'tenant:1', key: 'k' };

describe('idempotencyStorageKey', () => {
  it('length-prefixes each part with its UTF-8 byte length', () => {
    expect(idempotencyStorageKey(key)).toBe('idem:v3:6:orders|8:tenant:1|1:k');
    expect(idempotencyStorageKey({ ...key, key: 'é' })).toBe('idem:v3:6:orders|8:tenant:1|2:é');
    expect(idempotencyStorageKey(key, 'app:')).toBe('app:6:orders|8:tenant:1|1:k');
    expect(IDEMPOTENCY_STORAGE_PREFIX).toBe('idem:v3:');
  });

  it('keeps shifted separators apart', () => {
    expect(idempotencyStorageKey({ namespace: 'a|1:b', scope: 'c', key: 'd' })).not.toBe(
      idempotencyStorageKey({ namespace: 'a', scope: 'b|1:c', key: 'd' }),
    );
  });
});

describe('InMemoryIdempotencyStore', () => {
  it('uses crypto.randomUUID tokens and the system clock by default', async () => {
    const store = new InMemoryIdempotencyStore();
    const r = await store.reserve(key, 'fp', 1_000);
    expect(r.status === 'reserved' && r.token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses the token factory', async () => {
    const store = new InMemoryIdempotencyStore({ tokenFactory: () => 'fixed' });
    expect(await store.reserve(key, 'fp', 1_000)).toEqual({ status: 'reserved', token: 'fixed' });
  });

  it('sweeps expired records on the sweep interval', async () => {
    const clock = createFakeDateTimeProvider(new Date('2026-01-01T00:00:00Z'));
    const store = new InMemoryIdempotencyStore({ clock, sweepIntervalMs: 1_000 });
    await store.reserve(key, 'fp', 100);
    await store.reserve({ ...key, key: 'other' }, 'fp', 5_000);
    expect(store.size).toBe(2);
    clock.advance(500);
    await store.reserve({ ...key, key: 'third' }, 'fp', 5_000);
    expect(store.size).toBe(3);
    clock.advance(600);
    await store.reserve({ ...key, key: 'third' }, 'fp', 5_000);
    expect(store.size).toBe(2);
  });

  it('completes a record that is gone (swept after its lease)', async () => {
    const store = new InMemoryIdempotencyStore({ tokenFactory: () => 't' });
    expect(await store.complete(key, 't', 'fp', 'p', 1_000)).toBe(true);
    expect(await store.reserve(key, 'fp', 1_000)).toEqual({ status: 'completed', payload: 'p' });
  });

  it('rejects non-finite durations', async () => {
    const store = new InMemoryIdempotencyStore();
    await expect(store.reserve(key, 'fp', Number.POSITIVE_INFINITY)).rejects.toThrow(RangeError);
    await expect(store.reserve(key, 'fp', Number.NaN)).rejects.toThrow(RangeError);
  });
});
