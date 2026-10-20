import { jsonResultSerializer, type ResultSerializer } from '../mediator/behaviors.js';
import type { GenericBehavior, NextHandler, RequestContext } from '../mediator/mediator.js';
import { Result } from '../result/index.js';
import { fingerprintOf } from './encoding.js';
import { runPreparedIdempotent } from './engine.js';
import { idempotencyErrors } from './errors.js';
import { isValidIdempotencyKey } from './keys.js';
import {
  type IdempotencyDefaults,
  type IdempotencySettings,
  profileOf,
  type ResolvedIdempotencySettings,
  resolveSettings,
  type UnscopedKeyBehavior,
} from './options.js';
import { replayResult, resultCompletion } from './result-policy.js';
import { type IdempotencyScope, idempotencyScopes } from './scopes.js';

/** Idempotency settings of one request. */
export interface IdempotencyRequestSettings {
  /** The key; `undefined` runs the request without idempotency. */
  readonly key: string | undefined;
  /** Whose key it is; `null` or `undefined` applies `unscopedKeyBehavior`. */
  readonly scope?: IdempotencyScope | null | undefined;
  /** Overrides the retention of this request. */
  readonly retentionMs?: number | undefined;
  /** Overrides the lease of this request. */
  readonly leaseMs?: number | undefined;
  /** Value whose hash detects a reused key. Default: the request. */
  readonly fingerprint?: unknown;
}

/** Settings of one request type, given in `forRequest`. */
export interface IdempotencyRequestTypeSettings extends IdempotencySettings {
  /** Profile of the `createIdempotency` defaults; replaces the behavior's `profile`. */
  readonly profile?: string | undefined;
  /** Default: the request name. */
  readonly namespace?: string | undefined;
  readonly unscopedKeyBehavior?: UnscopedKeyBehavior | undefined;
  /** Releases failures of this request type instead of storing them. */
  readonly releaseFailures?: boolean | undefined;
  /** Replaces the behavior's `reviveScopeJson` for this request type. */
  readonly reviveScopeJson?: boolean | undefined;
}

/** Options of {@link idempotencyBehavior}. */
export interface IdempotencyBehaviorOptions extends IdempotencySettings {
  /**
   * Idempotency settings of a request; `undefined` passes it through. Default: reads
   * `idempotencyKey`, `idempotencyScope`, `idempotencyRetentionMs` and `idempotencyLeaseMs`
   * from the request object. These fields are trusted: set them in server code (the scope from
   * the authenticated principal) and never copy them from client input, or pass a `settings`
   * function that reads the scope from a trusted source.
   */
  readonly settings?:
    | ((request: unknown, context: RequestContext) => IdempotencyRequestSettings | undefined)
    | undefined;
  /** Settings per request name. Precedence: request > request type > profile > global. */
  readonly forRequest?: Readonly<Record<string, IdempotencyRequestTypeSettings>> | undefined;
  /** Profile of the `createIdempotency` defaults for every request type. */
  readonly profile?: string | undefined;
  /** What a key without a scope does. Default: `reject` (`Idempotency.ScopeRequired`). */
  readonly unscopedKeyBehavior?: UnscopedKeyBehavior | undefined;
  /**
   * Whether a failure is released (a retry runs the handler again) instead of stored.
   * Default: `request.transactional === true`, since its transaction rolled back.
   */
  readonly releaseFailures?: ((request: unknown, context: RequestContext) => boolean) | undefined;
  /** Default: `jsonResultSerializer`. */
  readonly serializer?: ResultSerializer | undefined;
  /**
   * Lets the default reader rebuild `idempotencyScope` from its JSON form
   * (`idempotencyScopes.fromJSON`), for requests that were queued or sent across processes.
   * Default: `false`, so only an `IdempotencyScope` is accepted and a plain object copied from
   * client input cannot select another owner's records. Enable it only for request types whose
   * serialized form comes from your own code. A custom `settings` function ignores it.
   */
  readonly reviveScopeJson?: boolean | undefined;
}

function defaultRequestSettings(request: unknown): IdempotencyRequestSettings | undefined {
  if (typeof request !== 'object' || request === null) return undefined;
  const r = request as {
    idempotencyKey?: unknown;
    idempotencyScope?: unknown;
    idempotencyRetentionMs?: unknown;
    idempotencyLeaseMs?: unknown;
  };
  if (typeof r.idempotencyKey !== 'string') return undefined;
  return {
    key: r.idempotencyKey,
    // Checked when the call resolves, so a raw string or a malformed value is rejected
    // instead of being treated as "no scope".
    scope: r.idempotencyScope as IdempotencyScope | null | undefined,
    retentionMs:
      typeof r.idempotencyRetentionMs === 'number' ? r.idempotencyRetentionMs : undefined,
    leaseMs: typeof r.idempotencyLeaseMs === 'number' ? r.idempotencyLeaseMs : undefined,
  };
}

function defaultReleaseFailures(request: unknown): boolean {
  return (
    typeof request === 'object' &&
    request !== null &&
    (request as { transactional?: unknown }).transactional === true
  );
}

