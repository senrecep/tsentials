# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Behaviour change, Idempotency (HTTP):** `withIdempotency` now rejects a request with an `Idempotency-Key` but no scope (no `scope` option, or a resolver returning `null`/`undefined`) with 400 `Idempotency.ScopeRequired` in `enforce` mode; `observe` logs `Idempotency.Observe.WouldRejectScopeRequired` and runs the handler. Before, such a request ran without idempotency (`unscopedKeyBehavior` defaulted to `'skip'`). Pass a `scope` resolver, or `unscopedKeyBehavior: 'skip'` to keep the old behaviour; `'global'` is unchanged. `idempotent()` and `idempotencyBehavior()` already rejected by default.
- **Behaviour change, Idempotency (HTTP):** a 2xx response that `withIdempotency` cannot store (body over `maxResponseBodyBytes`, a `Content-Encoding` other than identity, or `text/event-stream`) now stores a marker for `retentionMs`, and a retry with the same key and request gets 409 `Idempotency.ResultUnavailable` without `Retry-After`; the handler does not run again. Before, the key stayed in flight (409 `Idempotency.InFlight`) until the lease ended, and a later retry ran the handler again and repeated the side effect. A 4xx is still released and 3xx/5xx still stay in flight. `idempotentRetryClassifier` never retries the new code.
- **Behaviour change, Idempotency (lease extension):** with a store that has `extend` (both built-in stores now do), the engine runs a heartbeat timer while the handler runs, so a handler that outlives `leaseMs` keeps its key in flight instead of letting a retry take it over. In `enforce` the handler gets a new signal that also aborts when the reservation is lost: the mediator's `ctx.signal` is that combined signal, and `withIdempotency` passes a rebuilt `Request` (same method, URL, headers and body; the body moves from the original object, and properties set on the original are not copied). A custom store without `extend` behaves as before.
- **Idempotency (SQL example):** `examples/idempotency-sql` now computes and compares `expires_at` with the database clock (`clock_timestamp()`) instead of the application clock, and its `clock` constructor option is removed; the contract test waits in real time with short leases. `docs/IDEMPOTENCY.md` also documents lease sizing, explicit mediator fingerprints for requests with per-retry fields, and that fingerprints are not canonicalized.

### Added

