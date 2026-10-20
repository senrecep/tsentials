import { jsonResultSerializer, type ResultSerializer } from '../mediator/behaviors.js';
import { Result } from '../result/index.js';
import { fingerprintOf } from './encoding.js';
import { runPreparedIdempotent } from './engine.js';
import { idempotencyErrors } from './errors.js';
import { isValidIdempotencyKey } from './keys.js';
import {
  type IdempotencyDefaults,
  type IdempotencySettings,
  profileOf,
  resolveSettings,
  type UnscopedKeyBehavior,
} from './options.js';
import { replayResult, resultCompletion } from './result-policy.js';
import type { IdempotencyScope } from './scopes.js';

/** Options of {@link idempotent}. */
export interface IdempotentOptions<A extends readonly unknown[]> extends IdempotencySettings {
  /** Identity of the operation; the same key in another namespace is another record. */
  readonly namespace: string;
  /**
   * The key of a call, usually from `idempotencyKeys.for(...)`. `undefined` runs the function
   * without idempotency. A key that is not a valid idempotency key throws `TypeError`.
   */
  readonly key: (...args: A) => string | undefined | Promise<string | undefined>;
  /** Whose key it is. Use `idempotencyScopes.global` explicitly for a shared scope. */
  readonly scope: (
    ...args: A
  ) => IdempotencyScope | null | undefined | Promise<IdempotencyScope | null | undefined>;
  /** Value whose hash detects a reused key. Default: the arguments. */
  readonly fingerprint?: ((...args: A) => unknown) | undefined;
  /** The caller's abort signal, passed to the store's `reserve`. */
  readonly signal?: ((...args: A) => AbortSignal | undefined) | undefined;
  /**
   * Hands the lease signal to `fn`: returns the arguments to call `fn` with. Called only in
   * `enforce` mode, after a reservation, with a store that has `extend`; the signal aborts with
   * the caller's reason (from `signal`) or when the reservation is lost (reason name
   * `ReservationLost`). Without it `fn` gets the original arguments. If it throws, the
   * reservation is released and the error is rethrown.
   *
   * ```ts
   * bindSignal: (signal, cmd) => [{ ...cmd, signal }]
   * ```
   */
  readonly bindSignal?: ((signal: AbortSignal, ...args: A) => A) | undefined;
  /** Profile of the `createIdempotency` defaults to apply. */
  readonly profile?: string | undefined;
  /** What a key without a scope does. Default: `reject` (`Idempotency.ScopeRequired`). */
  readonly unscopedKeyBehavior?: UnscopedKeyBehavior | undefined;
  /** `false` releases failures so a retry runs again. Default: `true` (failures are replayed). */
  readonly storeFailures?: boolean | undefined;
  /** Default: `jsonResultSerializer`. */
  readonly serializer?: ResultSerializer | undefined;
}

/** @internal Shared by `idempotent` and `createIdempotency`. */
export function makeIdempotent<A extends readonly unknown[], T>(
  fn: (...args: A) => Result<T> | Promise<Result<T>>,
  options: IdempotentOptions<A>,
  defaults: IdempotencyDefaults | undefined,
): (...args: A) => Promise<Result<T>> {
  if (typeof options.namespace !== 'string' || options.namespace === '') {
    throw new TypeError('idempotent: namespace must be a non-empty string');
  }
  const settings = resolveSettings([options, profileOf(defaults, options.profile), defaults]);
  const policy = {
    releaseFailures: options.storeFailures === false,
    serializer: options.serializer ?? jsonResultSerializer,
  };
  return (...args: A) => {
    const run = async () => fn(...args);
    return runPreparedIdempotent<Result<T>>(
      { settings, source: 'function', target: options.namespace },
      () => ({
        settings,
        source: 'function',
        target: options.namespace,
        namespace: options.namespace,
        unscopedKeyBehavior: options.unscopedKeyBehavior ?? 'reject',
        signal: options.signal?.(...args),
        key: async () => {
          const key = await options.key(...args);
          if (key !== undefined && !isValidIdempotencyKey(key)) {
            throw new TypeError('idempotent: the key is not a valid idempotency key');
          }
          return key;
        },
        scope: () => options.scope(...args),
        fingerprint: () => fingerprintOf(options.fingerprint ? options.fingerprint(...args) : args),
        // `bindSignal` runs synchronously: if it throws, the engine releases the reservation.
        run: (signal) => {
          const bound =
            signal === undefined || options.bindSignal === undefined
              ? args
              : options.bindSignal(signal, ...args);
          return (async () => fn(...bound))();
        },
        receivesSignal: options.bindSignal !== undefined,
        complete: (result) => resultCompletion(result, policy, settings),
        replay: (payload) => replayResult<T>(payload, policy.serializer),
        reject: (code) => Result.failure<T>(idempotencyErrors.forCode(code, settings.retryAfterMs)),
      }),
      run,
    );
  };
}

/**
 * Wraps a Result-returning function so each key runs it once and later calls get the same
 * result.
 *
 * ```ts
 * const capture = idempotent(capturePayment, {
 *   store,
 *   namespace: 'capture-payment',
 *   key: (cmd) => idempotencyKeys.for('capture', cmd.orderId),
 *   scope: (cmd) => idempotencyScopes.tenant(cmd.tenantId),
 * });
 * await capture(cmd); // runs capturePayment
 * await capture(cmd); // same Result, without running it again
 * ```
 *
 * - Running call with the same key → Conflict `Idempotency.InFlight` (retryable).
 * - Same key, other arguments → Validation `Idempotency.KeyReused`.
 * - Key without scope → Validation `Idempotency.ScopeRequired` (see `unscopedKeyBehavior`).
 * - A function that throws (or is aborted) keeps the key in flight until the lease ends; the
 *   error propagates.
 * - With a store that has `extend` (the built-in stores do), the lease is extended while the
 *   function runs; `bindSignal` passes it a signal that also aborts when the reservation is
 *   lost. A function that then rejects with that reason or an abort-like error (in `enforce`,
 *   without a caller abort) gets Unexpected `Idempotency.ReservationLost` and the key is
 *   released; any other error propagates. A failure result after the loss is released.
 * - Success results are kept for `retentionMs`; failures whose first error is `Unexpected` for
 *   `serverErrorRetentionMs`, other failures for `retentionMs` (or released with
 *   `storeFailures: false`).
 *
 * - A store that throws (outage) rejects the call in `enforce` mode, like a throwing
 *   function; `observe` logs it and runs the function.
 *
 * Throws at setup when no store is given or a duration is out of range.
 */
export function idempotent<A extends readonly unknown[], T>(
  fn: (...args: A) => Result<T> | Promise<Result<T>>,
  options: IdempotentOptions<A>,
): (...args: A) => Promise<Result<T>> {
  return makeIdempotent(fn, options, undefined);
}