/** @internal Shared by `idempotencyBehavior` and `createIdempotency`. */
export function makeIdempotencyBehavior(
  options: IdempotencyBehaviorOptions,
  defaults: IdempotencyDefaults | undefined,
): GenericBehavior {
  const settingsOf = options.settings ?? defaultRequestSettings;
  const releaseFailuresOf = options.releaseFailures ?? defaultReleaseFailures;
  const serializer = options.serializer ?? jsonResultSerializer;
  const forRequest = options.forRequest ?? {};

  // A profile sits right below the settings that name it; a request type's profile replaces
  // the behavior's profile.
  const layersOf = (typeSettings: IdempotencyRequestTypeSettings | undefined) =>
    typeSettings?.profile === undefined
      ? [typeSettings, options, profileOf(defaults, options.profile), defaults]
      : [typeSettings, profileOf(defaults, typeSettings.profile), options, defaults];

  // Fail at setup: the behavior and every request type must resolve to valid settings.
  const base = resolveSettings(layersOf(undefined));
  const perType = new Map<string, ResolvedIdempotencySettings>();
  for (const [name, typeSettings] of Object.entries(forRequest)) {
    perType.set(name, resolveSettings(layersOf(typeSettings)));
  }

  return async <TReq, TRes>(
    request: TReq,
    next: NextHandler<TReq, TRes>,
    context: RequestContext,
  ): Promise<Result<TRes>> => {
    const name = context.requestName;
    const typeSettings = Object.hasOwn(forRequest, name) ? forRequest[name] : undefined;
    const typeResolved = perType.get(name) ?? base;
    const run = () => next();

    return runPreparedIdempotent<Result<TRes>>(
      { settings: typeResolved, source: 'mediator', target: name, signal: context.signal },
      () => {
        const requestSettings = settingsOf(request, context);
        if (requestSettings === undefined || requestSettings.key === undefined) return undefined;
        const { key, scope, retentionMs, leaseMs } = requestSettings;
        if (!isValidIdempotencyKey(key)) {
          throw new TypeError(
            `idempotencyBehavior: the key of '${name}' is not a valid idempotency key`,
          );
        }
        const settings =
          retentionMs === undefined && leaseMs === undefined
            ? typeResolved
            : resolveSettings([{ retentionMs, leaseMs }, ...layersOf(typeSettings)]);
        const revive =
          options.settings === undefined &&
          (typeSettings?.reviveScopeJson ?? options.reviveScopeJson ?? false);
        const policy = {
          releaseFailures: typeSettings?.releaseFailures ?? releaseFailuresOf(request, context),
          serializer,
        };

        return {
          settings,
          source: 'mediator',
          target: name,
          namespace: typeSettings?.namespace ?? name,
          unscopedKeyBehavior:
            typeSettings?.unscopedKeyBehavior ?? options.unscopedKeyBehavior ?? 'reject',
          signal: context.signal,
          key: () => key,
          scope: () => (revive && scope != null ? idempotencyScopes.fromJSON(scope) : scope),
          fingerprint: () =>
            fingerprintOf('fingerprint' in requestSettings ? requestSettings.fingerprint : request),
          // A lease signal replaces the context signal for the rest of the pipeline.
          run: async (signal) => (signal === undefined ? next() : next(undefined, signal)),
          complete: (result) => resultCompletion(result, policy, settings),
          replay: (payload) => replayResult<TRes>(payload, serializer),
          reject: (code) =>
            Result.failure<TRes>(idempotencyErrors.forCode(code, settings.retryAfterMs)),
        };
      },
      run,
    );
  };
}

/**
 * Mediator behavior: a request with an idempotency key runs its handler once; later requests
 * with the same key get the same result.
 *
 * ```ts
 * const mediator = createMediator<Requests>({
 *   behaviors: [
 *     validationBehavior(...),
 *     idempotencyBehavior({ store, forRequest: { CapturePayment: { profile: 'payments' } } }),
 *     lockBehavior(locks),
 *     transactionBehavior(runner),
 *   ],
 * });
 * await mediator.send('CapturePayment', { orderId, idempotencyKey, idempotencyScope });
 * ```
 *
 * Place it after validation and before lock and transaction behaviors.
 *
 * - The namespace is the request name (`forRequest[name].namespace` overrides it).
 * - A key without a scope → Validation `Idempotency.ScopeRequired` (the key comes from code,
 *   so a missing scope is a bug). `unscopedKeyBehavior` changes this.
 * - Running request with the same key → Conflict `Idempotency.InFlight`; same key with
 *   another request → Validation `Idempotency.KeyReused`.
 * - A failure of a transactional request is released (its work was rolled back), so a retry
 *   runs it again; other failures are stored (`Unexpected` ones for `serverErrorRetentionMs`).
 * - A handler that throws or is aborted keeps the key in flight until the lease ends.
 * - With a store that has `extend` (the built-in stores do), the lease is extended while the
 *   handler runs, and in `enforce` the handler's `ctx.signal` is a new signal that also aborts
 *   (reason name `ReservationLost`) when the reservation is lost. A handler that then throws
 *   that reason or an abort-like error (without a caller abort) gets Unexpected
 *   `Idempotency.ReservationLost` and the key is released, so a retry runs it again; any other
 *   error is rethrown. A failure result after the loss is released, not stored.
 * - An invalid key or out-of-range request duration throws (`TypeError` / `RangeError`) in
 *   `enforce`; `observe` logs it (`Idempotency.Observe.ResolutionFailed`) and runs the handler
 *   without idempotency, as it does when `settings` or `releaseFailures` throws.
 *
 * Throws at setup when no store is given, a duration is out of range or a profile is unknown.
 */
export function idempotencyBehavior(options: IdempotencyBehaviorOptions): GenericBehavior {
  return makeIdempotencyBehavior(options, undefined);
}
