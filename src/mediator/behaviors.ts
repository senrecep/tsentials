import { type AppError, Err, ErrorMetadata, ErrorType } from '../errors/index.js';
import { safeString } from '../errors/safe-string.js';
import { isAbortError, isCallerAbort, Result, throwIfAborted } from '../result/index.js';
import type { GenericBehavior, NextHandler, RequestContext } from './mediator.js';
import { formatDuration, type ResourceLock } from './resource-lock.js';

// ---------------------------------------------------------------------------
// Logging abstraction
// ---------------------------------------------------------------------------

/** Log levels used by the behaviors (a subset of the common log levels). */
export type MediatorLogLevel = 'debug' | 'information' | 'warning';

/** Minimal structured logger. `properties` holds the message-template values. */
export interface MediatorLogger {
  log(
    level: MediatorLogLevel,
    message: string,
    properties: Readonly<Record<string, unknown>>,
  ): void;
  /** Defaults to enabled. Checked before a message (and any payload JSON) is built. */
  isEnabled?(level: MediatorLogLevel): boolean;
}

function enabled(logger: MediatorLogger, level: MediatorLogLevel): boolean {
  return logger.isEnabled?.(level) ?? true;
}

/**
 * JSON for log messages that never throws: BigInt values are written as decimal strings;
 * anything `JSON.stringify` still rejects (circular references, throwing `toJSON`) falls
 * back to `String(value)`, then to a placeholder.
 */
function safeLogJson(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)) ??
      'null'
    );
  } catch {
    return safeString(value);
  }
}

/** Any abort-like error counts as a cancellation, whoever aborted; these behaviors rethrow it. */
function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  return isAbortError(error) || isCallerAbort(error, signal);
}

// ---------------------------------------------------------------------------
// Exception handling
// ---------------------------------------------------------------------------

/**
 * Converts anything the rest of the pipeline throws into a failed Result with
 * `Err.fromException(error)`. Abort errors always propagate.
 */
