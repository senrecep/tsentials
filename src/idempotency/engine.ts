import {
  type IdempotencyErrorCode,
  IdempotencyErrorCodes,
  IdempotencyEventNames,
} from './constants.js';
import { sha256Hex } from './encoding.js';
import type {
  IdempotencyDecision,
  IdempotencyMode,
  IdempotencySource,
  ResolvedIdempotencySettings,
  UnscopedKeyBehavior,
} from './options.js';
import { idempotencyScopes } from './scopes.js';
import type { IdempotencyRecordKey, IdempotencyReservation } from './store.js';

/** What to do with the record once the handler has returned. */
export type IdempotencyCompletion =
  | { readonly action: 'store'; readonly payload: string; readonly retentionMs: number }
  | { readonly action: 'release' }
  /** Neither store nor release: the reservation stays in flight until its lease ends. */
  | { readonly action: 'keep' };

/**
 * A key the caller sent but cannot be used: `enforce` answers with the code, `observe` runs
 * the handler without idempotency.
 */
export interface IdempotencyKeyRejection {
  readonly reject:
    | typeof IdempotencyErrorCodes.KeyMissing
    | typeof IdempotencyErrorCodes.KeyInvalid;
}

/** One call through the engine; built by `idempotent`, the mediator behavior and the adapter. */
export interface IdempotencyCall<O> {
  readonly settings: ResolvedIdempotencySettings;
  readonly source: IdempotencySource;
  readonly target: string;
  readonly namespace: string;
  readonly unscopedKeyBehavior: UnscopedKeyBehavior;
  readonly signal?: AbortSignal | undefined;
  /**
   * The key; `undefined` runs the handler without idempotency, a rejection refuses the call.
   * Not called in `off` mode.
   */
  readonly key: () =>
    | string
    | undefined
    | IdempotencyKeyRejection
    | Promise<string | undefined | IdempotencyKeyRejection>;
  /** The scope; `undefined` applies `unscopedKeyBehavior`. */
  readonly scope: () => string | undefined | Promise<string | undefined>;
  readonly fingerprint: () => string | Promise<string>;
  /** Runs the handler. Calling it marks the handler as started. */
  readonly run: () => Promise<O>;
  /** Decides what happens to the record after the handler returned `output`. */
  readonly complete: (output: O) => IdempotencyCompletion | Promise<IdempotencyCompletion>;
  /** Rebuilds a stored output (`enforce` only). */
  readonly replay: (payload: string) => O | Promise<O>;
  /** Output of a rejected call (`enforce` only). */
  readonly reject: (code: IdempotencyErrorCode) => O | Promise<O>;
}

async function keyHashOf(key: string): Promise<string> {
  return (await sha256Hex(key)).slice(0, 16);
}

/** `keyHash` is unknown only when resolving the key itself failed. */
function logEvent(
  call: IdempotencyCall<unknown>,
  mode: Exclude<IdempotencyMode, 'off'>,
  keyHash: string | undefined,
  level: 'information' | 'warning',
  name: string,
  exception: unknown,
): void {
  const { logger } = call.settings;
  try {
    if (logger === undefined || !(logger.isEnabled?.(level) ?? true)) return;
    const hash = keyHash === undefined ? '' : ` (key hash ${keyHash})`;
    logger.log(level, `${name} for ${call.target}${hash}`, {
      EventName: name,
      Mode: mode,
      Source: call.source,
      Target: call.target,
      ...(keyHash === undefined ? {} : { KeyHash: keyHash }),
      ...(exception === undefined ? {} : { Exception: exception }),
    });
  } catch {
    // Ignored: logging is best effort.
  }
}

class Reporter {
  constructor(
    private readonly call: IdempotencyCall<unknown>,
    private readonly mode: Exclude<IdempotencyMode, 'off'>,
    private readonly keyHash: string,
  ) {}

  decision(decision: IdempotencyDecision, name?: string, warn = false): void {
    const { onDecision } = this.call.settings;
    const eventName = name ?? IdempotencyEventNames.Decision;
    try {
      onDecision?.({
        name: eventName,
        decision,
        mode: this.mode,
        source: this.call.source,
        target: this.call.target,
        keyHash: this.keyHash,
      });
    } catch {
      // Ignored: an observer must not change the outcome of the call.
    }
    if (name !== undefined) this.log(warn ? 'warning' : 'information', name, undefined);
  }

  log(level: 'information' | 'warning', name: string, exception: unknown): void {
    logEvent(this.call, this.mode, this.keyHash, level, name, exception);
  }
}

const conflictEvents: Readonly<
  Record<
    Exclude<IdempotencyReservation['status'], 'reserved'>,
    { decision: IdempotencyDecision; observeName: string }
  >
