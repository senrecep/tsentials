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

/** One call through the engine; built by `idempotent`, the mediator behavior and the adapter. */
export interface IdempotencyCall<O> {
  readonly settings: ResolvedIdempotencySettings;
  readonly source: IdempotencySource;
  readonly target: string;
  readonly namespace: string;
  readonly unscopedKeyBehavior: UnscopedKeyBehavior;
  readonly signal?: AbortSignal | undefined;
  /** The key; `undefined` runs the handler without idempotency. Not called in `off` mode. */
  readonly key: () => string | undefined | Promise<string | undefined>;
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
    const { logger } = this.call.settings;
    try {
      if (logger === undefined || !(logger.isEnabled?.(level) ?? true)) return;
      logger.log(level, `${name} for ${this.call.target} (key hash ${this.keyHash})`, {
        EventName: name,
        Mode: this.mode,
        Source: this.call.source,
        Target: this.call.target,
        KeyHash: this.keyHash,
        ...(exception === undefined ? {} : { Exception: exception }),
      });
    } catch {
      // Ignored: logging is best effort.
    }
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

/**
 * Runs one call: resolve key and scope → reserve → decide → run → complete or release →
 * report. In `observe` mode every call runs the handler and gets its own output; conflicts
 * are only reported, and records it does not own are left untouched.
 */
export async function runIdempotent<O>(call: IdempotencyCall<O>): Promise<O> {
  const mode = call.settings.mode();
  if (mode === 'off') return call.run();

  const key = await call.key();
  if (key === undefined) return call.run();
  const reporter = new Reporter(call as IdempotencyCall<unknown>, mode, await keyHashOf(key));

  let scope = await call.scope();
  if (scope === undefined) {
    if (call.unscopedKeyBehavior === 'global') {
      scope = idempotencyScopes.global;
    } else if (call.unscopedKeyBehavior === 'skip') {
      reporter.decision('unscoped', IdempotencyEventNames.UnscopedKeySkipped, true);
      return call.run();
    } else if (mode === 'observe') {
      reporter.decision('unscoped', IdempotencyEventNames.WouldRejectScopeRequired);
      return call.run();
    } else {
      reporter.decision('unscoped');
      return call.reject(IdempotencyErrorCodes.ScopeRequired);
    }
  }

  const recordKey: IdempotencyRecordKey = { namespace: call.namespace, scope, key };
  const fingerprint = await call.fingerprint();
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
