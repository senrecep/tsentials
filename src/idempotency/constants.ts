/** Request header that carries the idempotency key. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** Response header set to `true` on a replayed response. */
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed';

/**
 * Machine-readable error codes. The `code` is the contract: problem responses carry it as a
 * top-level `code` field, and clients classify on it.
 */
export const IdempotencyErrorCodes = {
  /** The same key is still being processed (Conflict, 409, retryable after `Retry-After`). */
  InFlight: 'Idempotency.InFlight',
  /** The key was used before with a different request (Validation, 422, never retried). */
  KeyReused: 'Idempotency.KeyReused',
  /** The key is required but missing (400). */
  KeyMissing: 'Idempotency.KeyMissing',
  /** The key is malformed (400). */
  KeyInvalid: 'Idempotency.KeyInvalid',
  /** A key was sent but no scope could be resolved and the behavior is `reject` (400). */
  ScopeRequired: 'Idempotency.ScopeRequired',
} as const;

/** One of the {@link IdempotencyErrorCodes} values. */
export type IdempotencyErrorCode =
  (typeof IdempotencyErrorCodes)[keyof typeof IdempotencyErrorCodes];

/** Fixed names of the decision events that are logged. */
export const IdempotencyEventNames = {
  WouldReplay: 'Idempotency.Observe.WouldReplay',
  WouldRejectKeyReused: 'Idempotency.Observe.WouldRejectKeyReused',
  WouldRejectInFlight: 'Idempotency.Observe.WouldRejectInFlight',
  WouldRejectScopeRequired: 'Idempotency.Observe.WouldRejectScopeRequired',
  UnscopedKeySkipped: 'Idempotency.UnscopedKeySkipped',
} as const;

/** Largest key accepted by default, in characters. */
export const DEFAULT_MAX_KEY_LENGTH = 255;