> = {
  completed: { decision: 'replay', observeName: IdempotencyEventNames.WouldReplay },
  mismatch: { decision: 'key_reused', observeName: IdempotencyEventNames.WouldRejectKeyReused },
  inFlight: { decision: 'in_flight', observeName: IdempotencyEventNames.WouldRejectInFlight },
};

/** Outcome of resolving key, scope and fingerprint, before anything is reserved. */
type Resolution =
  | { readonly kind: 'run' }
  | { readonly kind: 'reject'; readonly code: IdempotencyErrorCode }
  | {
      readonly kind: 'reserve';
      readonly reporter: Reporter;
      readonly recordKey: IdempotencyRecordKey;
      readonly fingerprint: string;
    };

const RUN: Resolution = { kind: 'run' };

async function resolve(
  call: IdempotencyCall<unknown>,
  mode: Exclude<IdempotencyMode, 'off'>,
  onKeyHash: (keyHash: string) => void,
): Promise<Resolution> {
  const key = await call.key();
  if (key === undefined) return RUN;
  if (typeof key !== 'string')
    return mode === 'enforce' ? { kind: 'reject', code: key.reject } : RUN;
  const keyHash = await keyHashOf(key);
  onKeyHash(keyHash);
  const reporter = new Reporter(call, mode, keyHash);

  let scope = await call.scope();
  if (scope === undefined) {
    if (call.unscopedKeyBehavior === 'global') {
      scope = idempotencyScopes.global;
    } else if (call.unscopedKeyBehavior === 'skip') {
      reporter.decision('unscoped', IdempotencyEventNames.UnscopedKeySkipped, true);
      return RUN;
    } else if (mode === 'observe') {
      reporter.decision('unscoped', IdempotencyEventNames.WouldRejectScopeRequired);
      return RUN;
    } else {
      reporter.decision('unscoped');
      return { kind: 'reject', code: IdempotencyErrorCodes.ScopeRequired };
    }
  }

  const recordKey: IdempotencyRecordKey = { namespace: call.namespace, scope, key };
  return { kind: 'reserve', reporter, recordKey, fingerprint: await call.fingerprint() };
}

/**
 * Runs one call: resolve key and scope → reserve → decide → run → complete or release →
 * report. In `observe` mode every call runs the handler and gets its own output; conflicts
 * are only reported, and records it does not own are left untouched.
 */
export async function runIdempotent<O>(call: IdempotencyCall<O>): Promise<O> {
  const mode = call.settings.mode();
  if (mode === 'off') return call.run();

  let resolution: Resolution;
  let keyHash: string | undefined;
  try {
    resolution = await resolve(call as IdempotencyCall<unknown>, mode, (hash) => {
      keyHash = hash;
    });
  } catch (error) {
    // Observe never blocks: a key, scope or fingerprint resolver that throws is logged and
    // the handler runs without idempotency.
    if (mode === 'enforce' || call.signal?.aborted === true) throw error;
    logEvent(
      call as IdempotencyCall<unknown>,
      mode,
      keyHash,
      'warning',
      IdempotencyEventNames.ResolutionFailed,
      error,
    );
    return call.run();
  }
  if (resolution.kind === 'run') return call.run();
  if (resolution.kind === 'reject') return call.reject(resolution.code);
  const { reporter, recordKey, fingerprint } = resolution;
  const { store, leaseMs } = call.settings;

  let reservation: IdempotencyReservation;
  try {
    reservation = await store.reserve(recordKey, fingerprint, leaseMs, call.signal);
  } catch (error) {
    // Observe never blocks: a store outage is logged and the handler runs without a token.
    if (mode === 'enforce' || call.signal?.aborted === true) throw error;
    reporter.log('warning', IdempotencyEventNames.StoreFailed, error);
    return call.run();
  }

  if (reservation.status !== 'reserved') {
    const conflict = conflictEvents[reservation.status];
    if (mode === 'observe') {
      reporter.decision(conflict.decision, conflict.observeName);
      return call.run();
    }
    reporter.decision(conflict.decision);
    if (reservation.status === 'completed') return call.replay(reservation.payload);
    return call.reject(
      reservation.status === 'mismatch'
        ? IdempotencyErrorCodes.KeyReused
        : IdempotencyErrorCodes.InFlight,
    );
  }

  reporter.decision('reserved');
  const output = await call.run();
  try {
    const completion = await call.complete(output);
    if (completion.action === 'store') {
      const stored = await store.complete(
        recordKey,
        reservation.token,
        fingerprint,
        completion.payload,
        completion.retentionMs,
      );
      if (stored) reporter.decision('stored');
      else reporter.log('warning', IdempotencyEventNames.ReservationLost, undefined);
    } else if (completion.action === 'release') {
      if (await store.release(recordKey, reservation.token)) reporter.decision('released');
    }
  } catch (error) {
    // The handler has run: its output is returned even when the record cannot be written.
    reporter.log('warning', IdempotencyEventNames.CompleteFailed, error);
  }
  return output;
}
