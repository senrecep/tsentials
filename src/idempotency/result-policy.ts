import { ErrorType } from '../errors/index.js';
import type { ResultSerializer } from '../mediator/behaviors.js';
import type { Result } from '../result/index.js';
import type { IdempotencyCompletion } from './engine.js';
import type { ResolvedIdempotencySettings } from './options.js';

/** How `Result` outputs are kept, shared by `idempotent` and the mediator behavior. */
export interface ResultStorePolicy {
  /** A failure is released instead of stored (its transaction rolled back). */
  readonly releaseFailures: boolean;
  readonly serializer: ResultSerializer;
}

/**
 * Success → stored for `retentionMs`. Failure → released when `releaseFailures`, otherwise
 * stored: for `serverErrorRetentionMs` when its first error is `Unexpected` (the 5xx
 * kind), for `retentionMs` otherwise. A failure after a lost lease (`enforce`) is released by
 * the engine.
 */
export function resultCompletion(
  result: Result<unknown>,
  policy: ResultStorePolicy,
  settings: ResolvedIdempotencySettings,
): IdempotencyCompletion {
  if (!result.ok && policy.releaseFailures) return { action: 'release' };
  const first = result.ok ? undefined : result.errors[0];
  const serverError = first?.type === ErrorType.Unexpected;
  return {
    action: 'store',
    payload: policy.serializer.serialize(result),
    retentionMs: serverError ? settings.serverErrorRetentionMs : settings.retentionMs,
    failure: !result.ok,
  };
}

/** Rebuilds a stored result; a record that is not a serialized result throws `TypeError`. */
export function replayResult<T>(payload: string, serializer: ResultSerializer): Result<T> {
  const result = serializer.deserialize(payload);
  if (result === undefined) throw new TypeError('idempotency: the stored record is not a result');
  return result as Result<T>;
}
