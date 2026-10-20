import type { GenericBehavior } from '../mediator/mediator.js';
import type { Result } from '../result/index.js';
import { type IdempotencyBehaviorOptions, makeIdempotencyBehavior } from './behavior.js';
import { makeWithIdempotency, type WithIdempotencyOptions } from './fetch-adapter.js';
import { type IdempotentOptions, makeIdempotent } from './idempotent.js';
import { type IdempotencyDefaults, resolveTunables } from './options.js';

/** Idempotency wrappers bound to one set of global defaults and profiles. */
export interface Idempotency {
  /** The defaults this instance was created with. */
  readonly defaults: IdempotencyDefaults;
  /** `idempotent` with these defaults; `options.profile` selects a profile. */
  idempotent<A extends readonly unknown[], T>(
    fn: (...args: A) => Result<T> | Promise<Result<T>>,
    options: IdempotentOptions<A>,
  ): (...args: A) => Promise<Result<T>>;
  /** `idempotencyBehavior` with these defaults; `forRequest` and `profile` select profiles. */
  idempotencyBehavior(options?: IdempotencyBehaviorOptions): GenericBehavior;
  /** `withIdempotency` with these defaults; `options.profile` selects a profile. */
  withIdempotency<A extends readonly unknown[]>(
    handler: (request: Request, ...rest: A) => Response | Promise<Response>,
    options?: WithIdempotencyOptions,
  ): (request: Request, ...rest: A) => Promise<Response>;
}

/**
 * One entry point per application: the store, mode, durations and observers are set once and
 * every wrapper created from the instance inherits them. Precedence: call > route or request
 * type > profile > these defaults.
 *
 * ```ts
 * const idem = createIdempotency({
 *   store,
 *   mode: () => flags.idempotencyMode,
 *   profiles: { payments: { serverErrorRetentionMs: 86_400_000 } },
 * });
 * const capture = idem.idempotent(capturePayment, { namespace: 'capture', key, scope, profile: 'payments' });
 * const behavior = idem.idempotencyBehavior({ forRequest: { CapturePayment: { mode: 'observe' } } });
 * const route = idem.withIdempotency(createOrder, { scope: (req) => scopeOf(req) });
 * ```
 *
 * Throws when the defaults (or any profile merged over them) are out of range.
 */
export function createIdempotency(defaults: IdempotencyDefaults): Idempotency {
  // Fail at setup: the defaults alone and every profile over them must be in range. The store
  // may still be given per wrapper.
  resolveTunables([defaults]);
  for (const profile of Object.values(defaults.profiles ?? {}))
    resolveTunables([profile, defaults]);
  return {
    defaults,
    idempotent: (fn, options) => makeIdempotent(fn, options, defaults),
    idempotencyBehavior: (options = {}) => makeIdempotencyBehavior(options, defaults),
    withIdempotency: (handler, options = {}) => makeWithIdempotency(handler, options, defaults),
  };
}
