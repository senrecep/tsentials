import { type AppError, Err, ErrorMetadata } from '../errors/index.js';
import { type IdempotencyErrorCode, IdempotencyErrorCodes } from './constants.js';

/**
 * Errors of the idempotency module. The `code` is the contract; descriptions are for people.
 */
export const idempotencyErrors = {
  /**
   * The key is still being processed (Conflict). `retryAfterMs` is carried as metadata so
   * a client or a Result-to-HTTP layer can send `Retry-After`.
   */
  inFlight(retryAfterMs?: number | null): AppError {
    return Err.conflict(
      IdempotencyErrorCodes.InFlight,
      'A request with the same idempotency key is still being processed.',
      retryAfterMs == null ? undefined : ErrorMetadata.fromRecord({ retryAfterMs }),
    );
  },
  /** The key was used before with a different request (Validation, never retried). */
  keyReused(): AppError {
    return Err.validation(
      IdempotencyErrorCodes.KeyReused,
      'The idempotency key was already used with a different request.',
    );
  },
  /** The key is required but missing (Validation). */
  keyMissing(): AppError {
    return Err.validation(IdempotencyErrorCodes.KeyMissing, 'An idempotency key is required.');
  },
  /** The key is malformed (Validation). */
  keyInvalid(): AppError {
    return Err.validation(IdempotencyErrorCodes.KeyInvalid, 'The idempotency key is invalid.');
  },
  /** A key was given but no scope could be resolved (Validation). */
  scopeRequired(): AppError {
    return Err.validation(
      IdempotencyErrorCodes.ScopeRequired,
      'An idempotency key needs a scope, but none could be resolved.',
    );
  },
  /**
   * The key completed but its result could not be stored, so it can never be replayed
   * (Conflict, never retried).
   */
  resultUnavailable(): AppError {
    return Err.conflict(
      IdempotencyErrorCodes.ResultUnavailable,
      'The request with this idempotency key completed, but its result cannot be replayed.',
    );
  },
  /**
   * The reservation was lost while the operation ran (Unexpected). The outcome was not stored and
   * the key was released, so a retry runs the operation again.
   */
  reservationLost(): AppError {
    return Err.unexpected(
      IdempotencyErrorCodes.ReservationLost,
      'The idempotency reservation was lost while the operation ran.',
    );
  },
  /** The error of a code; `retryAfterMs` is used by `InFlight` only. */
  forCode(code: IdempotencyErrorCode, retryAfterMs?: number | null): AppError {
    return byCode[code](retryAfterMs);
  },
} as const;

const byCode: Readonly<
  Record<IdempotencyErrorCode, (retryAfterMs: number | null | undefined) => AppError>
> = {
  [IdempotencyErrorCodes.InFlight]: (retryAfterMs) => idempotencyErrors.inFlight(retryAfterMs),
  [IdempotencyErrorCodes.KeyReused]: () => idempotencyErrors.keyReused(),
  [IdempotencyErrorCodes.KeyMissing]: () => idempotencyErrors.keyMissing(),
  [IdempotencyErrorCodes.KeyInvalid]: () => idempotencyErrors.keyInvalid(),
  [IdempotencyErrorCodes.ScopeRequired]: () => idempotencyErrors.scopeRequired(),
  [IdempotencyErrorCodes.ResultUnavailable]: () => idempotencyErrors.resultUnavailable(),
  [IdempotencyErrorCodes.ReservationLost]: () => idempotencyErrors.reservationLost(),
};