export function exceptionHandlingBehavior(): GenericBehavior {
  return async <TReq, TRes>(
    _request: TReq,
    next: NextHandler<TReq, TRes>,
    context: RequestContext,
  ): Promise<Result<TRes>> => {
    try {
      return await next();
    } catch (error) {
      if (isCancellation(error, context.signal)) throw error;
      return Result.failure(Err.fromException(error));
    }
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** How validation failures are handled. */
export type ValidationMode = 'enforce' | 'logOnly' | 'off';

type ValidateFn<T> = (
  request: T,
  signal: AbortSignal | undefined,
) => Result<unknown> | Promise<Result<unknown>>;

/**
 * A request validator: a function, a `Rule<T>` from
 * `tsentials/rules` qualifies: or an object with an `order`. Validators with a lower
 * order run first; validators with the same order run concurrently. Default order 0.
 */
export type RequestValidator<T> =
  | ValidateFn<T>
  | { readonly order?: number | undefined; readonly validate: ValidateFn<T> };

/** What a {@link ValidationFailureObserver} receives. */
export interface ValidationFailure<T = unknown> {
  readonly requestName: string;
  readonly request: T;
  /** Errors in validator order. */
  readonly errors: readonly AppError[];
  /** `'enforce'` or `'logOnly'`. */
  readonly mode: ValidationMode;
}

/**
 * Receives every validation failure, in enforce and log-only mode
 *. Observers run in registration order; an observer
 * that throws fails the request.
 */
export type ValidationFailureObserver = (
  failure: ValidationFailure,
  signal: AbortSignal | undefined,
) => void | Promise<void>;

/** Options of {@link validationBehavior}. */
export interface ValidationBehaviorOptions {
  readonly observers?: readonly ValidationFailureObserver[] | undefined;
  /** Mode for requests without a `validationMode` property. Default `'enforce'`. */
  readonly defaultMode?: ValidationMode | undefined;
}

const VALIDATION_MODES: readonly unknown[] = ['enforce', 'logOnly', 'off'];

function modeOf(request: unknown, fallback: ValidationMode): ValidationMode {
  if (typeof request === 'object' && request !== null && 'validationMode' in request) {
    const mode = (request as { validationMode: unknown }).validationMode;
    if (VALIDATION_MODES.includes(mode)) return mode as ValidationMode;
  }
  return fallback;
}

async function runSafe<T>(
  validate: ValidateFn<T>,
  request: T,
  signal: AbortSignal | undefined,
): Promise<Result<unknown>> {
  try {
    return await validate(request, signal);
  } catch (error) {
    if (isCancellation(error, signal)) throw error;
    return Result.failure(Err.fromException(error, ErrorType.Failure, 'Validator.Exception'));
  }
}

function dedupe(errors: readonly AppError[]): AppError[] {
  const out: AppError[] = [];
  for (const error of errors) {
    if (!out.some((e) => Err.equals(e, error))) out.push(error);
  }
  return out;
}

/**
 * Runs the validators before the handler.
 *
 * - The signal is checked first; abort errors from validators propagate.
 * - Mode comes from `request.validationMode` when present, else `defaultMode`.
 *   `'off'` (or no validators) skips validation.
 * - Validators are grouped by `order` (ascending). Groups run one after another; validators in
 *   a group run concurrently. Errors keep group order and duplicates (`Err.equals`) are
 *   removed. A single validator's errors are returned as-is.
 * - A throwing validator yields `Err.fromException(e, Failure, 'Validator.Exception')`.
 * - On failure the observers run, then `'logOnly'` continues and `'enforce'` returns
 *   `Result.failure(errors)` without calling the handler.
 */
export function validationBehavior<TReq>(
  validators: readonly RequestValidator<TReq>[],
  options: ValidationBehaviorOptions = {},
): <TRes>(
  request: TReq,
  next: NextHandler<TReq, TRes>,
  context: RequestContext,
) => Promise<Result<TRes>> {
  const normalized = validators.map((v) =>
    typeof v === 'function'
      ? { order: 0, validate: v }
      : { order: v.order ?? 0, validate: v.validate },
  );
  const orders = [...new Set(normalized.map((v) => v.order))].sort((a, b) => a - b);
  const groups = orders.map((o) => normalized.filter((v) => v.order === o).map((v) => v.validate));
  const observers = [...(options.observers ?? [])];
  const defaultMode = options.defaultMode ?? 'enforce';

  const validate = async (
    request: TReq,
    signal: AbortSignal | undefined,
  ): Promise<AppError[] | undefined> => {
    const only = groups.length === 1 && groups[0]?.length === 1 ? groups[0][0] : undefined;
    if (only !== undefined) {
      const result = await runSafe(only, request, signal);
      return result.ok ? undefined : [...result.errors];
    }
    const all: AppError[] = [];
    for (const group of groups) {
      const results = await Promise.all(group.map((v) => runSafe(v, request, signal)));
      for (const r of results) {
        if (!r.ok) all.push(...r.errors);
      }
    }
    const errors = dedupe(all);
    return errors.length === 0 ? undefined : errors;
  };

  return async <TRes>(
    request: TReq,
    next: NextHandler<TReq, TRes>,
    context: RequestContext,
  ): Promise<Result<TRes>> => {
    throwIfAborted(context.signal);
    const mode = modeOf(request, defaultMode);
    if (mode === 'off' || groups.length === 0) return next();

    const errors = await validate(request, context.signal);
    if (errors === undefined) return next();

    if (observers.length > 0) {
      const failure: ValidationFailure = {
        requestName: context.requestName,
        request,
        errors: Object.freeze([...errors]),
        mode,
      };
      for (const observer of observers) await observer(failure, context.signal);
    }

    if (mode === 'logOnly') return next();
    return Result.failureFrom<TRes>(errors);
  };
}

/** Options of {@link loggingValidationFailureObserver}. */
export interface LoggingValidationFailureObserverOptions {
  /** Counter hook, called once per failure. */
  readonly count?:
    | ((tags: { readonly request: string; readonly mode: string }) => void)
    | undefined;
}

function modeTag(mode: ValidationMode): string {
  return mode === 'logOnly' ? 'log_only' : mode === 'off' ? 'off' : 'enforce';
}

/**
 * Default observer: counts the failure and logs it,
 * at `warning` for log-only mode and at `debug` for enforce mode (the caller already gets
 * the errors). Without a logger only the counter runs.
 */
export function loggingValidationFailureObserver(
  logger?: MediatorLogger,
  options: LoggingValidationFailureObserverOptions = {},
): ValidationFailureObserver {
  return (failure) => {
    const mode = modeTag(failure.mode);
    options.count?.({ request: failure.requestName, mode });
    const level: MediatorLogLevel = failure.mode === 'logOnly' ? 'warning' : 'debug';
    if (logger === undefined || !enabled(logger, level)) return;
    const codes = failure.errors.map((e) => e.code).join(', ');
    logger.log(
      level,
      `Validation of ${failure.requestName} failed in ${mode} mode with ${failure.errors.length} error(s): ${codes}`,
      {
        RequestName: failure.requestName,
        ValidationMode: mode,
        ErrorCount: failure.errors.length,
        ErrorCodes: codes,
      },
    );
  };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/** Options of {@link loggingBehavior}. */
export interface LoggingBehaviorOptions {
  readonly logger: MediatorLogger;
  /** Log the request as JSON. Default `false`. */
  readonly logRequest?:
    | boolean
    | ((request: unknown, context: RequestContext) => boolean)
    | undefined;
  /** Log the result as JSON. Default `false`. */
  readonly logResponse?:
    | boolean
    | ((request: unknown, context: RequestContext) => boolean)
    | undefined;
  /** Name used in "Handled {ResponseName} response". Default `'Result'`. */
  readonly responseName?: ((context: RequestContext) => string) | undefined;
  /** Clock in milliseconds. Default `performance.now`. */
  readonly now?: (() => number) | undefined;
}

function flag(
  option: boolean | ((request: unknown, context: RequestContext) => boolean) | undefined,
  request: unknown,
  context: RequestContext,
): boolean {
  return typeof option === 'function' ? option(request, context) : option === true;
}

/**
 * Logs the request, the response and the elapsed time at `information` level
 *. Nothing is logged after the request when the pipeline throws.
 */
export function loggingBehavior(options: LoggingBehaviorOptions): GenericBehavior {
  const { logger } = options;
  const now = options.now ?? (() => performance.now());
  // A throwing logger (or `isEnabled`) never fails the request: logging is best effort.
  const infoEnabled = (): boolean => {
    try {
      return enabled(logger, 'information');
    } catch {
      return false;
    }
  };
  const info = (message: string, properties: Record<string, unknown>): void => {
    if (!infoEnabled()) return;
    try {
      logger.log('information', message, properties);
    } catch {
      // Ignored: see above.
    }
  };

  return async <TReq, TRes>(
    request: TReq,
    next: NextHandler<TReq, TRes>,
    context: RequestContext,
  ): Promise<Result<TRes>> => {
    const requestName = context.requestName;
    const responseName = options.responseName?.(context) ?? 'Result';
    const start = now();

    if (flag(options.logRequest, request, context)) {
      if (infoEnabled()) {
        const requestJson = safeLogJson(request);
        info(`Handling ${requestName} request: ${requestJson}`, {
          RequestName: requestName,
          RequestJson: requestJson,
        });
      }
    } else {
      info(`Handling ${requestName} request`, { RequestName: requestName });
    }

    const response = await next();

    if (flag(options.logResponse, request, context)) {
      if (infoEnabled()) {
        const responseJson = safeLogJson(response);
        info(`Handled ${responseName} response: ${responseJson}`, {
          ResponseName: responseName,
          ResponseJson: responseJson,
        });
      }
    } else {
      info(`Handled ${responseName} response`, { ResponseName: responseName });
    }

    const elapsedMs = now() - start;
    info(`Request ${requestName} took ${formatDuration(elapsedMs)}`, {
      RequestName: requestName,
      ElapsedTime: elapsedMs,
    });
    return response;
  };
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

/** Cache settings of a request. */
export interface CacheSettings {
  readonly cacheKey: string;
  readonly bypassCache?: boolean | undefined;
  readonly cacheFailures?: boolean | undefined;
  /** Absolute expiration relative to now, in milliseconds. Ignored unless greater than 0. */
  readonly expirationMs?: number | undefined;
}

/** Async string cache. */
export interface CacheStore {
  get(key: string, signal?: AbortSignal): Promise<string | null | undefined>;
  set(
    key: string,
    value: string,
    options: { readonly expirationMs?: number | undefined },
    signal?: AbortSignal,
  ): Promise<void>;
}

/** Converts results to and from cache entries. */
export interface ResultSerializer {
  serialize(result: Result<unknown>): string;
  /** Returns `undefined` when the text is not a serialized result. */
  deserialize(text: string): Result<unknown> | undefined;
}

const errorFactories: Readonly<
  Record<ErrorType, (code: string, description: string, metadata?: ErrorMetadata) => AppError>
> = {
  Failure: Err.failure,
  Unexpected: Err.unexpected,
  Validation: Err.validation,
  Conflict: Err.conflict,
  NotFound: Err.notFound,
  Unauthorized: Err.unauthorized,
  Forbidden: Err.forbidden,
  Unknown: Err.unknown,
};

function reviveError(raw: unknown): AppError | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { code, description, type, metadata } = raw as Record<string, unknown>;
  if (typeof code !== 'string' || typeof description !== 'string') return undefined;
  const factory = errorFactories[type as ErrorType];
  if (factory === undefined) return undefined;
  return typeof metadata === 'object' && metadata !== null
    ? factory(code, description, ErrorMetadata.fromRecord(metadata as Record<string, unknown>))
    : factory(code, description);
}

/**
 * Default serializer: JSON of `{ ok, value }` / `{ ok, errors }` (errors in the AppError wire
 * shape); errors are rebuilt with the `Err` factory of their type.
 */
export const jsonResultSerializer: ResultSerializer = {
  serialize: (result) => JSON.stringify(result),
  deserialize: (text) => {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { ok, value, errors } = parsed as Record<string, unknown>;
    if (ok === true) return Result.success(value);
    if (ok !== false || !Array.isArray(errors) || errors.length === 0) return undefined;
    const revived = errors.map(reviveError);
    if (revived.some((e) => e === undefined)) return undefined;
    return Result.failureFrom(revived as AppError[]);
  },
};

function defaultCacheSettings(request: unknown): CacheSettings | undefined {
  if (typeof request !== 'object' || request === null) return undefined;
  const r = request as Partial<Record<keyof CacheSettings, unknown>>;
  if (typeof r.cacheKey !== 'string') return undefined;
  return {
    cacheKey: r.cacheKey,
    bypassCache: r.bypassCache === true,
    cacheFailures: r.cacheFailures === true,
    expirationMs: typeof r.expirationMs === 'number' ? r.expirationMs : undefined,
  };
}

/** Options of {@link cachingBehavior}. */
export interface CachingBehaviorOptions {
  readonly cache: CacheStore;
  readonly logger?: MediatorLogger | undefined;
  readonly serializer?: ResultSerializer | undefined;
  /**
   * Cache settings of a request; `undefined` skips caching. Default: reads `cacheKey`,
   * `bypassCache`, `cacheFailures` and `expirationMs` from the request object.
   */
  readonly settings?:
    | ((request: unknown, context: RequestContext) => CacheSettings | undefined)
    | undefined;
}

/**
 * Caches results by key. A non-empty cache entry short-circuits the
 * handler; an entry that does not deserialize to a result throws
 * `Failed to deserialize cached value for key {key}`. Failed results are not stored unless
 * `cacheFailures` is set.
 */
export function cachingBehavior(options: CachingBehaviorOptions): GenericBehavior {
  const { cache, logger } = options;
  const serializer = options.serializer ?? jsonResultSerializer;
  const settingsOf = options.settings ?? defaultCacheSettings;
  const info = (message: string, key: string): void => {
    // A throwing logger never fails the request: logging is best effort.
    try {
      if (logger !== undefined && enabled(logger, 'information')) {
        logger.log('information', message, { CacheKey: key });
      }
    } catch {
      // Ignored: see above.
    }
  };

  return async <TReq, TRes>(
    request: TReq,
    next: NextHandler<TReq, TRes>,
    context: RequestContext,
  ): Promise<Result<TRes>> => {
    const settings = settingsOf(request, context);
    if (settings === undefined || settings.bypassCache === true) return next();
    const key = settings.cacheKey;

    const cached = await cache.get(key, context.signal);
    if (cached !== null && cached !== undefined && cached.length > 0) {
      info(`Cache hit for key ${key}`, key);
      const result = serializer.deserialize(cached);
      if (result === undefined) {
        throw new Error(`Failed to deserialize cached value for key ${key}`);
      }
      return result as Result<TRes>;
    }

    info(`Cache miss for key ${key}`, key);
    const result = await next();
    if (settings.cacheFailures !== true && !result.ok) return result;

    const expirationMs = settings.expirationMs;
    await cache.set(
      key,
      serializer.serialize(result),
      expirationMs !== undefined && expirationMs > 0 ? { expirationMs } : {},
      context.signal,
    );
    info(`Cache set for key ${key}`, key);
    return result;
  };
}

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

/** Lock settings of a request. */
export interface LockSettings {
  readonly key: string;
  /** Maximum wait in milliseconds; `undefined` waits until the request is aborted. */
  readonly timeoutMs?: number | undefined;
}

/** Options of {@link lockBehavior}. */
export interface LockBehaviorOptions {
  /** Default: reads `lockKey` and `lockTimeoutMs` from the request object. */
  readonly settings?:
    | ((request: unknown, context: RequestContext) => LockSettings | undefined)
    | undefined;
  /** Receives a `warning` when releasing the lock throws. Without it the error is dropped. */
  readonly logger?: MediatorLogger | undefined;
}

function defaultLockSettings(request: unknown): LockSettings | undefined {
  if (typeof request !== 'object' || request === null) return undefined;
  const { lockKey, lockTimeoutMs } = request as { lockKey?: unknown; lockTimeoutMs?: unknown };
  if (typeof lockKey !== 'string') return undefined;
  return { key: lockKey, timeoutMs: typeof lockTimeoutMs === 'number' ? lockTimeoutMs : undefined };
}

/**
 * Runs the rest of the pipeline while holding the lock for the request's key
 *; requests without lock settings pass through. The lock is released
 * when the pipeline settles, also when it throws; an error thrown by the release itself is
 * logged (`options.logger`) and never masks the handler's result or error. A lock that is
 * not acquired in time throws
 * `LockTimeoutError`. Place it before the transaction behavior for process locks
 * or after it for transaction-scoped locks.
 */
export function lockBehavior(
  resourceLock: ResourceLock,
  options: LockBehaviorOptions = {},
): GenericBehavior {
  const settingsOf = options.settings ?? defaultLockSettings;
  return async <TReq, TRes>(
    request: TReq,
    next: NextHandler<TReq, TRes>,
    context: RequestContext,
  ): Promise<Result<TRes>> => {
    const settings = settingsOf(request, context);
    if (settings === undefined) return next();
    const handle = await resourceLock.acquire(settings.key, settings.timeoutMs, context.signal);
    try {
      return await next();
    } finally {
      // A failing release must not replace the handler's result or its original error.
      try {
        await handle.release();
      } catch (releaseError) {
        // The logger is guarded too, so the handler's result or error always wins.
        try {
          const { logger } = options;
          if (logger !== undefined && enabled(logger, 'warning')) {
            logger.log('warning', `Releasing the lock '${settings.key}' failed`, {
              LockKey: settings.key,
              RequestName: context.requestName,
              Exception: releaseError,
            });
          }
        } catch {
          // Ignored: logging the release failure is best effort.
        }
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

/** Runs work in a transaction. */
export interface TransactionRunner {
  /**
   * Runs `work` in a transaction and commits when `shouldCommit(result)` is true;
   * rolls back otherwise and when `work` throws.
   */
  execute<T>(
    work: (signal: AbortSignal | undefined) => Promise<T>,
    shouldCommit: (result: T) => boolean,
    signal: AbortSignal | undefined,
  ): Promise<T>;
}

/** Options of {@link transactionBehavior}. */
export interface TransactionBehaviorOptions {
  /** Default: `request.transactional === true`. */
  readonly isTransactional?: ((request: unknown, context: RequestContext) => boolean) | undefined;
}

function defaultIsTransactional(request: unknown): boolean {
  return (
    typeof request === 'object' &&
    request !== null &&
    (request as { transactional?: unknown }).transactional === true
  );
}

/**
 * Runs transactional requests through `runner`. The transaction
 * commits unless the result is a failure or the pipeline throws. The runner's signal is
 * passed down the pipeline.
 */
export function transactionBehavior(
  runner: TransactionRunner,
  options: TransactionBehaviorOptions = {},
): GenericBehavior {
  const isTransactional = options.isTransactional ?? defaultIsTransactional;
  return <TReq, TRes>(
    request: TReq,
    next: NextHandler<TReq, TRes>,
    context: RequestContext,
  ): Promise<Result<TRes>> => {
    if (!isTransactional(request, context)) return next();
    return runner.execute(
      (signal) => next(request, signal),
      (result) => result.ok,
      context.signal,
    );
  };
}
