import type { MediatorLogger } from '../mediator/behaviors.js';
import type { IdempotencyStore } from './store.js';

/**
 * Rollout mode. `off` skips idempotency entirely (no key is resolved, the store is not
 * called); `observe` records and detects conflicts but never blocks or replays; `enforce`
 * (the default) replays and rejects.
 */
export type IdempotencyMode = 'off' | 'observe' | 'enforce';

/** A mode, or a function read on every call so the mode can change without a restart. */
export type IdempotencyModeSetting = IdempotencyMode | (() => IdempotencyMode);

/** What happened to one call. Same values as the decision metric tags. */
export type IdempotencyDecision =
  | 'reserved'
  | 'replay'
  | 'result_unavailable'
  | 'key_reused'
  | 'in_flight'
  | 'unscoped'
  | 'released'
  | 'stored';

/** Which wrapper made the decision. */
export type IdempotencySource = 'http' | 'mediator' | 'function';

/** Event passed to `onDecision` for every decision of an `observe` or `enforce` call. */
export interface IdempotencyDecisionEvent {
  /**
   * A fixed event name (`IdempotencyEventNames`) for the decisions that are logged, otherwise
   * `IdempotencyEventNames.Decision`.
   */
  readonly name: string;
  readonly decision: IdempotencyDecision;
  readonly mode: Exclude<IdempotencyMode, 'off'>;
  readonly source: IdempotencySource;
  /** Route, request name or namespace. */
  readonly target: string;
  /** First 16 hex characters of the SHA-256 of the key. The key itself is never reported. */
  readonly keyHash: string;
}

/** Logger of the idempotency module; same shape as the mediator logger. */
export type IdempotencyLogger = MediatorLogger;

/** What to do with a key that comes without a scope. */
export type UnscopedKeyBehavior = 'skip' | 'reject' | 'global';

/** Settings that can be given globally, per profile, per route or request type and per call. */
export interface IdempotencySettings {
  readonly store?: IdempotencyStore | undefined;
  readonly mode?: IdempotencyModeSetting | undefined;
  /** How long a reservation blocks other calls with the same key. Default: 60 000 (1 min). */
  readonly leaseMs?: number | undefined;
  /** How long a completed result is replayed. Default: 86 400 000 (24 h). */
  readonly retentionMs?: number | undefined;
  /**
   * How long a server error result (5xx, or an `Unexpected` failure) is replayed. Shorter than
   * `retentionMs` so a client is not locked out of its key for long. Default: 600 000 (10 min).
   */
  readonly serverErrorRetentionMs?: number | undefined;
  /**
   * `Retry-After` sent with an in-flight rejection, in milliseconds (rounded up to whole
   * seconds on HTTP). `null` omits it. Default: 1 000.
   */
  readonly retryAfterMs?: number | null | undefined;
  /** Called for every decision; exceptions it throws are ignored. */
  readonly onDecision?: ((event: IdempotencyDecisionEvent) => void) | undefined;
  /** Receives the fixed-name events and store errors. */
  readonly logger?: IdempotencyLogger | undefined;
}

/** Global settings with named profiles, for `createIdempotency`. */
export interface IdempotencyDefaults extends IdempotencySettings {
  /** Named settings selected with `profile`, for example `payments` or `messaging`. */
  readonly profiles?: Readonly<Record<string, IdempotencySettings>> | undefined;
}

/** Settings with every default applied and checked. */
export interface ResolvedIdempotencySettings {
  readonly store: IdempotencyStore;
  readonly mode: () => IdempotencyMode;
  readonly leaseMs: number;
  readonly retentionMs: number;
  readonly serverErrorRetentionMs: number;
  readonly retryAfterMs: number | null;
  readonly onDecision: ((event: IdempotencyDecisionEvent) => void) | undefined;
  readonly logger: IdempotencyLogger | undefined;
}

