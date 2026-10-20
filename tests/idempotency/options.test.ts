import {
  createIdempotency,
  DEFAULT_LEASE_MS,
  DEFAULT_RETENTION_MS,
  DEFAULT_RETRY_AFTER_MS,
  DEFAULT_SERVER_ERROR_RETENTION_MS,
  InMemoryIdempotencyStore,
  MAX_LEASE_MS,
} from '../../src/idempotency/index.js';
import { profileOf, resolveSettings } from '../../src/idempotency/options.js';

const store = new InMemoryIdempotencyStore();

describe('resolveSettings', () => {
  it('applies the defaults', () => {
    const s = resolveSettings([{ store }]);
    expect(s.store).toBe(store);
    expect(s.mode()).toBe('enforce');
    expect(s.leaseMs).toBe(DEFAULT_LEASE_MS);
    expect(s.retentionMs).toBe(DEFAULT_RETENTION_MS);
    expect(s.serverErrorRetentionMs).toBe(DEFAULT_SERVER_ERROR_RETENTION_MS);
    expect(s.retryAfterMs).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(s.onDecision).toBeUndefined();
    expect(s.logger).toBeUndefined();
  });

  it('takes the first defined value, most specific layer first', () => {
    const onDecision = () => undefined;
    const s = resolveSettings([
      { leaseMs: 1_000 },
      undefined,
      { store, leaseMs: 2_000, retentionMs: 50_000, onDecision },
    ]);
    expect(s.leaseMs).toBe(1_000);
    expect(s.retentionMs).toBe(50_000);
    expect(s.onDecision).toBe(onDecision);
  });

  it('clamps the default lease and server error retention to a short retention', () => {
    const s = resolveSettings([{ store, retentionMs: 30_000 }]);
    expect(s.leaseMs).toBe(30_000);
    expect(s.serverErrorRetentionMs).toBe(30_000);
  });

  it('reads a mode function on every call', () => {
    let mode: 'off' | 'observe' = 'off';
    const s = resolveSettings([{ store, mode: () => mode }]);
    expect(s.mode()).toBe('off');
    mode = 'observe';
    expect(s.mode()).toBe('observe');
    expect(resolveSettings([{ store, mode: 'observe' }]).mode()).toBe('observe');
  });

  it('keeps retryAfterMs null', () => {
    expect(
      resolveSettings([{ retryAfterMs: null }, { store, retryAfterMs: 5 }]).retryAfterMs,
    ).toBeNull();
  });

  it('requires a store', () => {
    expect(() => resolveSettings([{}])).toThrow(TypeError);
  });

  it.each([
    [{ leaseMs: 0 }, 'leaseMs'],
    [{ retentionMs: -1 }, 'retentionMs'],
    [{ serverErrorRetentionMs: Number.NaN }, 'serverErrorRetentionMs'],
    [{ retryAfterMs: Number.POSITIVE_INFINITY }, 'retryAfterMs'],
    [{ leaseMs: MAX_LEASE_MS + 1 }, 'leaseMs'],
    [{ leaseMs: 2_000, retentionMs: 1_000 }, 'leaseMs'],
    [{ serverErrorRetentionMs: 2_000, retentionMs: 1_000, leaseMs: 1 }, 'serverErrorRetentionMs'],
  ])('rejects %o', (layer, name) => {
    expect(() => resolveSettings([{ store, ...layer }])).toThrow(RangeError);
    expect(() => resolveSettings([{ store, ...layer }])).toThrow(name);
  });
});

describe('profileOf', () => {
  it('returns undefined without a name and the profile by name', () => {
    expect(profileOf(undefined, undefined)).toBeUndefined();
    expect(profileOf({ profiles: { p: { leaseMs: 1 } } }, 'p')).toEqual({ leaseMs: 1 });
  });

  it('throws for an unknown profile', () => {
    expect(() => profileOf(undefined, 'p')).toThrow(RangeError);
    expect(() => profileOf({ profiles: {} }, 'toString')).toThrow("unknown profile 'toString'");
  });
});

describe('createIdempotency', () => {
  it('keeps its defaults', () => {
    const defaults = { store };
    expect(createIdempotency(defaults).defaults).toBe(defaults);
    expect(createIdempotency({}).defaults).toEqual({});
  });

  it('checks the defaults and every profile at setup', () => {
    expect(() => createIdempotency({ leaseMs: 0 })).toThrow(RangeError);
    expect(() =>
      createIdempotency({
        retentionMs: 60_000,
        profiles: { p: { serverErrorRetentionMs: 120_000 } },
      }),
    ).toThrow('serverErrorRetentionMs');
  });
});
