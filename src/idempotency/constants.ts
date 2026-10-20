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
  /**
   * The key completed but its result could not be stored, so it can never be replayed (Conflict,
   * 409, never retried). Use a new key only if repeating the side effect is intended.
   */
  ResultUnavailable: 'Idempotency.ResultUnavailable',
  /**
   * The reservation was lost while the operation ran, so its outcome is not stored (Unexpected,
   * 503 over HTTP, retryable: the key was released).
   */
  ReservationLost: 'Idempotency.ReservationLost',
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
  /** `observe` found a key whose result could not be stored; `enforce` would answer `ResultUnavailable`. */
  WouldRejectResultUnavailable: 'Idempotency.Observe.WouldRejectResultUnavailable',
  /** The key, scope or fingerprint resolver threw in `observe` mode; the handler ran without idempotency. */
  ResolutionFailed: 'Idempotency.Observe.ResolutionFailed',
  UnscopedKeySkipped: 'Idempotency.UnscopedKeySkipped',
  /** Name of the decisions that have no fixed event name (`reserved`, `stored`, …). */
  Decision: 'Idempotency.Decision',
  /** `reserve` threw in `observe` mode; the handler ran without idempotency. */
  StoreFailed: 'Idempotency.StoreFailed',
  /** Writing the outcome (`complete` or `release`) threw; the handler's output was returned. */
  CompleteFailed: 'Idempotency.CompleteFailed',
  /**
   * The reservation was lost: `extend` returned `false`, no `extend` succeeded before the lease
   * deadline, or `complete` found another reservation (the lease ran out and another call took
   * over).
   */
  ReservationLost: 'Idempotency.ReservationLost',
  /**
   * The heartbeat stopped extending the lease `MAX_LEASE_MS` (15 minutes) after the reservation;
   * in `enforce` the handler's signal aborts with `ReservationLost`.
   */
  LeaseLimitReached: 'Idempotency.LeaseLimitReached',
  /**
   * A non-2xx HTTP response was not stored: its body exceeded `maxResponseBodyBytes`. A 2xx logs
   * `ResponseNotReplayable` with reason `too_large` instead.
   */
  ResponseTooLarge: 'Idempotency.ResponseTooLarge',
  /**
   * A 2xx HTTP response could not be stored; a marker was stored instead, so a retry gets 409
   * `Idempotency.ResultUnavailable` for `retentionMs`. Logged once the marker is stored, with the
   * `Reason` property `too_large`, `encoded` or `event_stream`.
   */
  ResponseNotReplayable: 'Idempotency.ResponseNotReplayable',
  /** A stored HTTP response cannot be read; the call got 500 and the handler did not run. */
  StoredResponseUnreadable: 'Idempotency.StoredResponseUnreadable',
} as const;

/** Largest key accepted by default, in characters. */
export const DEFAULT_MAX_KEY_LENGTH = 255;
