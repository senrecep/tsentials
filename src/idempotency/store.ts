import { throwIfAborted } from '../result/index.js';
import { type DateTimeProvider, SystemDateTimeProvider } from '../time/index.js';
import { utf8 } from './encoding.js';

/** Identity of a record: the same key under another namespace or scope is another record. */
export interface IdempotencyRecordKey {
  /** Consumer or handler identity, for example the operation or request type name. */
  readonly namespace: string;
  /** Whose key it is: user, tenant, client, or `global` (from `idempotencyScopes.global`). */
  readonly scope: string;
  /** The idempotency key itself. */
  readonly key: string;
}

/** Outcome of {@link IdempotencyStore.reserve}. */
export type IdempotencyReservation =
  | { readonly status: 'reserved'; readonly token: string }
  | { readonly status: 'inFlight' }
  | { readonly status: 'completed'; readonly payload: string }
  | { readonly status: 'mismatch' };

/**
 * Record store. `reserve` must be one atomic operation; `complete` and `release` act only
 * when the stored token matches (compare-and-set / compare-and-delete).
 */
export interface IdempotencyStore {
  /**
   * Reserves the key for `leaseMs`. A live record with another fingerprint gives `mismatch`
   * (checked first); otherwise a live reservation gives `inFlight` and a completed record
   * gives `completed`. An expired record is replaced.
   */
  reserve(
    key: IdempotencyRecordKey,
    fingerprint: string,
    leaseMs: number,
    signal?: AbortSignal,
  ): Promise<IdempotencyReservation>;
  /**
   * Stores the payload for `retentionMs` when the reservation still holds `token`. A
   * reservation whose lease ran out but that nobody took over may still be completed.
   * Returns `false` when the token no longer matches.
   */
  complete(
    key: IdempotencyRecordKey,
    token: string,
    fingerprint: string,
    payload: string,
    retentionMs: number,
  ): Promise<boolean>;
  /** Deletes an in-flight reservation that still holds `token`; `false` otherwise. */
  release(key: IdempotencyRecordKey, token: string): Promise<boolean>;
}

/** Default prefix of {@link idempotencyStorageKey}; the version changes with the record format. */
export const IDEMPOTENCY_STORAGE_PREFIX = 'idem:v3:';

/**
 * Single string for a record key: `prefix` + length-prefixed namespace, scope and key
 * (`{utf8ByteLength}:{value}` joined with `|`), so no two record keys share a storage key.
 */
export function idempotencyStorageKey(
  key: IdempotencyRecordKey,
  prefix: string = IDEMPOTENCY_STORAGE_PREFIX,
): string {
  return (
    prefix +
    [key.namespace, key.scope, key.key].map((part) => `${utf8(part).length}:${part}`).join('|')
  );
}

/** Generates reservation tokens. Default: `crypto.randomUUID()`. */
export type TokenFactory = () => string;

/** Options of {@link InMemoryIdempotencyStore}. */
export interface InMemoryIdempotencyStoreOptions {
  /** Clock for lease and retention. Default: `SystemDateTimeProvider`. */
  readonly clock?: DateTimeProvider | undefined;
  /** Default: `crypto.randomUUID()`. */
  readonly tokenFactory?: TokenFactory | undefined;
  /** How often expired records are swept, in milliseconds. Default: 60 000. */
  readonly sweepIntervalMs?: number | undefined;
}

interface Entry {
  readonly token: string;
  readonly fingerprint: string;
  readonly payload: string | undefined;
  readonly expiresAt: number;
}

/** @internal Shared argument checks of the stores. */
export function assertPositive(name: string, value: number): void {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

/** @internal */
export function assertNonEmpty(name: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

/**
 * Process-local store. Atomic within one process (JavaScript runs each call to completion);
 * use a shared store (Redis, SQL) when several processes serve the same keys.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #entries = new Map<string, Entry>();
  readonly #clock: DateTimeProvider;
  readonly #tokenFactory: TokenFactory;
  readonly #sweepIntervalMs: number;
  #nextSweep = 0;

  constructor(options: InMemoryIdempotencyStoreOptions = {}) {
    this.#clock = options.clock ?? SystemDateTimeProvider;
    this.#tokenFactory = options.tokenFactory ?? (() => globalThis.crypto.randomUUID());
    this.#sweepIntervalMs = options.sweepIntervalMs ?? 60_000;
  }

  /** Number of stored records, expired ones included until the next sweep. */
  get size(): number {
    return this.#entries.size;
  }

  reserve(
    key: IdempotencyRecordKey,
    fingerprint: string,
    leaseMs: number,
    signal?: AbortSignal,
  ): Promise<IdempotencyReservation> {
    return Promise.resolve().then(() => {
      throwIfAborted(signal);
      assertNonEmpty('fingerprint', fingerprint);
      assertPositive('leaseMs', leaseMs);
      const now = this.#clock.utcNowMs();
      this.#sweep(now);
      const storageKey = idempotencyStorageKey(key);
      const existing = this.#entries.get(storageKey);
      if (existing !== undefined && existing.expiresAt > now) {
        if (existing.fingerprint !== fingerprint) return { status: 'mismatch' };
        return existing.payload === undefined
          ? { status: 'inFlight' }
          : { status: 'completed', payload: existing.payload };
      }
      const token = this.#tokenFactory();
      this.#entries.set(storageKey, {
        token,
        fingerprint,
        payload: undefined,
        expiresAt: now + leaseMs,
      });
      return { status: 'reserved', token };
    });
  }

  complete(
    key: IdempotencyRecordKey,
    token: string,
    fingerprint: string,
    payload: string,
    retentionMs: number,
  ): Promise<boolean> {
    return Promise.resolve().then(() => {
      assertNonEmpty('token', token);
      assertNonEmpty('fingerprint', fingerprint);
      assertPositive('retentionMs', retentionMs);
      const storageKey = idempotencyStorageKey(key);
      const existing = this.#entries.get(storageKey);
      if (existing !== undefined && (existing.payload !== undefined || existing.token !== token)) {
        return false;
      }
      this.#entries.set(storageKey, {
        token,
        fingerprint,
        payload,
        expiresAt: this.#clock.utcNowMs() + retentionMs,
      });
      return true;
    });
  }

  release(key: IdempotencyRecordKey, token: string): Promise<boolean> {
    return Promise.resolve().then(() => {
      assertNonEmpty('token', token);
      const storageKey = idempotencyStorageKey(key);
      const existing = this.#entries.get(storageKey);
      if (existing === undefined || existing.payload !== undefined || existing.token !== token) {
        return false;
      }
      this.#entries.delete(storageKey);
      return true;
    });
  }

  #sweep(now: number): void {
    if (now < this.#nextSweep) return;
    this.#nextSweep = now + this.#sweepIntervalMs;
    for (const [storageKey, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(storageKey);
    }
  }
}
