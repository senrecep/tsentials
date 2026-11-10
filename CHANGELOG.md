# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.1.0](https://github.com/senrecep/tsentials/compare/v4.0.0...v4.1.0) (2026-11-10)


### Added

* add DomainEvent timing, Ord.betweenExclusive and stack-safe Tree traversal ([#64](https://github.com/senrecep/tsentials/issues/64)) ([7142239](https://github.com/senrecep/tsentials/commit/71422398e6ca1d8a1ee25c3f1f28ef4892d0da89))
* **http:** add isBlockedAddress for SSRF checks ([#59](https://github.com/senrecep/tsentials/issues/59)) ([e66018b](https://github.com/senrecep/tsentials/commit/e66018b5e563b460330418389957e36acd5798d0))
* **http:** resolve Retry-After dates against the response Date and add route and array query values ([#61](https://github.com/senrecep/tsentials/issues/61)) ([8fa613d](https://github.com/senrecep/tsentials/commit/8fa613d7a77d9213a5a572045a3348e5dfd48b79))
* **pagination:** add a framework-agnostic keyset predicate builder ([#66](https://github.com/senrecep/tsentials/issues/66)) ([715cdba](https://github.com/senrecep/tsentials/commit/715cdbab986e9688206c6899af74b1d5c94d9f69))
* **result:** add thenEnsure, unwrapOrThrow messages and a fromException description override ([#63](https://github.com/senrecep/tsentials/issues/63)) ([b7cfb4b](https://github.com/senrecep/tsentials/commit/b7cfb4b8a812f41a943e99189a311057e5e4f824))
* **rules:** accept sync rules in async combinators and add ifTyped ([#65](https://github.com/senrecep/tsentials/issues/65)) ([9202cf6](https://github.com/senrecep/tsentials/commit/9202cf6c6e56dfae215301406371fcfcb8c9965e))


### Fixed

* **enums:** fold case like OrdinalIgnoreCase when parsing names ([#58](https://github.com/senrecep/tsentials/issues/58)) ([1ba6df9](https://github.com/senrecep/tsentials/commit/1ba6df9e9116c1c3580416786b7a965e7370a751))
* **idempotency:** read idempotencyBehavior request settings consistently and document message inboxes ([#60](https://github.com/senrecep/tsentials/issues/60)) ([f571e92](https://github.com/senrecep/tsentials/commit/f571e921aa5f8ec8186d8e9df6d93a5f4114a505))
* **union:** handle prototype property names as tags and accept iterables in Maybe helpers ([#57](https://github.com/senrecep/tsentials/issues/57)) ([9ac6e2e](https://github.com/senrecep/tsentials/commit/9ac6e2ee78bac1e5db10955307e948c6d629483a))

## [4.0.0](https://github.com/senrecep/tsentials/compare/v3.1.0...v4.0.0) (2026-11-10)


### ⚠ BREAKING CHANGES

* **http:** a ProblemDetails body with an errorCodes extension now yields AppErrors with those domain codes (for example User.NotFound) instead of a single Http.{status} error.
* **http:** idempotentRetryClassifier treats only GET, HEAD, PUT, DELETE and OPTIONS as safe. Any other method without a key is never retried, a safe method is retried on every 5xx, and 409 Idempotency.InFlight is retried only when the request had a key.
* **http:** a 2xx JSON body that cannot be parsed and a JSON request body that cannot be serialized are now Validation failures instead of Unexpected; RequestBuilder.json() no longer serializes eagerly or throws; a throwing resilience fallback now returns an Unexpected error instead of Failure.
* harden isJson, Predicate.toRule, Eq.number and record against edge cases ([#37](https://github.com/senrecep/tsentials/issues/37))
* **mediator:** cachingBehavior no longer throws on an unreadable cached entry; it logs a warning, runs the handler and overwrites the entry.
* **string:** the case converters drop every character that is not a letter, combining mark or digit as a word separator, make digit runs their own word, and split on non-ASCII uppercase and titlecase letters.
* **enums:** defineEnum throws a TypeError for a wire name or alias that is empty, contains whitespace or a comma, or starts with a digit, a sign or a dot. parse rejects '-00' style negative zero and parseNumber(-0) fails.
* **these:** These.flatMap on a Both whose continuation returns a Left now returns that Left instead of Both(originalLeft, continuationLeft).

### Added

* **enums:** validate wire name and alias format in defineEnum and reject negative zero ([#34](https://github.com/senrecep/tsentials/issues/34)) ([9abf753](https://github.com/senrecep/tsentials/commit/9abf75335b6d8b5a4bf07c7e6af104a4cc4d652d))
* **http:** add toProblemDetails and resultToResponse for problem+json responses ([#53](https://github.com/senrecep/tsentials/issues/53)) ([e6a59eb](https://github.com/senrecep/tsentials/commit/e6a59eb69a242cb19d5cf79376212f86ad2220df))
* **http:** read text and binary response bodies as Results ([#52](https://github.com/senrecep/tsentials/issues/52)) ([bd707e9](https://github.com/senrecep/tsentials/commit/bd707e92dd4991e60458ec4f2851e1e032a6b157))


### Fixed

* harden isJson, Predicate.toRule, Eq.number and record against edge cases ([#37](https://github.com/senrecep/tsentials/issues/37)) ([664a264](https://github.com/senrecep/tsentials/commit/664a26479147a6bde5b9b0c3af36b4552c4c3073))
* **http:** align idempotentRetryClassifier with the CSharpEssentials retry table ([#43](https://github.com/senrecep/tsentials/issues/43)) ([43777c8](https://github.com/senrecep/tsentials/commit/43777c82c97dafe314fcd9513e60301664b8629e))
* **http:** classify malformed 2xx JSON and request serialization failures as Validation ([#41](https://github.com/senrecep/tsentials/issues/41)) ([247feac](https://github.com/senrecep/tsentials/commit/247feac36ef4836dd2aefa3cf5959cc600791e9f))
* **http:** read the errorCodes extension in problemDetailsToErrors ([#46](https://github.com/senrecep/tsentials/issues/46)) ([1b1f1d6](https://github.com/senrecep/tsentials/commit/1b1f1d6db16b6829a0ee36e631022958026997be))
* **mediator:** run the handler when cachingBehavior cannot read a cached entry ([#36](https://github.com/senrecep/tsentials/issues/36)) ([e03022b](https://github.com/senrecep/tsentials/commit/e03022bdbe7d2e3684ab692f31e6bfc0ef5c66ce))
* **string:** split words on Unicode case, digit and punctuation boundaries in case converters ([#35](https://github.com/senrecep/tsentials/issues/35)) ([668d950](https://github.com/senrecep/tsentials/commit/668d95074ad6457d3d8a0af834e35c896172b9c9))
* **these:** return the Left from flatMap when a Both continuation fails ([#29](https://github.com/senrecep/tsentials/issues/29)) ([005f4e1](https://github.com/senrecep/tsentials/commit/005f4e1acd040ea349a12add7db11e499f848e4f))

## [3.1.0](https://github.com/senrecep/tsentials/compare/v3.0.0...v3.1.0) (2026-11-10)


### Added

* add uuidv7 and monotonicUuidv7 generators ([#38](https://github.com/senrecep/tsentials/issues/38)) ([4ac608c](https://github.com/senrecep/tsentials/commit/4ac608cded4c24f0e98545b24b569554257fe7c8))
* **errors:** add DomainError so thrown typed errors keep their AppError ([#44](https://github.com/senrecep/tsentials/issues/44)) ([df71f4f](https://github.com/senrecep/tsentials/commit/df71f4f932ff15b33d28f75c1b9b609f13bb2c82))
* **errors:** add Err.fromJSON, Result.fromJSON and Err.with ([#42](https://github.com/senrecep/tsentials/issues/42)) ([b59a805](https://github.com/senrecep/tsentials/commit/b59a80580f9891285d75befe380adc25c4d30154))
* **http:** add conditional request helpers for ETag, 304 and If-Match ([#47](https://github.com/senrecep/tsentials/issues/47)) ([4e43e0e](https://github.com/senrecep/tsentials/commit/4e43e0e63509ce49c8637d2518d3af7df172d52a))
* **maybe:** add a fluent MaybeAsync chain and Maybe.tapNoneAsync ([#40](https://github.com/senrecep/tsentials/issues/40)) ([7be612c](https://github.com/senrecep/tsentials/commit/7be612c212f124a8d5bc4f2ba366689fc456f34d))
* **validation:** accept EnumDefinition in enum validators and truncate echoed values ([#39](https://github.com/senrecep/tsentials/issues/39)) ([84b29bb](https://github.com/senrecep/tsentials/commit/84b29bb4bfa2c54f526cac10f9ce0ee9a9a994e0))


### Fixed

* **entity:** keep createEntityBaseWithId state live and export it from tsentials/entity ([#32](https://github.com/senrecep/tsentials/issues/32)) ([7989b54](https://github.com/senrecep/tsentials/commit/7989b54d2c46054bb85895645524ecd5262a5e5c))
* **errors:** compare nested error metadata by value in Err.equals ([#31](https://github.com/senrecep/tsentials/issues/31)) ([026f8ac](https://github.com/senrecep/tsentials/commit/026f8ac7aa5d2ffb4f21ebfa69ad92c2e936a9f9))
* **http:** cancel response bodies that fetchResult does not read ([#30](https://github.com/senrecep/tsentials/issues/30)) ([9d42e2c](https://github.com/senrecep/tsentials/commit/9d42e2cca1dcb3e8db22e4602e8095b5601dd01b))
* **mediator:** call Validator instances through their own methods in validationBehavior ([#33](https://github.com/senrecep/tsentials/issues/33)) ([11c608b](https://github.com/senrecep/tsentials/commit/11c608b5f048e7700fdc9e47057b1854d7b6f69f))
* **result:** warn when a sync tap or switch callback returns a promise ([#45](https://github.com/senrecep/tsentials/issues/45)) ([a51e4e8](https://github.com/senrecep/tsentials/commit/a51e4e83e5b41b711ad6841453abc935978eb6c5))

## [3.0.0] - 2026-10-20

### Changed

#### BREAKING

- **Idempotency (HTTP):** `withIdempotency` now rejects a request with an `Idempotency-Key` but no scope (no `scope` option, or a resolver returning `null`/`undefined`) with 400 `Idempotency.ScopeRequired` in `enforce` mode; `observe` logs `Idempotency.Observe.WouldRejectScopeRequired` and runs the handler. Before, such a request ran without idempotency (`unscopedKeyBehavior` defaulted to `'skip'`). Pass a `scope` resolver, or `unscopedKeyBehavior: 'skip'` to keep the old behaviour; `'global'` is unchanged. `idempotent()` and `idempotencyBehavior()` already rejected by default.
- **Idempotency (HTTP):** a 2xx response that `withIdempotency` cannot store (body over `maxResponseBodyBytes`, a `Content-Encoding` other than identity, or `text/event-stream`) now stores a marker for `retentionMs`, and a retry with the same key and request gets 409 `Idempotency.ResultUnavailable` without `Retry-After`; the handler does not run again. Before, the key stayed in flight (409 `Idempotency.InFlight`) until the lease ended, and a later retry ran the handler again and repeated the side effect. A 4xx is still released and 3xx/5xx still stay in flight. `idempotentRetryClassifier` never retries the new code. During a rolling deploy, an instance still on 2.0.x that reads a marker answers 500 (`Idempotency.StoredResponseUnreadable`), so finish the deploy before relying on it.
- **Idempotency (lease extension):** with a store that has `extend` (both built-in stores now do), the engine runs a heartbeat while the handler runs, so a handler that outlives `leaseMs` keeps its key in flight instead of letting a retry take it over. In `enforce` the mediator's `ctx.signal` is a new signal that aborts with the caller's reason or when the reservation is lost; it is no longer the caller's signal object. When the handler throws the lease abort after a lost reservation, the call answers `Idempotency.ReservationLost` instead of that abort (see Added); any other error is rethrown as before. `withIdempotency` still passes the original `Request` unless the new `bindRequest` option is set. A custom store without `extend` behaves as before.
- **Idempotency (types):** `IdempotencyErrorCode` has the new members `Idempotency.ResultUnavailable` and `Idempotency.ReservationLost`, and `IdempotencyDecision` has the new member `'result_unavailable'`, so an exhaustive `switch` or `Record` over either type needs the new entries. A key that holds a marker is reported to `onDecision` as `'result_unavailable'` (`observe`: `Idempotency.Observe.WouldRejectResultUnavailable`), not as `'replay'`.

#### Other

- **Idempotency (SQL example):** `examples/idempotency-sql` now computes and compares `expires_at` with the database clock (`clock_timestamp()`) instead of the application clock, and its `clock` constructor option is removed; the contract test waits in real time with short leases. `docs/IDEMPOTENCY.md` also documents lease sizing, explicit mediator fingerprints for requests with per-retry fields, and that fingerprints are not canonicalized.
- **Idempotency:** `describeIdempotencyStoreContract` skips the `extend` scenarios of a store without `extend` through the runner's `skip()` (the test context argument, or `this` in mocha); a runner without one reports them as passed. The scenario functions declare no parameters, so vitest's `test.extend` (fixtures) can be passed as `it`.

### Added

- **Idempotency:** error code `Idempotency.ResultUnavailable` (Conflict, 409, never retried; `idempotencyErrors.resultUnavailable()`), event `Idempotency.ResponseNotReplayable` (a warning logged once the marker is stored, with the property `Reason`: `too_large`, `encoded` or `event_stream`; a too large 2xx no longer also logs `Idempotency.ResponseTooLarge`) and event `Idempotency.Observe.WouldRejectResultUnavailable`.
- **Idempotency:** optional store method `extend(key, token, leaseMs, signal?)`, implemented by `InMemoryIdempotencyStore`, `RedisIdempotencyStore` (script `RedisIdempotencyScripts.extend`) and the PostgreSQL example. It extends only a live, in-flight reservation that holds the token; it never revives an expired lease and never touches a completed record. `describeIdempotencyStoreContract` checks it.
- **Idempotency:** lease heartbeat. After a reservation the engine calls `extend` every `leaseMs / 3` (unref'ed timers, one call at a time, each with a signal that aborts when the heartbeat stops) until the handler settles; a caller abort does not stop it. `extend` returning `false` loses the lease at once. A throwing `extend` is retried; the lease is lost when no `extend` succeeded by the time taken before the last successful one (or before `reserve`) plus `leaseMs`, which also aborts a hung `extend`. 15 minutes (`MAX_LEASE_MS`) after the reservation the heartbeat stops and logs `Idempotency.LeaseLimitReached`. A lost lease logs `Idempotency.ReservationLost` and, in `enforce`, aborts the handler's signal with the new `IdempotencyReservationLostError` (`name` `'ReservationLost'`); `observe` only logs.
- **Idempotency:** error code `Idempotency.ReservationLost` (Unexpected; HTTP 503 with `Retry-After`, retried by `idempotentRetryClassifier`; `idempotencyErrors.reservationLost()`). In `enforce`, when the handler throws or rejects after its reservation was lost with the lease signal's reason, or with an abort-like error (`AbortError`, `TimeoutError`) when it received the signal (the mediator, `idempotent` with `bindSignal`, `withIdempotency` with `bindRequest`), the engine releases what is left of the reservation and answers this code; nothing is stored, so a retry runs the operation again. Any other error is rethrown. A caller abort still rejects with the caller's reason, also when the lease was lost first. A failure a handler that received the signal returns after the loss (a failure `Result`, a stored 5xx) is released instead of stored; without the signal it is stored as before, and a success is always stored, token-fenced. `ReservationLost` is logged once per call. Setup that throws after the reservation (a throwing `bindSignal` or `bindRequest`) also releases it before rethrowing.
- **Idempotency:** `idempotent()` option `bindSignal(signal, ...args)` returns the arguments to call the function with, so it receives the lease signal.
- **Idempotency (HTTP):** `withIdempotency` option `bindRequest(request, signal)` returns the request to pass to the handler, so it receives the lease signal, for example `(req, signal) => new Request(req, { signal })`. It is called only in `enforce` with a store that has `extend`; without it the handler gets the original request.

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

[Unreleased]: https://github.com/senrecep/tsentials/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/senrecep/tsentials/compare/v2.0.1...v3.0.0
[2.0.1]: https://github.com/senrecep/tsentials/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/senrecep/tsentials/releases/tag/v2.0.0
[1.0.0]: https://github.com/senrecep/tsentials/releases/tag/v1.0.0