- **Idempotency:** error code `Idempotency.ResultUnavailable` (Conflict, 409, never retried; `idempotencyErrors.resultUnavailable()`) and event `Idempotency.ResponseNotReplayable`, logged as a warning when a marker is stored.
- **Idempotency:** optional store method `extend(key, token, leaseMs, signal?)`, implemented by `InMemoryIdempotencyStore`, `RedisIdempotencyStore` (script `RedisIdempotencyScripts.extend`) and the PostgreSQL example. It extends only a live, in-flight reservation that holds the token; it never revives an expired lease and never touches a completed record. `describeIdempotencyStoreContract` checks it, and passes stores without it.
- **Idempotency:** lease heartbeat. After a reservation the engine calls `extend` every `leaseMs / 3` (unref'ed timer, one call at a time) until the handler settles or the caller aborts. When `extend` returns `false` or throws, it logs `Idempotency.ReservationLost` and, in `enforce`, aborts the handler's signal with the new `IdempotencyReservationLostError` (`name` `'ReservationLost'`); `observe` only logs.
- **Idempotency:** `idempotent()` option `bindSignal(signal, ...args)` returns the arguments to call the function with, so it receives the lease signal.

## [2.0.1] - 2026-10-20

### Fixed

- **Idempotency:** `observe` no longer fails a call whose setup throws before the engine runs. In the mediator behavior this covers an invalid request key, an out-of-range request `leaseMs` / `retentionMs` and a `settings` or `releaseFailures` function that throws; in `idempotent()` a `signal` resolver that throws. `observe` logs `Idempotency.Observe.ResolutionFailed` and runs the handler without idempotency; `enforce` still throws (a throwing `signal` resolver now rejects the returned promise instead of throwing synchronously, and `off` no longer calls it).

## [2.0.0] - 2026-10-20

Adds the `tsentials/idempotency` module and idempotent HTTP client support. The minimum Node.js version is now 22 (listed under BREAKING below); runtime behaviour changes of existing APIs are explained in [docs/BEHAVIOUR-CHANGES.md](./docs/BEHAVIOUR-CHANGES.md).

### Added

- **New subpath-only module `tsentials/idempotency`** (100% coverage enforced): runs an operation once per `(namespace, scope, key)` and replays the stored outcome to later calls. Guide: [docs/IDEMPOTENCY.md](./docs/IDEMPOTENCY.md).
  - Wrappers over one engine: `idempotent(fn, options)` for functions returning `Result<T>`, `idempotencyBehavior(options)` for mediator requests and `withIdempotency(handler, options)` for Fetch API handlers (`Idempotency-Key` header, problem+json errors, `Idempotency-Replayed: true` on replays). `createIdempotency(defaults)` shares the store, mode, durations, profiles and observers.
  - Rollout modes `off`, `observe` and `enforce` (a value or a function read on every call). `observe` answers like `off` and reports `Idempotency.Observe.Would…` events; a resolver that throws in `observe` runs the call without idempotency (`Idempotency.Observe.ResolutionFailed`).
  - Error codes `Idempotency.InFlight` (Conflict, 409 + `Retry-After`), `Idempotency.KeyReused` (Validation, 422), `Idempotency.KeyMissing`, `Idempotency.KeyInvalid` and `Idempotency.ScopeRequired` (Validation, 400).
  - Stores: `InMemoryIdempotencyStore`, `RedisIdempotencyStore` over a minimal `RedisLike` client (`eval` only; Lua scripts exported as `RedisIdempotencyScripts`) and `describeIdempotencyStoreContract` for custom stores. `examples/idempotency-redis` and `examples/idempotency-sql` (a transactional PostgreSQL store) run the contract suite against real servers.
  - Keys and scopes: `idempotencyKeys` (`for`, `fromMessage`, `toUuidV5`, `canonical`), `createIdempotencyKeys`, `isValidIdempotencyKey`, `normalizeIdempotencyKey`, `idempotencyScopes`, `idempotencyStorageKey`, `fingerprintOf`, `stableStringify`. A scope is a frozen `IdempotencyScope` value that only the `idempotencyScopes` builders create (`global` included, stored as `global`); a raw string scope is a compile error and at runtime throws `TypeError` (enforce) or runs without idempotency (observe), so a raw owner id such as a tenant named `global` or `user:42` never shares another owner's records. `custom()` rejects the built-in kinds in any case and kinds with `:`, `/` or only digits; scope ids and kinds with a lone surrogate throw. Stores must compare keys byte for byte. `toJSON()` gives the tagged `IdempotencyScopeJson` form and `idempotencyScopes.fromJSON` reads it back; `idempotencyBehavior({ reviveScopeJson: true })` (or per request type) makes the mediator's default reader do this for queued requests. A `null` scope means no scope.
- **Http:** `withIdempotencyKey(init, key?, options?)`, `RequestBuilder.idempotencyKey(key?, options?)` and `idempotencyKeyValue` (`options.idempotencyKeyGenerator` replaces `crypto.randomUUID()`; a generated key is validated like an explicit one and throws `TypeError` when invalid), `idempotentRetryClassifier(method, hasKey)`, `HttpErrorMetadataKeys`, `parseRetryAfter`, `IDEMPOTENCY_KEY_HEADER`, `IDEMPOTENCY_REPLAYED_HEADER` and `IdempotencyErrorCodes`. Failed responses carry status, `Retry-After`, replay and problem code metadata (see [docs/BEHAVIOUR-CHANGES.md](./docs/BEHAVIOUR-CHANGES.md)).
- **Resilience:** `withRetry` accepts `shouldRetry(error)` (already available on `retryIfFailed`) to replace the retryable check; `withRetry` and `retryIfFailed` accept `maxRetryAfterMs` to cap a server's `Retry-After` wait.
- Agent skill `tsentials-idempotency` under `.well-known/agent-skills/`.

### Changed

#### BREAKING

- **Minimum Node.js version is now 22.** `engines.node` is `>=22.0.0`; CI runs on Node 22 and 24, publishing runs on Node 22 and `@types/node` is `^22`. The library relies on the global Web Crypto API (`crypto.subtle`, `crypto.randomUUID`) without any runtime dependency.
- **Http:** the first error of a failed `fetchResult` / `RequestBuilder` response carries the metadata `httpStatus`, `retryAfterMs`, `idempotencyReplayed` and `problemCode`. Code, type and description are unchanged, but a test that compares a whole failure with `toEqual` now also sees the metadata.
- **Resilience:** `withRetry` and `retryIfFailed` wait at least the `retryAfterMs` metadata of a failure's first error, capped by `maxRetryAfterMs` (default 30 s). A `fetchResult` failure with `Retry-After` therefore waits longer than the backoff when the server asks it to, and an `Idempotency.InFlight` failure, which carries `retryAfterMs` (default 1 000), waits at least that long unless `maxRetryAfterMs` is lower.

## [1.0.0] - 2026-10-14

First stable release. It adds five new subpath modules, cancellation support across the async APIs and a self-contained `deepClone`. It also tightens several behaviours of the 0.1.x API; every breaking change is listed below and explained in [docs/BEHAVIOUR-CHANGES.md](./docs/BEHAVIOUR-CHANGES.md).

### Added

- **New subpath-only modules** (stable, 100% statement/branch/function/line coverage enforced in `vitest.config.ts`). They are not re-exported from the root `tsentials` entry:
  - `tsentials/validation`: `Validator<T>`, `RuleContext`, `RuleChain`, `CascadeMode`. Fluent, eager, `Result`-based model validation with typed property paths, `forEach`, async rules and `toRule()`.
  - `tsentials/resilience`: `ResiliencePolicy` (retry, circuit breaker, timeout, fallback) and `retryIfFailed`.
  - `tsentials/pagination`: offset paging (`paginate`) and keyset paging (`keysetOrdering`, `keysetPaginate`, `planKeysetPage`, cursor helpers).
  - `tsentials/enums`: `defineEnum` with wire names, aliases, fallback member and `Result`-returning parse. It throws `TypeError` for ambiguous member sets (duplicate wire names, aliases colliding with names or wire names, more than one fallback member).
  - `tsentials/mediator`: `createMediator`, `pipeline` and behaviors (exception handling, validation, logging, caching, lock, transaction).
- **Time extensions** (from `tsentials/time` only): `nextDayOfWeek`, `previousDayOfWeek`, `DayOfWeek`, `getAge`, `toDateOnly`, `toTimeOnly`, `msToDate`. `DateTimeProvider` gains an optional `timeZone`; `getAge(birth, provider)` reads today in that zone (host zone for `SystemDateTimeProvider`, UTC for `createFakeDateTimeProvider`, `utcNowDate()` for a provider without `timeZone`).
- **Abort/cancellation support:** `AbortSignal` options on `Result.tryAsync`, `Result.traverseAsync`, `Result.sequenceAsync`, `Maybe.fromTryAsync`, `RuleEngine.evaluateAsync`, `fetchResult`, `RequestBuilder`, `ResiliencePolicy.execute` and `Validator.validateAsync`; a caller abort rejects with `signal.reason`. Helpers: `isAbortError`, `isCallerAbort`, `rethrowIfAborted`, `throwIfAborted`, `withAbort`, `observe` (from `tsentials/result`).
- **Result:** `Result.recoverFirst`, `Result.mapEachError`, `Result.sequenceAsync`; `Result.traverseAsync` accepts `{ concurrency, signal }` (sequential by default, results keep item order).
- **Maybe:** `Maybe.fromNullable`, `Maybe.equals`, `Maybe.equalsValue`, `Maybe.toResult`, `Maybe.toUnitResult`, `Maybe.sequence`, `Maybe.traverse`, `Maybe.partition`, `Maybe.format` (nested Maybes are formatted recursively: `Some(Some(1))`, `Some(None)`); `Maybe.fromTryAsync`; optional predicate on `tryFirst` / `tryLast`; `tryFind` on `Map` (by key) and plain objects (by own key); `choose(items, selector)`.
- **Rules:** `RuleEngine.andAll` / `andAllAsync` (collect all errors); a plain `boolean` condition for `RuleEngine.if` / `ifAsync`.
- **Http:** `httpStatusToErrorType` and `problemDetailsToErrors` (ProblemDetails `errors` parsed into one `AppError` per entry); `RequestBuilder.headers()`; `timeout` option (default 30 s, `Http.Timeout` failure) and `AbortSignal` support; `FetchResultInit` / `QueryValue` types.
- **Errors:** `Err.unknown`; non-enumerable `toJSON()` on errors created through `Err`; nested `innerException` metadata when `error.cause` is an `Error`; `errorTypeToHttpStatus` export.
- **Root entry re-exports:** `HttpCodes` (already exported from `tsentials/http`), `httpStatusToErrorType`, `problemDetailsToErrors`, `errorTypeToHttpStatus`, `drawTree`, the abort helpers, the string case helpers (`toPascalCase`, `toCamelCase`, `toKebabCase`, `toSnakeCase`, `toMacroCase`, `toTrainCase`, `toTitleCase`, `toUnderscoreCamelCase`) and the array helpers (`head`, `tail`, `last`, `init`, `isNonEmpty`, `prepend`, `append`, `asNonEmptyArray`).
- **Clone:** own recursive `deepClone` (see Changed).
- Agent skills for the five new modules under `.well-known/agent-skills/`.

### Changed

#### BREAKING

- **Result:** `ResultChain` async methods (`thenAsync`, `mapAsync`, `bindIfAsync`, `compensateFirstAsync`, ...) return `ResultAsync<T>` instead of a bare `Promise<Result<T>>`; `alwaysAsync` still returns the callback's `Promise`.
- **Result:** `Result.recover(r, match, fn)` scans ALL errors for a match (was: first error only). Use `Result.recoverFirst` for the old behaviour.
- **Result:** `Result.ensure` evaluates an error factory lazily, only when the predicate fails.
- **Result:** `resultToMaybe` and `maybeToResult` follow the Maybe null normalisation: a void success (`Result.ok()`) gives `None`.
- **Rules:** `RuleEngine.and` / `andAsync` stop at the first failing rule (was: collect all). Use `RuleEngine.andAll` / `andAllAsync` for the old behaviour.
- **Rules:** every combinator built from an empty rule list evaluates to the Validation failure `EMPTY_RULE_ARRAY` (was: `and()` / `linear()` ok, `or()` threw, `linearTyped()` returned `RuleEngine.Empty`).
- **Rules:** `andTyped` / `andTypedAsync` return the FIRST rule's value on success (was: the last).
- **Rules:** `RuleEngine.evaluate` never throws; a throwing rule becomes the failure `Rule.EvaluationFailed` (as `evaluateAsync` already did). Combinators guard each node the same way.
- **Maybe:** a `Some` never holds `null` / `undefined`. `Maybe.some(null)` is `None`, `map` / `mapIf` / `bind` / `bindIf` (and async variants) turn a nullish result into `None`, and `tryFirst` / `tryLast` / `tryFind` return `None` for a nullish element.
- **Maybe:** `Maybe.fromTry` rethrows abort errors instead of returning `None`.
- **Errors:** `Err` factories called without a code use the bare type name (`Failure`, `Unexpected`, `Validation`, `Conflict`, `NotFound`, `Unauthorized`, `Forbidden`) instead of `General.*`.
- **Errors:** `Err.fromException` defaults to `ErrorType.Failure` (was: `Unexpected`); exception details win over supplied metadata on key collision.
- **Errors:** metadata key `exceptionStack` renamed to `exceptionStackTrace`.
- **Errors:** `Err.equals` also compares metadata; absent metadata never equals present metadata.
- **Errors:** `ErrorMetadata.combine(base, additional)` keeps the value from `base` on key collision (first wins); previously the value from `additional` replaced it (last wins).
- **Http:** status mapping: 411/413/414/415/416/417 are `Validation`, 407 is `Unauthorized`, 412 is `Conflict`, 408 is `Unexpected` (>= 500 already was), any other unlisted status is `Failure`.
- **Http:** default 30 s timeout (`Http.Timeout`); a caller abort rejects with `signal.reason`.
- **Http:** a 2xx JSON response with an empty (or whitespace-only) body, or a literal `null` body, is a `NotFound` failure. 204/205 and non-JSON bodies stay void successes. `fetchResult.delete` succeeds on any 2xx without requiring a body.
- **Http:** `RequestBuilder.header()` appends values for the same name (`first, second`) instead of replacing; `Content-Type` stays single-valued. The new `headers()` behaves the same way.
- **Http:** `RequestBuilder` keeps relative URLs relative; `body(raw)` after `json(x)` drops the JSON `Content-Type`.
- **Http:** an error response whose ProblemDetails body has an `errors` extension yields one `AppError` per entry (entries without a valid `type` are `Validation`) instead of a single status-mapped error.
- **Clone:** `deepClone` no longer delegates to native `structuredClone`; it is always the self-contained recursive implementation. Functions keep their reference, symbols become `undefined`, `Error` subclasses keep their prototype and own properties, `URL` / `URLSearchParams` are cloned, and `Blob` / `File` / `Promise` / `SharedArrayBuffer` are returned by reference.

#### Other

- Version bumped to 1.0.0; the five new subpath modules are marked stable.

[Unreleased]: https://github.com/senrecep/tsentials/compare/v2.0.1...HEAD
[2.0.1]: https://github.com/senrecep/tsentials/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/senrecep/tsentials/releases/tag/v2.0.0
[1.0.0]: https://github.com/senrecep/tsentials/releases/tag/v1.0.0
