import {
  type IdempotencyErrorCode,
  IdempotencyErrorCodes,
  IdempotencyEventNames,
} from './constants.js';
import { sha256Hex } from './encoding.js';
import {
  type IdempotencyDecision,
  type IdempotencyMode,
  type IdempotencySource,
  MAX_LEASE_MS,
  type ResolvedIdempotencySettings,
  type UnscopedKeyBehavior,
} from './options.js';
import { type IdempotencyScope, idempotencyScopes, scopeStorageValue } from './scopes.js';
import type { IdempotencyRecordKey, IdempotencyReservation, IdempotencyStore } from './store.js';

/**
 * Abort reason of the lease signal in `enforce` mode: the store's `extend` returned `false`, no
 * `extend` succeeded before the lease ran out, or the lease reached `MAX_LEASE_MS`; the
 * reservation may belong to another call by now. `name` is `'ReservationLost'`. When the handler
 * rejects after the loss (with this reason or any other error) and the caller did not abort, the
 * engine releases the reservation and answers with `Idempotency.ReservationLost` instead of
 * rejecting. `cause` holds the last error `extend` threw, if any.
 */
export class IdempotencyReservationLostError extends Error {
  override readonly name = 'ReservationLost';
  constructor(options?: ErrorOptions) {
    super('The idempotency reservation was lost: its lease could not be extended.', options);
  }
}

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
  /** The scope; `null` or `undefined` applies `unscopedKeyBehavior`. */
  readonly scope: () =>
    | IdempotencyScope
    | null
    | undefined
    | Promise<IdempotencyScope | null | undefined>;
  readonly fingerprint: () => string | Promise<string>;
  /**
   * Starts the handler and returns its promise. `signal` is defined only in `enforce` mode,
   * after a reservation, when the store has `extend`: it aborts with the caller's reason or with
   * an {@link IdempotencyReservationLostError}. Otherwise it is `undefined` and the handler runs
   * exactly as without a heartbeat.
   *
   * Setup that can throw (binding the signal to the arguments) must run synchronously and the
   * handler itself inside the returned promise: a synchronous throw releases the reservation
   * and is rethrown, a rejection is the handler's.
   */
  readonly run: (signal?: AbortSignal) => Promise<O>;
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

/** The parts of a call that logging reads. */
type CallInfo = Pick<IdempotencyCall<unknown>, 'settings' | 'source' | 'target'>;

