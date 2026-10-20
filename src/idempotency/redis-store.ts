import { throwIfAborted } from '../result/index.js';
import {
  assertNonEmpty,
  assertPositive,
  IDEMPOTENCY_STORAGE_PREFIX,
  type IdempotencyRecordKey,
  type IdempotencyReservation,
  type IdempotencyStore,
  idempotencyStorageKey,
  type TokenFactory,
} from './store.js';

/**
 * The one Redis command the store needs: `EVAL script numkeys key... arg...`. Adapt your client:
 *
 * ```ts
 * // ioredis
 * const redis: RedisLike = { eval: (s, keys, args) => client.eval(s, keys.length, ...keys, ...args) };
 * // node-redis
 * const redis: RedisLike = { eval: (s, keys, args) => client.eval(s, { keys, arguments: args }) };
 * ```
 */
export interface RedisLike {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

/**
 * Lua scripts of {@link RedisIdempotencyStore}. A record is a hash with the fields `t` (token),
 * `f` (fingerprint) and `p` (payload, only once completed); the key's TTL is the lease or the
 * retention. Every script touches one key, so they also run on Redis Cluster.
 */
export const RedisIdempotencyScripts = {
  /** KEYS: record. ARGV: fingerprint, leaseMs, token. Returns `{status[, payload]}`. */
  reserve: `local r = redis.call('HMGET', KEYS[1], 'f', 'p')
if r[1] then
  if r[1] ~= ARGV[1] then return {'mismatch'} end
  if r[2] then return {'completed', r[2]} end
  return {'inFlight'}
end
redis.call('HSET', KEYS[1], 't', ARGV[3], 'f', ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return {'reserved'}`,
  /** KEYS: record. ARGV: token, fingerprint, payload, retentionMs. Returns 1 or 0. */
  complete: `local r = redis.call('HMGET', KEYS[1], 't', 'p')
if r[1] and (r[2] or r[1] ~= ARGV[1]) then return 0 end
redis.call('HSET', KEYS[1], 't', ARGV[1], 'f', ARGV[2], 'p', ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return 1`,
  /** KEYS: record. ARGV: token. Returns 1 or 0. */
  release: `local r = redis.call('HMGET', KEYS[1], 't', 'p')
if r[1] == ARGV[1] and not r[2] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0`,
  /**
   * KEYS: record. ARGV: token, leaseMs. Returns 1 or 0. A key whose TTL ran out is gone, so an
   * expired lease is never revived.
   */
  extend: `local r = redis.call('HMGET', KEYS[1], 't', 'p')
if r[1] == ARGV[1] and not r[2] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0`,
} as const;

/** Options of {@link RedisIdempotencyStore}. */
export interface RedisIdempotencyStoreOptions {
  /** Prefix of every Redis key. Default: {@link IDEMPOTENCY_STORAGE_PREFIX}. */
  readonly prefix?: string | undefined;
  /** Default: `crypto.randomUUID()`. */
  readonly tokenFactory?: TokenFactory | undefined;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string'
    ? value
    : value instanceof Uint8Array
      ? new TextDecoder().decode(value)
      : undefined;

function parseReservation(reply: unknown, token: string): IdempotencyReservation {
  const status = Array.isArray(reply) ? text(reply[0]) : undefined;
  if (status === 'reserved') return { status, token };
  if (status === 'inFlight' || status === 'mismatch') return { status };
  const payload = status === 'completed' ? text((reply as unknown[])[1]) : undefined;
  if (payload !== undefined) return { status: 'completed', payload };
  throw new TypeError(`RedisIdempotencyStore: unexpected reserve reply ${String(reply)}`);
}

function parseFlag(reply: unknown, operation: string): boolean {
  const flag = typeof reply === 'number' || typeof reply === 'bigint' ? Number(reply) : NaN;
  if (flag === 1 || flag === 0) return flag === 1;
  throw new TypeError(`RedisIdempotencyStore: unexpected ${operation} reply ${String(reply)}`);
}

/**
 * Shared store on Redis. Each operation is one Lua script ({@link RedisIdempotencyScripts}), so
 * reserve, complete, release and extend are atomic across processes. Bring your own client through
 * {@link RedisLike}; Redis measures lease and retention itself (`PEXPIRE`, rounded up to whole
 * milliseconds).
 *
 * Use a store with atomic compare-and-set. An eventually consistent key-value store (for example
 * Cloudflare KV) cannot reserve atomically and is not safe as a lock.
 */
export class RedisIdempotencyStore implements IdempotencyStore {
  readonly #redis: RedisLike;
  readonly #prefix: string;
  readonly #tokenFactory: TokenFactory;

  constructor(redis: RedisLike, options: RedisIdempotencyStoreOptions = {}) {
    this.#redis = redis;
    this.#prefix = options.prefix ?? IDEMPOTENCY_STORAGE_PREFIX;
    this.#tokenFactory = options.tokenFactory ?? (() => globalThis.crypto.randomUUID());
  }

  async reserve(
    key: IdempotencyRecordKey,
    fingerprint: string,
    leaseMs: number,
    signal?: AbortSignal,
  ): Promise<IdempotencyReservation> {
    throwIfAborted(signal);
    assertNonEmpty('fingerprint', fingerprint);
    assertPositive('leaseMs', leaseMs);
    const token = this.#tokenFactory();
    const reply = await this.#redis.eval(
      RedisIdempotencyScripts.reserve,
      [idempotencyStorageKey(key, this.#prefix)],
      [fingerprint, String(Math.ceil(leaseMs)), token],
    );
    return parseReservation(reply, token);
  }

  async complete(
    key: IdempotencyRecordKey,
    token: string,
    fingerprint: string,
    payload: string,
    retentionMs: number,
  ): Promise<boolean> {
    assertNonEmpty('token', token);
    assertNonEmpty('fingerprint', fingerprint);
    assertPositive('retentionMs', retentionMs);
    const reply = await this.#redis.eval(
      RedisIdempotencyScripts.complete,
      [idempotencyStorageKey(key, this.#prefix)],
      [token, fingerprint, payload, String(Math.ceil(retentionMs))],
    );
    return parseFlag(reply, 'complete');
  }

  async release(key: IdempotencyRecordKey, token: string): Promise<boolean> {
    assertNonEmpty('token', token);
    const reply = await this.#redis.eval(
      RedisIdempotencyScripts.release,
      [idempotencyStorageKey(key, this.#prefix)],
      [token],
    );
    return parseFlag(reply, 'release');
  }

  async extend(
    key: IdempotencyRecordKey,
    token: string,
    leaseMs: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal);
    assertNonEmpty('token', token);
    assertPositive('leaseMs', leaseMs);
    const reply = await this.#redis.eval(
      RedisIdempotencyScripts.extend,
      [idempotencyStorageKey(key, this.#prefix)],
      [token, String(Math.ceil(leaseMs))],
    );
    return parseFlag(reply, 'extend');
  }
}