/** Default lease: 1 minute. */
export const DEFAULT_LEASE_MS = 60_000;
/** Default retention: 24 hours. */
export const DEFAULT_RETENTION_MS = 86_400_000;
/** Default server error retention: 10 minutes. */
export const DEFAULT_SERVER_ERROR_RETENTION_MS = 600_000;
/** Default `Retry-After`: 1 second. */
export const DEFAULT_RETRY_AFTER_MS = 1_000;
/** Longest allowed lease: 15 minutes. */
export const MAX_LEASE_MS = 900_000;

function positive(name: string, value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new RangeError(`idempotency: ${name} must be a positive finite number, got ${value}`);
  }
  return value;
}

function defined<T>(
  layers: readonly (IdempotencySettings | undefined)[],
  pick: (s: IdempotencySettings) => T | undefined,
): T | undefined {
  // Layers are ordered from the most specific to the most general; the first defined value wins.
  for (const layer of layers) {
    const value = layer === undefined ? undefined : pick(layer);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Looks up a profile. Throws when the name is unknown, so a typo fails at setup instead of
 * silently using the global settings.
 */
export function profileOf(
  defaults: IdempotencyDefaults | undefined,
  name: string | undefined,
): IdempotencySettings | undefined {
  if (name === undefined) return undefined;
  const profiles = defaults?.profiles;
  if (profiles === undefined || !Object.hasOwn(profiles, name)) {
    throw new RangeError(`idempotency: unknown profile '${name}'`);
  }
  return profiles[name];
}

/**
 * Merges settings layers (most specific first) and applies the defaults. Throws when no
 * store is given, when a duration is not positive, when `leaseMs` exceeds
 * `min(retentionMs, 15 min)` or when `serverErrorRetentionMs` exceeds `retentionMs`.
 */
export function resolveSettings(
  layers: readonly (IdempotencySettings | undefined)[],
): ResolvedIdempotencySettings {
  const store = defined(layers, (s) => s.store);
  if (store === undefined) throw new TypeError('idempotency: a store is required');
  return { store, ...resolveTunables(layers) };
}

/** {@link resolveSettings} without the store, to check defaults that get their store later. */
export function resolveTunables(
  layers: readonly (IdempotencySettings | undefined)[],
): Omit<ResolvedIdempotencySettings, 'store'> {
  const retentionMs = positive(
    'retentionMs',
    defined(layers, (s) => s.retentionMs) ?? DEFAULT_RETENTION_MS,
  );
  const leaseMs = positive(
    'leaseMs',
    defined(layers, (s) => s.leaseMs) ?? Math.min(DEFAULT_LEASE_MS, retentionMs),
  );
  const serverErrorRetentionMs = positive(
    'serverErrorRetentionMs',
    defined(layers, (s) => s.serverErrorRetentionMs) ??
      Math.min(DEFAULT_SERVER_ERROR_RETENTION_MS, retentionMs),
  );
  if (leaseMs > Math.min(retentionMs, MAX_LEASE_MS)) {
    throw new RangeError(
      `idempotency: leaseMs (${leaseMs}) must not exceed min(retentionMs, ${MAX_LEASE_MS})`,
    );
  }
  if (serverErrorRetentionMs > retentionMs) {
    throw new RangeError(
      `idempotency: serverErrorRetentionMs (${serverErrorRetentionMs}) must not exceed retentionMs (${retentionMs})`,
    );
  }
  const retryAfter = defined(layers, (s) => s.retryAfterMs);
  const retryAfterMs =
    retryAfter === null ? null : positive('retryAfterMs', retryAfter ?? DEFAULT_RETRY_AFTER_MS);
  const mode = defined(layers, (s) => s.mode) ?? 'enforce';
  return {
    mode: typeof mode === 'function' ? mode : () => mode,
    leaseMs,
    retentionMs,
    serverErrorRetentionMs,
    retryAfterMs,
    onDecision: defined(layers, (s) => s.onDecision),
    logger: defined(layers, (s) => s.logger),
  };
}