/** `keyHash` is unknown only when resolving the key itself failed. */
function logEvent(
  call: CallInfo,
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
  if (scope == null) {
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

  const recordKey: IdempotencyRecordKey = {
    namespace: call.namespace,
    scope: scopeStorageValue(scope),
    key,
  };
  return { kind: 'reserve', reporter, recordKey, fingerprint: await call.fingerprint() };
}

/**
 * Runs one call: resolve key and scope → reserve → decide → run → complete or release →
 * report. In `observe` mode every call runs the handler and gets its own output; conflicts
 * are only reported, and records it does not own are left untouched.
 */
export async function runIdempotent<O>(
  call: IdempotencyCall<O>,
  mode: IdempotencyMode = call.settings.mode(),
): Promise<O> {
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

  // Taken before `reserve`, so the first lease deadline is never later than the store's.
  const reservedAt = Date.now();
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
  const { token } = reservation;
  // Token-fenced; the result and errors are ignored, the call already has its answer.
  const releaseQuietly = async () => {
    try {
      if (await store.release(recordKey, token)) reporter.decision('released');
    } catch {
      // Ignored: the lease ends on its own.
    }
  };

  let lease: Heartbeat | undefined;
  let pending: Promise<O>;
  try {
    lease = startHeartbeat(
      store,
      recordKey,
      token,
      leaseMs,
      reservedAt,
      mode,
      call.signal,
      reporter,
    );
    pending = lease?.signal === undefined ? call.run() : call.run(lease.signal);
  } catch (error) {
    // The handler never started: the key must not stay in flight.
    lease?.stop();
    await releaseQuietly();
    throw error;
  }
  let output: O;
  try {
    output = await pending;
  } catch (error) {
    lease?.stop();
    // The reservation is gone, so the outcome cannot be recorded: release what may be left of it
    // and answer with a retryable code. A caller abort still rejects.
    if (mode === 'enforce' && lease?.lost === true && call.signal?.aborted !== true) {
      if (error !== lease.signal?.reason) {
        reporter.log('warning', IdempotencyEventNames.ReservationLost, error);
      }
      await releaseQuietly();
      return call.reject(IdempotencyErrorCodes.ReservationLost);
    }
    throw error;
  }
  lease?.stop();
  try {
    const completion = await call.complete(output);
    if (completion.action === 'store') {
      const stored = await store.complete(
        recordKey,
        token,
        fingerprint,
        completion.payload,
        completion.retentionMs,
      );
      if (stored) reporter.decision('stored');
      else if (lease?.lost !== true) {
        reporter.log('warning', IdempotencyEventNames.ReservationLost, undefined);
      }
    } else if (completion.action === 'release') {
      if (await store.release(recordKey, reservation.token)) reporter.decision('released');
    }
  } catch (error) {
    // The handler has run: its output is returned even when the record cannot be written.
    reporter.log('warning', IdempotencyEventNames.CompleteFailed, error);
  }
  return output;
}

interface Heartbeat {
  /** The signal for the handler; `undefined` in `observe`, where a lost lease only logs. */
  readonly signal: AbortSignal | undefined;
  /** Whether the lease was lost (or reached `MAX_LEASE_MS`) and that was logged. */
  readonly lost: boolean;
  /** Stops extending and aborts an `extend` in flight; later results are ignored. */
  stop(): void;
}

function unref(timer: ReturnType<typeof setTimeout>): ReturnType<typeof setTimeout> {
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

/**
 * Extends the lease every `leaseMs / 3` while the handler runs, when the store has `extend`.
 * Each beat is scheduled after the previous one settled, so a slow store never overlaps two
 * extends.
 *
 * - `extend` returns `false` → the lease is lost at once.
 * - `extend` throws → not lost yet; the next beat tries again.
 * - The lease is known to be held until `confirmedUntil`: the time taken before the last
 *   successful `extend` (or before `reserve`) plus `leaseMs`. A deadline timer fires then, so a
 *   store that keeps failing or hangs loses the lease, and its pending `extend` is aborted
 *   through the signal passed to it.
 * - `MAX_LEASE_MS` after the reservation the beats stop (`Idempotency.LeaseLimitReached`).
 *
 * A lost lease logs `ReservationLost` and, in `enforce` only, aborts the handler's signal. The
 * caller's abort does not stop the beats: the handler may still be running. Every timer is
 * cleared by `stop`, which the engine calls once the handler settled.
 */
function startHeartbeat(
  store: IdempotencyStore,
  recordKey: IdempotencyRecordKey,
  token: string,
  leaseMs: number,
  reservedAt: number,
  mode: Exclude<IdempotencyMode, 'off'>,
  caller: AbortSignal | undefined,
  reporter: Reporter,
): Heartbeat | undefined {
  const extend = store.extend;
  if (extend === undefined) return undefined;
  const controller = new AbortController();
  // Built first: it throws for a foreign signal, and nothing is scheduled yet.
  const signal =
    mode === 'observe'
      ? undefined
      : caller === undefined
        ? controller.signal
        : AbortSignal.any([caller, controller.signal]);
  const intervalMs = Math.max(1, Math.floor(leaseMs / 3));
  let confirmedUntil = reservedAt + leaseMs;
  let lastError: unknown;
  let inFlight: AbortController | undefined;
  let beatTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(beatTimer);
    clearTimeout(deadlineTimer);
    clearTimeout(limitTimer);
    inFlight?.abort();
  };
  const abortHandler = (cause: unknown) => {
    heartbeat.lost = true;
    if (mode === 'enforce') {
      controller.abort(
        new IdempotencyReservationLostError(cause === undefined ? undefined : { cause }),
      );
    }
  };
  const lose = (exception: unknown) => {
    stop();
    reporter.log('warning', IdempotencyEventNames.ReservationLost, exception);
    abortHandler(exception);
  };
  const armDeadline = () => {
    clearTimeout(deadlineTimer);
    deadlineTimer = unref(
      setTimeout(() => lose(lastError), Math.max(0, confirmedUntil - Date.now())),
    );
  };
  const beat = async () => {
    const startedAt = Date.now();
    const attempt = new AbortController();
    inFlight = attempt;
    let extended: boolean;
    try {
      extended = await extend.call(store, recordKey, token, leaseMs, attempt.signal);
    } catch (error) {
      if (stopped) return;
      inFlight = undefined;
      lastError = error;
      schedule();
      return;
    }
    if (stopped) return;
    inFlight = undefined;
    if (!extended) {
      lose(undefined);
      return;
    }
    confirmedUntil = startedAt + leaseMs;
    lastError = undefined;
    armDeadline();
    schedule();
  };
  const schedule = () => {
    beatTimer = unref(setTimeout(beat, intervalMs));
  };

  const heartbeat = { signal, lost: false, stop };
  const limitTimer = unref(
    setTimeout(
      () => {
        stop();
        reporter.log('warning', IdempotencyEventNames.LeaseLimitReached, undefined);
        abortHandler(new RangeError(`The lease was held for ${MAX_LEASE_MS} ms`));
      },
      Math.max(0, reservedAt + MAX_LEASE_MS - Date.now()),
    ),
  );
  armDeadline();
  schedule();
  return heartbeat;
}

/**
 * Runs a call whose setup can throw (request settings, key check, signal): `prepare` returns
 * the call, or `undefined` to run without idempotency. Like a resolver that throws inside the
 * engine, a throwing `prepare` rejects in `enforce` and in `observe` is logged
 * (`Idempotency.Observe.ResolutionFailed`) while `run` goes ahead without idempotency.
 */
export async function runPreparedIdempotent<O>(
  info: CallInfo & { readonly signal?: AbortSignal | undefined },
  prepare: () => IdempotencyCall<O> | undefined,
  run: () => Promise<O>,
): Promise<O> {
  const mode = info.settings.mode();
  if (mode === 'off') return run();
  let call: IdempotencyCall<O> | undefined;
  try {
    call = prepare();
  } catch (error) {
    if (mode === 'enforce' || info.signal?.aborted === true) throw error;
    logEvent(info, mode, undefined, 'warning', IdempotencyEventNames.ResolutionFailed, error);
    return run();
  }
  return call === undefined ? run() : runIdempotent(call, mode);
}
