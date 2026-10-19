<p align="center">
  <img src="assets/logo-256.png" alt="tsentials logo" width="256" height="256" />
</p>

# tsentials

[![npm version](https://img.shields.io/npm/v/tsentials?style=flat-square&color=blue)](https://www.npmjs.com/package/tsentials)
[![npm downloads](https://img.shields.io/npm/dm/tsentials?style=flat-square)](https://www.npmjs.com/package/tsentials)
[![bundle size](https://img.shields.io/bundlephobia/minzip/tsentials?style=flat-square&label=gzip)](https://bundlephobia.com/package/tsentials)
[![tests](https://img.shields.io/badge/tests-2925%20passing-brightgreen?style=flat-square)](./tests)
[![CI](https://img.shields.io/github/actions/workflow/status/senrecep/tsentials/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/senrecep/tsentials/actions)
[![license](https://img.shields.io/github/license/senrecep/tsentials?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js)](https://nodejs.org)

Railway-oriented programming for TypeScript: `Result<T>`, `Maybe<T>`, Rule Engine, and DDD base classes with full async pipeline support.

---

> **[Your Function Signature Is Lying →](https://www.senrecep.com/en/blog/your-function-signature-is-lying)**  
> Why `try/catch` falls short in TypeScript, the thinking behind Railway Oriented Programming, and the design decisions that shaped `tsentials`.

---

## Table of Contents

- [Install](#install)
- [Modules](#modules)
- [Result\<T\>](#resultt)
  - [Creating Results](#creating-results)
  - [Pipeline (sync)](#pipeline-sync)
  - [Conditional & Guarded Pipeline](#conditional--guarded-pipeline)
  - [Error Handling & Recovery](#error-handling--recovery)
  - [Async Pipeline: ResultAsync\<T\>](#async-pipeline--resultasynct)
  - [ResultChain\<T\>, Fluent Wrapper](#resultchaint--fluent-wrapper)
  - [Combination & Utilities](#combination--utilities)
- [Maybe\<T\>](#maybet)
  - [Creating Maybe Values](#creating-maybe-values)
  - [Pipeline](#pipeline)
  - [Conditional Operations](#conditional-operations)
  - [Async Pipeline](#async-pipeline)
  - [Collection Utilities](#collection-utilities)
- [Result ↔ Maybe Bridge](#result--maybe-bridge)
- [Rule Engine](#rule-engine)
- [AppError & Err Factory](#apperror--err-factory)
  - [Error Metadata](#error-metadata)
- [Entity Base (DDD)](#entity-base-ddd)
- [HTTP (fetchResult)](#http-fetchresult)
- [Union\<T\>](#uniont)
- [Time & Fake Providers](#time--fake-providers)
- [Clone Utilities](#clone-utilities)
- [Cancellation (AbortSignal)](#cancellation-abortsignal)
- [JSON Utilities](#json-utilities)
- [pipe & flow](#pipe--flow)
- [NonEmptyArray\<T\>](#nonemptyarrayt)
- [Eq\<T\>](#eqt)
- [Ord\<T\>](#ordt)
- [Predicate\<T\>](#predicatet)
- [These\<E, A\>](#these-e-a)
- [Tree\<T\>](#treet)
- [Record Utilities](#record-utilities)
- [String Utilities](#string-utilities)
- [Validation](#validation)
- [Resilience](#resilience)
- [Pagination](#pagination)
- [Enums](#enums)
- [Mediator](#mediator)
- [Idempotency](#idempotency)
- [Design Notes](#design-notes)
- [AI Skills](#ai-skills)

## Install

```bash
npm install tsentials
```

**Requirements:** Node.js ≥ 22, TypeScript ≥ 5.0

## Modules

| Import | Contents |
|--------|----------|
| `tsentials/result` | `Result<T>`, `ResultAsync<T>`, `ResultChain<T>`, `fromAsync`, `maybeToResult`, `resultToMaybe` |
| `tsentials/maybe` | `Maybe<T>`, collection utilities |
| `tsentials/errors` | `AppError`, `ErrorType`, `Err` factory, `ErrorMetadata` |
| `tsentials/rules` | `Rule<T>`, `RuleEngine` |
| `tsentials/entity` | `createEntityBase`, `createSoftDeletable`, `DomainEvent` |
| `tsentials/http` | `fetchResult`, `RequestBuilder` |
| `tsentials/time` | `DateTimeProvider`, `SystemDateTimeProvider`, `createFakeDateTimeProvider`, `nextDayOfWeek`, `getAge`, `toDateOnly`, `toTimeOnly`, `msToDate` |
| `tsentials/clone` | `Cloneable<T>`, `deepClone`, `cloneArray` |
| `tsentials/union` | `Union<T>` |
| `tsentials/json` | `Json`, `JsonObject`, `JsonArray`, `JsonPrimitive`, `safeJsonParse`, `safeJsonStringify`, `parseAndValidate`, type guards |
| `tsentials/function` | `pipe`, `flow`, `identity`, `constant`, `flip` |
| `tsentials/array` | `NonEmptyArray<T>`, `head`, `tail`, `last`, `asNonEmptyArray` |
| `tsentials/eq` | `Eq<T>`, `contramap`, `struct`, `getArrayEq` |
| `tsentials/ord` | `Ord<T>`, `sortBy`, `min`, `max`, `clamp`, `between` |
| `tsentials/predicate` | `Predicate<T>`, `Refinement<A, B>`, `and`, `or`, `not`, `all`, `any` |
| `tsentials/these` | `These<E, A>`, `toResult`, `fromResult`, `partition` |
| `tsentials/tree` | `Tree<T>`, `map`, `filter`, `fold`, `drawTree` |
| `tsentials/record` | `Record` utilities, `map`, `filter`, `pick`, `omit`, `reduce` |
| `tsentials/string` | String case conversion utilities (Pascal, Camel, Kebab, Snake, Macro, Train, Title, _camelCase) |
| `tsentials/validation` | `Validator<T>`, `RuleContext`, `RuleChain`, `CascadeMode` |
| `tsentials/resilience` | `ResiliencePolicy`, `retryIfFailed` |
| `tsentials/pagination` | `paginate`, `keysetOrdering`, `keysetPaginate`, cursor helpers |
| `tsentials/enums` | `defineEnum` |
| `tsentials/mediator` | `createMediator`, `pipeline`, behaviors |
| `tsentials/idempotency` | `idempotent`, `idempotencyBehavior`, `withIdempotency`, `createIdempotency`, stores, keys and scopes |

> **Subpath-only modules.** `validation`, `resilience`, `pagination`, `enums`, `mediator` and `idempotency` are not re-exported
> from the root `tsentials` entry; import them from their subpath (`tsentials/validation`, …). The time
> extensions (`nextDayOfWeek`, `getAge`, …) are exported from `tsentials/time` only.

---

## Result\<T\>

Discriminated union `{ ok: true; value: T } | { ok: false; errors: AppError[] }`. Errors are values, not exceptions.

### Creating Results

```typescript
import { Result } from 'tsentials/result';
import { Err } from 'tsentials/errors';

function divide(a: number, b: number): Result<number> {
  if (b === 0) return Result.failure(Err.validation('Math.DivideByZero', 'Cannot divide by zero'));
  return Result.success(a / b);
}

// Type guards
const r = divide(10, 2);
if (Result.isSuccess(r)) console.log(r.value); // 5
if (Result.isFailure(r)) console.log(Result.firstError(r).code);

// Conditional creation
Result.successIf(user.age >= 18, user, Err.validation('User.Underage', 'Must be 18+'));
Result.failIf(user.isBanned, user, Err.forbidden('User.Banned', 'Account suspended'));

// Wrap throwing code
Result.try(() => JSON.parse(raw), () => Err.validation('JSON.Invalid', 'Malformed JSON'));

// Void success
Result.ok();
```

### Pipeline (sync)

```typescript
import { Result, chain } from 'tsentials/result';
import { Err } from 'tsentials/errors';

const price = chain(Result.success(100))
  .map(n => n * 1.2)
  .ensure(n => n < 200, Err.validation('Price.TooHigh', 'Exceeds limit'))
  .map(n => `$${n.toFixed(2)}`)
  .unwrap();
// => { ok: true, value: "$120.00" }

// Dynamic error from value — the factory runs only when the guard fails (lazy)
Result.ensure(
  Result.success(3),
  n => n > 5,
  n => Err.validation('Value.TooSmall', `Value ${n} is too small`),
);

// Side effects
Result.tap(price, v => console.log('computed', v));
Result.tapError(price, errs => console.error('failed', errs[0].code));
```

### Conditional & Guarded Pipeline

```typescript
import { Result } from 'tsentials/result';

// Bind only if condition is true
Result.bindIf(Result.success(5), true, n => Result.success(n * 2));
Result.bindIf(Result.success(5), n => n > 3, n => Result.success(n * 2));

// Tap only if condition is true
Result.tapIf(Result.success(42), true, v => console.log(v));
Result.tapIf(Result.success(42), v => v > 10, v => console.log(v));

// Tap errors conditionally
Result.tapErrorIf(
  Result.failure(err),
  errs => errs.length > 0,
  errs => metrics.track(errs[0].code),
);
```

### Error Handling & Recovery

```typescript
import { Result } from 'tsentials/result';
import { ErrorType } from 'tsentials/errors';

// Recover from all failures
Result.compensate(Result.failure(err), () => Result.success(-1));

// Recover using first error only
Result.compensateFirst(
  Result.failureFrom([err1, err2]),
  first => Result.success(first.code),
);

// Recover: scans ALL errors; the first error matching an ErrorType or a predicate goes to fn
Result.recover(
  Result.failureFrom([validationError, notFoundError]),
  ErrorType.NotFound,                       // or: e => e.code === 'User.NotFound'
  () => Result.success(guestUser),
);

// recoverFirst: recover only when the FIRST error matches
Result.recoverFirst(Result.failure(notFoundError), ErrorType.NotFound, () => Result.success(guestUser));

// Transform errors
Result.mapError(
  Result.failure(err),
  errs => errs.map(e => ({ ...e, code: `Wrapped.${e.code}` })),
);

// Map every error one by one, in order (mapper never runs on success)
Result.mapEachError(Result.failure(err), e => ({ ...e, code: `Api.${e.code}` }));

// Fallback values
Result.unwrapOr(Result.success(42), 0);       // 42
Result.unwrapOr(Result.failure(err), 0);      // 0
Result.unwrapOrElse(Result.failure(err), errs => errs.length); // 1

// Deconstruct to tuple
const [ok, value, errors] = Result.deconstruct(result);
```

### Async Pipeline, ResultAsync\<T\>

`ResultAsync<T>` implements `PromiseLike<Result<T>>`. The entire chain builds synchronously and resolves once at the end with a single `await`.

```typescript
import { fromAsync } from 'tsentials/result';
import { Err } from 'tsentials/errors';

// fromAsync takes a Promise<Result<T>> — here fetchUser returns Promise<Result<User>>
const profile = await fromAsync(fetchUser(userId))
  .andThen(user => validateUser(user))
  .ensure(user => user.isActive, Err.validation('User.Inactive', 'Not active'))
  .map(user => user.profile)
  .tap(p => console.log('fetched', p.name))
  .match(
    profile => profile,
    () => null,
  );
```

Async variants of all sync operations are available: `thenAsync`, `mapAsync`, `ensureAsync`, `tapAsync`, `tapErrorAsync`, `compensateAsync`, `mapErrorAsync`.

```typescript
// Conditional async bind — the bind fn preserves T; when the condition is
// false the original Result<T> passes through unchanged
await Result.bindIfAsync(
  Result.success(user),
  u => u.isAdmin,
  async u => loadAdminProfile(u), // (u: User) => Promise<Result<User>>
);

// Async recovery — the recovery fn returns the same Result<T>
await Result.recoverAsync(
  Result.failure(cacheMiss),
  e => e.code === 'Cache.Miss',
  async () => fetchFromDatabase(), // () => Promise<Result<T>>
);
```

### ResultChain\<T\>, Fluent Wrapper

```typescript
import { chain } from 'tsentials/result';

const r = chain(Result.success(5))
  .bind(n => Result.success(n * 2))
  .ensure(n => n > 5, Err.validation('Value.TooSmall', 'Too small'))
  .map(n => `value: ${n}`)
  .unwrap();

// Async methods (thenAsync, mapAsync, ensureAsync, recoverAsync, ...) return ResultAsync,
// so `await` gives a plain Result<T> — not a ResultChain.
const doubled = await chain(Result.success(2)).mapAsync(async n => n + 1).map(n => n * 2);
// => { ok: true, value: 6 }
```

### Combination & Utilities

```typescript
import { Result } from 'tsentials/result';

// Collect all — succeeds only if ALL succeed
Result.and([Result.success(1), Result.success(2)]); // Result<[1, 2]>
Result.and([Result.success(1), Result.failure(err)]); // collects ALL errors

// First success — short-circuits on first ok
Result.or([Result.failure(err1), Result.success(99), Result.failure(err2)]);

// Tuple combination — preserves heterogeneous types
Result.combine(Result.success(1), Result.success('hello'), Result.success(true));
// => Result<[number, string, boolean]>

// Flatten nested Result
Result.flatten(Result.success(Result.success(42))); // Result<number>

// Always run cleanup regardless of outcome
Result.always(result, r => {
  console.log(r.ok ? 'success' : 'failure');
  return 'done';
});

// traverse: map array items through a Result-returning fn, collect ALL errors
Result.traverse([1, 2, 3], n => n > 0 ? Result.success(n * 2) : Result.failure(err));
// → Result<number[]>
await Result.traverseAsync([1, 2], async n => fetchUser(n));
// → Promise<Result<User[]>> (sequential by default)

// Bounded concurrency + cancellation; results keep item order, ALL errors collected
await Result.traverseAsync(ids, async (id, signal) => fetchUser(id, signal), { concurrency: 4, signal });
```

---

## Maybe\<T\>

Explicit optional values instead of accidental `undefined`.

### Creating Maybe Values

```typescript
import { Maybe } from 'tsentials/maybe';

Maybe.some(42);
Maybe.some(null);                 // None — a Some never holds null/undefined
Maybe.none<number>();
Maybe.from(user.nickname);        // null/undefined → None
Maybe.map(Maybe.some(user), u => u.nickname); // None when nickname is null/undefined
Maybe.fromTry(() => riskyParse()); // thrown → None
Maybe.format(Maybe.some(1));       // 'Some(1)' (None → 'None'; named format, not toString)
```

### Pipeline

```typescript
import { Maybe } from 'tsentials/maybe';

const display = Maybe.getOrElse(
  Maybe.filter(
    Maybe.map(Maybe.from(user.nickname), s => s.trim()),
    s => s.length > 0,
  ),
  () => 'Anonymous',
);

// Type guards
if (Maybe.isSome(maybe)) console.log(maybe.value);
if (Maybe.isNone(maybe)) console.log('empty');

// Safe access
Maybe.getOrUndefined(maybe);          // T | undefined
Maybe.getOrThrow(maybe, 'Missing!');  // throws if None
Maybe.deconstruct(maybe);             // [true, T] | [false, undefined]
```

### Conditional Operations

```typescript
import { Maybe } from 'tsentials/maybe';

// Transform only if condition passes
Maybe.mapIf(Maybe.some(5), true, n => n * 2);
Maybe.mapIf(Maybe.some(5), n => n > 3, n => n * 2);

// Bind only if condition passes
Maybe.bindIf(Maybe.some(5), n => n > 3, n => Maybe.some(n * 2));

// Fallback chain
Maybe.or(Maybe.none<number>(), Maybe.some(99));        // Some(99)
Maybe.orElse(Maybe.none<number>(), () => Maybe.some(99)); // lazy fallback

// Run effect when None
Maybe.tapNone(Maybe.none<number>(), () => console.warn('missing'));
```

### Async Pipeline

```typescript
import { Maybe } from 'tsentials/maybe';

const user = await Maybe.mapAsync(Maybe.some(userId), async id => fetchUser(id));
const profile = await Maybe.bindAsync(user, async u =>
  u.isActive ? Maybe.some(u.profile) : Maybe.none(),
);
const filtered = await Maybe.filterAsync(profile, async p => p.isPublic);

// fromTry: a throw becomes None, but abort errors are rethrown (never swallowed)
const found = await Maybe.fromTryAsync(signal => repo.find(id, { signal }), { signal });
```

### Collection Utilities

```typescript
import { tryFirst, tryLast, tryFind, choose, asMaybe } from 'tsentials/maybe';

const first = tryFirst(items);                               // Maybe<T>
const firstAdmin = tryFirst(users, (u) => u.isAdmin);        // first match
const lastAdmin = tryLast(users, (u) => u.isAdmin);          // last match
const found = tryFind(items, (x) => x.id === targetId);      // Maybe<T>
const cached = tryFind(cacheMap, key);                       // Map lookup
const setting = tryFind(settings, 'theme');                  // own-key lookup on an object
const values = choose([Maybe.some(1), Maybe.none(), Maybe.some(3)]); // [1, 3]
const emails = choose(users, (u) => Maybe.from(u.email));    // map + keep Some values
// A found null/undefined element is None.

const m = asMaybe(maybeNullValue);                           // Maybe<T>
```

---

## Result ↔ Maybe Bridge

```typescript
import { maybeToResult, resultToMaybe } from 'tsentials/result';
import { Maybe } from 'tsentials/maybe';
import { Err } from 'tsentials/errors';

// Maybe → Result (alias of Maybe.toResult)
const result = maybeToResult(Maybe.from(user), Err.notFound('User.NotFound', 'Missing'));

// Result → Maybe (errors dropped)
const maybe = resultToMaybe(Result.success(42)); // Some(42)
const none = resultToMaybe(Result.failure(err)); // None
resultToMaybe(Result.ok());                      // None — undefined is never a Some value

// Round-trip preserves success value
maybeToResult(resultToMaybe(Result.success(data)), fallbackError);
```

---

## Rule Engine

```typescript
import { RuleEngine } from 'tsentials/rules';
import type { Rule } from 'tsentials/rules';

const isAdult = RuleEngine.fromPredicate<User>(
  u => u.age >= 18,
  Err.validation('User.Underage', 'Must be 18+'),
);

// Dynamic error factory
const hasBalance = RuleEngine.fromPredicate<Account>(
  a => a.balance > 0,
  a => Err.validation('Account.Insufficient', `Balance ${a.balance} is too low`),
);

// Combinators
RuleEngine.and(isAdult, hasBalance);       // ALL must pass, stops at first failure
RuleEngine.andAll(isAdult, hasBalance);    // ALL must pass, collects ALL errors
RuleEngine.linear(isAdult, hasBalance);    // ALL must pass, stops at first failure
RuleEngine.or(isAdult, hasBalance);        // AT LEAST ONE must pass
RuleEngine.and<User>();                    // empty list → Validation failure EMPTY_RULE_ARRAY

// Conditional branching
RuleEngine.if(isAdult, hasBalance);        // if adult → check balance, else skip
RuleEngine.if(isAdult, hasBalance, minorRule); // if adult → balance, else → minorRule
RuleEngine.if(config.strict, strictRule);  // plain boolean condition

// Async rules
const asyncRule = RuleEngine.fromPredicateAsync<User>(
  async u => await fetchStatus(u.id) === 'active',
  Err.validation('User.Inactive', 'Not active'),
);
RuleEngine.andAsync(asyncRule, anotherAsyncRule);
RuleEngine.andAllAsync(asyncRule, anotherAsyncRule);
RuleEngine.linearAsync(asyncRule, anotherAsyncRule);
RuleEngine.orAsync(asyncRule, fallbackAsyncRule);
RuleEngine.ifAsync(asyncRule, onTrue, onFalse);

// Evaluation — evaluate is synchronous and never throws
const result = RuleEngine.evaluate(isAdult, user);                  // VoidResult
const asyncResult = await RuleEngine.evaluateAsync(asyncRule, user, { signal }); // Promise<VoidResult>
```

A rule that throws becomes a failure with code `Rule.EvaluationFailed` (`Unexpected`). Every combinator node is guarded the same way, so `or` can still succeed on a later child and `if` takes the else branch. With a `signal`, the caller's abort rejects the promise instead (see [Cancellation](#cancellation-abortsignal)). `AsyncRule<T>` is `(ctx, signal?) => Promise<VoidResult>`.

---

## AppError & Err Factory

```typescript
import { Err } from 'tsentials/errors';

Err.validation('Field.Required', 'Name is required');
Err.notFound('User.NotFound', 'User does not exist');
Err.unexpected('DB.ConnectionFailed', 'Cannot connect to database');
Err.conflict('Email.AlreadyTaken', 'This email is already in use');
Err.unauthorized('Auth.InvalidToken', 'Token is expired');
Err.forbidden('Permissions.Denied', 'Insufficient permissions');

// From exceptions with metadata — type defaults to Failure, code to the constructor name
Err.fromException(new Error('timeout'));
Err.fromException(new Error('timeout'), ErrorType.Unexpected, 'Network.Timeout');

// Equality: code + description + type + metadata (same keys, Object.is per value)
Err.equals(errA, errB);

// Combine errors and error arrays into one flat array
Err.combine(errA, [errB, errC], errD);

// JSON wire shape: { code, description, type, numericType, metadata? }
JSON.stringify(Err.validation('Field.Required', 'Name is required'));
```

### Error Metadata

```typescript
import { ErrorMetadata } from 'tsentials/errors';

const meta = ErrorMetadata.fromRecord({ field: 'email', constraint: 'unique' });
const err = Err.validation('Email.Invalid', 'Invalid format', meta);

// Combine metadata maps (on key collision the base value wins)
const combined = ErrorMetadata.combine(baseMeta, additionalMeta);

// Convert back to plain object
const record = ErrorMetadata.toRecord(meta);

// Extract from exceptions
const exceptionMeta = ErrorMetadata.fromException(new TypeError('fail'));
// { exceptionType: 'TypeError', exceptionMessage: 'fail', exceptionStackTrace: '...' }
// plus a nested `innerException` map when error.cause is an Error
```

---

## Entity Base (DDD)

```typescript
import { createEntityBase, createSoftDeletable } from 'tsentials/entity';
import type { DomainEvent } from 'tsentials/entity';

interface OrderCreatedEvent extends DomainEvent {
  readonly orderId: string;
}

class Order implements EntityBase, SoftDeletable {
  private readonly _base = createEntityBase();
  private readonly _softDelete = createSoftDeletable();

  get domainEvents() { return this._base.domainEvents; }
  get createdAt() { return this._base.createdAt; }
  get createdBy() { return this._base.createdBy; }
  get updatedAt() { return this._base.updatedAt; }
  get updatedBy() { return this._base.updatedBy; }

  get isDeleted() { return this._softDelete.isDeleted; }
  get isHardDeleted() { return this._softDelete.isHardDeleted; }
  get deletedAt() { return this._softDelete.deletedAt; }
  get deletedBy() { return this._softDelete.deletedBy; }

  raise(event: DomainEvent) { this._base.raise(event); }
  clearDomainEvents() { return this._base.clearDomainEvents(); }
  setCreatedInfo(at: Date, by: string) { this._base.setCreatedInfo(at, by); }
  setUpdatedInfo(at: Date, by: string) { this._base.setUpdatedInfo(at, by); }

  markAsDeleted(at: Date, by: string) { this._softDelete.markAsDeleted(at, by); }
  markAsHardDeleted() { this._softDelete.markAsHardDeleted(); }
  restore() { this._softDelete.restore(); } // resets isHardDeleted too
}
```

---

## HTTP (fetchResult)

`fetchResult` captures network errors, body parse errors and HTTP error responses as `Result<T>`. The only rejection is the caller's own abort (`signal`), which rejects with the abort reason. The default timeout is 30 s (`timeout` option; `0` or `Infinity` disables it); on expiry the result is a failure with code `Http.Timeout` (`Unexpected`). A 2xx JSON response with an empty or `null` body is a `NotFound` failure ("Response body was empty or could not be deserialized."), except for `fetchResult.delete`, where it is a void success; 204/205 and non-JSON responses are void successes.

```typescript
import { fetchResult, RequestBuilder } from 'tsentials/http';

// Direct usage
const result = await fetchResult.get<User>('https://api.example.com/users/42');
if (!result.ok) console.error(result.errors[0].code); // 'Http.404'

// POST / PUT / PATCH / DELETE
await fetchResult.post('/users', { name: 'Alice' });
await fetchResult.put('/users/1', { name: 'Bob' });
await fetchResult.patch('/users/1', { active: true });
await fetchResult.delete('/users/1');
await fetchResult.get<User>('/users/42', { signal, timeout: 5_000 });

// Network errors are caught automatically
const r = await fetchResult.get('/offline'); // Result.failure with TypeError metadata

// Fluent builder
const users = await RequestBuilder.get('https://api.example.com/users')
  .header('Authorization', `Bearer ${token}`)
  .query('page', '1')
  .query('limit', '10')
  .query({ sort: 'name', q: undefined })   // record form; null/undefined values are skipped
  .timeout(5_000)
  .signal(signal)
  .send<User[]>();

// Relative URLs stay relative (resolved against the page origin as with plain fetch)
await RequestBuilder.get('/api/users').send<User[]>();

// JSON body with an Idempotency-Key (a fresh UUID when called without a key; every send() of this builder reuses it)
const created = await RequestBuilder.post('https://api.example.com/users')
  .idempotencyKey()
  .json({ name: 'Alice', email: 'alice@example.com' })
  .send<User>();
```

Failures carry response metadata (`HttpErrorMetadataKeys`: status, `Retry-After`, ProblemDetails `code`, replay flag). `withIdempotencyKey(init, key?)` adds the header to a plain `RequestInit`, and `idempotentRetryClassifier(method, hasKey)` is a `shouldRetry` for `ResiliencePolicy.withRetry` that never retries a POST or PATCH without a key. See [Idempotency](#idempotency).

Status code mapping:

| Status | ErrorType |
|--------|-----------|
| 400, 411, 413, 414, 415, 416, 417, 422 | `Validation` |
| 401, 407 | `Unauthorized` |
| 403 | `Forbidden` |
| 404, 410 | `NotFound` |
| 409, 412, 429 | `Conflict` |
| 408, ≥500 | `Unexpected` |
| anything else (402, 405, 406, other 4xx, 1xx-3xx) | `Failure` |

Supports `application/problem+json` (RFC 9457). An `errors` extension (list or dictionary shape) yields one `AppError` per entry; otherwise `detail`, then `title`, becomes the description (`problemDetailsToErrors`).

```typescript
import { HttpCodes } from 'tsentials/http';
import type { HttpCode } from 'tsentials/http';

// Type-safe HTTP status constants (no magic numbers)
const status: HttpCode = HttpCodes.Ok;           // 200
const notFound = HttpCodes.NotFound;             // 404
const serverErr = HttpCodes.InternalServerError; // 500
```

---

## Union\<T\>

Programmatic discriminated union with exhaustive match.

```typescript
import { Union } from 'tsentials/union';
import type { AppError } from 'tsentials/errors';

type PaymentResult = Union<{
  success: { transactionId: string };
  pending: { estimatedMs: number };
  failed: { error: AppError };
}>;

// Construct with `as PaymentResult` (not `: PaymentResult`) for fresh literals —
// assignment narrowing would otherwise pin the value to a single member.
const result = { tag: 'success', value: { transactionId: 'txn_123' } } as PaymentResult;

const message = Union.match(result, {
  success: ({ transactionId }) => `Paid! Ref: ${transactionId}`,
  pending: ({ estimatedMs }) => `Pending for ${estimatedMs}ms`,
  failed: ({ error }) => `Failed: ${error.description}`,
});

// Type guard — narrows to the tagged member
if (Union.is(result, 'success')) {
  console.log(result.value.transactionId);
}

// Unsafe extraction
const id = Union.get(result, 'success').transactionId; // throws if wrong tag

// Collection utilities
type Shape = Union<{ circle: { radius: number }; rect: { w: number; h: number } }>;
const shapes: Shape[] = [
  { tag: 'circle', value: { radius: 1 } },
  { tag: 'rect', value: { w: 2, h: 3 } },
  { tag: 'circle', value: { radius: 4 } },
];

// partition: split union array into two typed arrays by tag
const { lefts, rights } = Union.partition(shapes, 'circle', 'rect');
// lefts: Array<{ radius: number }> (2 items), rights: Array<{ w: number; h: number }> (1 item)

// groupBy: group all items by tag into a record
const groups = Union.groupBy(shapes);
// { circle: [{ radius: 1 }, { radius: 4 }], rect: [{ w: 2, h: 3 }] }
```

---

## Time & Fake Providers

```typescript
import { SystemDateTimeProvider, createFakeDateTimeProvider } from 'tsentials/time';

// Production
const now = SystemDateTimeProvider.utcNow();
const today = SystemDateTimeProvider.utcNowDate(); // UTC midnight
const ms = SystemDateTimeProvider.utcNowMs();

// Testing — deterministic time
const fake = createFakeDateTimeProvider(new Date('2024-06-01T12:00:00Z'));
fake.utcNow();           // 2024-06-01T12:00:00Z
fake.advance(1000);      // +1 second
fake.setTime(newDate);   // jump to any time
fake.utcNowDate();       // midnight of current fake date
```

Date helpers (UTC calendar unless noted, return new `Date` values):

```typescript
import { nextDayOfWeek, previousDayOfWeek, DayOfWeek, getAge, toDateOnly, toTimeOnly, msToDate, SystemDateTimeProvider } from 'tsentials/time';

nextDayOfWeek(new Date('2024-06-15T10:00:00Z'), DayOfWeek.Monday); // 2024-06-17T10:00:00Z (same weekday → +7 days unless includeCurrent)
getAge(new Date('2000-06-15'), new Date('2024-06-14'));            // 23 (reference: Date or DateTimeProvider; RangeError if birth is later)
getAge(new Date('2000-06-15'), SystemDateTimeProvider);            // today in the provider's timeZone (system: host zone, fake: UTC)
toDateOnly(new Date('2024-06-15T10:30:00Z'));                      // 2024-06-15T00:00:00Z
toTimeOnly(new Date('2024-06-15T10:30:15.250Z'));                  // { hour: 10, minute: 30, second: 15, millisecond: 250 }
msToDate(1609459200000);                                           // Maybe<Date>: Some(2021-01-01T00:00:00Z); msToDate(null) → None
```

---

## Clone Utilities

```typescript
import { deepClone, cloneArray } from 'tsentials/clone';
import type { Cloneable } from 'tsentials/clone';
```

`deepClone` is a self-contained recursive implementation. It never delegates to the native
`structuredClone`, so results are identical on every runtime (Node, browsers, React Native/Hermes).
Unlike `structuredClone`, it does not throw on functions/symbols and preserves Error subclasses.
`URL` and `URLSearchParams` are cloned; `Blob`, `File`, `Promise` and functions are returned by reference; a `__proto__` own key (e.g. from `JSON.parse`) is dropped.

```typescript
// Plain objects, nested structures
const copy = deepClone({ user: { id: 1, tags: ['a', 'b'] } });
copy.user.tags.push('c'); // original unaffected

// Date, Map, Set, TypedArrays — all supported
deepClone({ createdAt: new Date(), lookup: new Map([['key', 'value']]) });
deepClone(new Uint8Array([1, 2, 3])); // buffer cloned too

// Circular references
const obj: { self?: unknown } = {};
obj.self = obj;
const cloned = deepClone(obj);
cloned.self === cloned; // true

// Error with custom properties
const err = Object.assign(new TypeError('fail'), { code: 'ERR_X' });
deepClone(err).code; // 'ERR_X'

// Graceful degradation — never throws
deepClone({ fn: () => 42 });      // { fn: () => 42 }  — function reference preserved
deepClone({ sym: Symbol('x') });  // { sym: undefined } — symbols degrade to undefined
deepClone(new WeakMap());          // WeakMap {}         — empty instance (non-iterable)

// Clone array of Cloneable items
class Product implements Cloneable<Product> {
  constructor(public readonly id: number) {}
  clone() { return new Product(this.id); }
}
const cloned = cloneArray([new Product(1), new Product(2)]);
```

---

## Cancellation (AbortSignal)

Every operation that accepts `{ signal }` follows one rule (only the caller's own abort propagates):

- The **caller's** abort propagates: the returned promise rejects with `signal.reason`. It never becomes a failure.
- **Any other** error, including an abort-like error raised while the caller's signal is not aborted, becomes a failure (`None` for `Maybe`).

Applies to `Result.tryAsync`, `Result.traverseAsync`, `Result.sequenceAsync`, `Maybe.fromTryAsync`, `RuleEngine.evaluateAsync`, `fetchResult`, and `ResiliencePolicy.execute`.

`Validator.validateAsync` differs: a caller abort rejects with `signal.reason`, and an exception thrown by an async rule predicate or by `configure` rejects too (it is never turned into a failure). Use `mustAsync` predicates that return `false` for validation failures.

```typescript
import { Result, withAbort, isCallerAbort, rethrowIfAborted, throwIfAborted } from 'tsentials/result';

const ctrl = new AbortController();
const pending = Result.tryAsync((signal) => fetch(url, { signal }), { signal: ctrl.signal });
ctrl.abort();
await pending; // rejects with ctrl.signal.reason; a plain network error would resolve to Result.failure(...)
```

Helpers: `isAbortError(e)`, `isCallerAbort(e, signal)`, `rethrowIfAborted(e, signal)`, `throwIfAborted(signal)`, `withAbort(promise, signal)`.

---

## JSON Utilities

Type-safe JSON parsing and validation that returns `Result<T>` instead of throwing, so it fits directly into the railway pipeline.

```typescript
import { safeJsonParse, safeJsonStringify, parseAndValidate } from 'tsentials/json';
import { isJsonObject } from 'tsentials/json';

// Parse — returns Result<Json>
const result = safeJsonParse('{"name":"Alice","age":30}');
if (result.ok) {
  console.log(result.value); // { name: "Alice", age: 30 }
} else {
  console.error(result.errors[0].code); // "Json.SyntaxError" | "Json.ValidationError"
}

// Stringify — returns Result<string>
const json = safeJsonStringify({ id: 1, tags: ['a', 'b'] });
if (json.ok) console.log(json.value); // '{"id":1,"tags":["a","b"]}'

// Parse + validate with a custom type guard
interface User { name: string; age: number }

function isUser(value: unknown): value is User {
  return isJsonObject(value) && typeof value.name === 'string' && typeof value.age === 'number';
}

const user = parseAndValidate<User>('{"name":"Alice","age":30}', isUser);
if (user.ok) console.log(user.value.name); // "Alice" — fully typed
```

### Type Guards

```typescript
import { isJson, isJsonObject, isJsonArray, isJsonPrimitive } from 'tsentials/json';

isJsonPrimitive('hello');        // true — string | number | boolean | null
isJsonArray([1, 2, 3]);          // true
isJsonObject({ a: 1 });          // true — plain objects only, rejects Date/RegExp/class instances
isJson({ nested: [1, null] });   // true — recursive validation
isJson({ fn: () => {} });        // false — functions are not valid JSON
isJson({ key: undefined });      // false — undefined is not valid JSON
```

### Error Codes

| Code | Cause |
|------|-------|
| `Json.SyntaxError` | `JSON.parse` failed, malformed input |
| `Json.ValidationError` | Parsed value failed type guard |
| `Json.StringifyFailed` | `JSON.stringify` failed (e.g. circular reference) |

### Pipeline Integration

```typescript
import { Result } from 'tsentials/result';
import { safeJsonParse } from 'tsentials/json';

const processed = Result.then(
  safeJsonParse(rawInput),
  data => validatePayload(data),
);
```

---

## pipe & flow

```typescript
import { pipe, flow, identity, constant, flip } from 'tsentials/function';

// pipe — thread a value through unary functions (up to 15 steps, fully typed)
const result = pipe(
  5,
  n => n * 2,
  n => n + 1,
  n => String(n),
); // "11"

// flow — compose functions into a reusable pipeline
const doubleAndStringify = flow(
  (n: number) => n * 2,
  n => String(n),
);
doubleAndStringify(5); // "10"

identity(42);                                    // 42
const alwaysTrue = constant(true);
alwaysTrue();                                    // true
const subtract = (a: number, b: number) => a - b;
flip(subtract)(3, 10);                           // 7 — arguments reversed
```

## NonEmptyArray\<T\>

Type-safe arrays guaranteed to have at least one element, so `head()` and `last()` never need a null check.

```typescript
import { NonEmptyArray, asNonEmptyArray, isNonEmpty, prepend, append, head, tail, last, init } from 'tsentials/array';

const items: NonEmptyArray<string> = ['a', 'b', 'c'];
head(items);  // 'a' — safe, no Maybe
last(items);  // 'c'
tail(items);  // ['b', 'c'] — plain array
init(items);  // ['a', 'b'] — plain array

// Safe conversion from plain array
const maybe = asNonEmptyArray([]);        // None
const sure  = asNonEmptyArray([1, 2]);    // Some([1, 2])

// Type guard — narrows a plain array
const values = [1, 2, 3];
if (isNonEmpty(values)) {
  head(values); // 1 — no null check needed inside the guard
}

// Construction that preserves the guarantee
prepend(0, [1, 2]);  // NonEmptyArray [0, 1, 2]
append([1, 2], 3);   // NonEmptyArray [1, 2, 3]

// map/reverse/sort keep the non-empty guarantee; filter returns a plain array
NonEmptyArray.map(items, s => s.toUpperCase()); // NonEmptyArray ['A', 'B', 'C']
NonEmptyArray.filter(items, s => s !== 'a');    // ['b', 'c'] — may become empty
```

## Eq\<T\> & Ord\<T\>

Composable, type-safe equality and ordering. `Eq<A>` provides `equals`, `Ord<A>` extends it with `compare` returning `-1 | 0 | 1`.

```typescript
import { Eq } from 'tsentials/eq';
import { Ord, sortBy, min, max, clamp, between, reverse } from 'tsentials/ord';

interface User { readonly id: number; readonly name: string; readonly age: number; }

// Structural equality from primitive instances (Eq.strict/string/number/boolean/date)
const eqUser = Eq.struct<User>({ id: Eq.number, name: Eq.string, age: Eq.number });
eqUser.equals({ id: 1, name: 'A', age: 30 }, { id: 1, name: 'A', age: 30 }); // true

// Compare by projection
const eqById = Eq.contramap(Eq.number, (u: User) => u.id);
const eqNumberArray = Eq.getArrayEq(Eq.number); // element-wise array equality

const users: User[] = [
  { id: 1, name: 'Carol', age: 35 },
  { id: 2, name: 'Alice', age: 30 },
];

const byAge = Ord.contramap(Ord.number, (u: User) => u.age);
sortBy(users, byAge);            // sorted copy, ascending
sortBy(users, reverse(byAge));   // descending

const [a, b] = [users[0]!, users[1]!];
min(byAge, a, b);                // Alice (30)
max(byAge, a, b);                // Carol (35)
clamp(Ord.number, 0, 100, 150);  // 100
between(Ord.number, 0, 100, 42); // true

// Multi-field ordering — compares fields in order, short-circuits
const byNameThenAge = Ord.struct({ name: Ord.string, age: Ord.number });
```

## Predicate\<T\>

Composable boolean predicates for validation and filtering.

```typescript
import { Predicate } from 'tsentials/predicate';

interface User { readonly age: number; readonly isActive: boolean; readonly role: string; }

const isAdult = Predicate.from((u: User) => u.age >= 18);
const isActive = Predicate.from((u: User) => u.isActive);
const isAdmin = Predicate.from((u: User) => u.role === 'admin');

const isValid = Predicate.and(isAdult, isActive);
isValid.test({ age: 20, isActive: true, role: 'user' }); // true

Predicate.or(isAdult, isAdmin);            // either passes
Predicate.not(isAdult);                    // negation
Predicate.all(isAdult, isActive, isAdmin); // every predicate must pass
Predicate.any(isAdult, isActive, isAdmin); // at least one must pass

// Refinement — narrows the type on success
const isString = Predicate.refinement((v: unknown): v is string => typeof v === 'string');
const input: unknown = 'hello';
if (isString.test(input)) input.toUpperCase(); // input is string here
```

## These\<E, A\>

Partial success: a value together with errors or warnings. `Result<T>` is either-or; `These` allows both at once. Use `These<AppError[], A>` when you want the `Result` bridge, since `toResult` expects the error side to be an array.

```typescript
import { These } from 'tsentials/these';
import { Err, type AppError } from 'tsentials/errors';

const parseAge = (raw: string): These<AppError[], number> => {
  const age = Number(raw);
  if (Number.isNaN(age)) return These.left([Err.validation('Age.NaN', 'Not a number')]);
  if (age < 0) return These.both([Err.validation('Age.Negative', 'Clamped to 0')], 0);
  return These.right(age);
};

// Exhaustive match — Left, Right, and Both each get a handler
const label = These.match(
  parseAge('-5'),
  (errors) => `failed: ${errors[0]?.code}`,
  (age) => `ok: ${age}`,
  (errors, age) => `partial: ${age} with ${errors.length} warning(s)`,
); // "partial: 0 with 1 warning(s)"

// Type guards narrow
const t = parseAge('30');
if (These.isRight(t)) console.log(t.right); // 30

// Bridge to Result
These.toResult(parseAge('-5'));        // failure — Both converts to failure (errors win)
These.toResultLenient(parseAge('-5')); // success(0) — Both keeps the value, discards errors

// Split a batch into successes / failures / partials
const { lefts, rights, boths } = These.partition([parseAge('30'), parseAge('abc'), parseAge('-5')]);
// rights: [30], lefts: [[Age.NaN]], boths: [{ error: [...], value: 0 }]
```

## Tree\<T\>

Recursive tree data structure for hierarchies.

```typescript
import { Tree, drawTree } from 'tsentials/tree';

const tree = Tree.of('Electronics', [
  Tree.of('Phones', [Tree.leaf('iPhone'), Tree.leaf('Android')]),
  Tree.leaf('Laptops'),
]);

Tree.toArray(tree);          // ['Electronics', 'Phones', 'iPhone', 'Android', 'Laptops'] (pre-order)
Tree.size(tree);             // 5
Tree.map(tree, s => s.toUpperCase());       // same structure, transformed values
Tree.find(tree, v => v === 'iPhone');       // first matching node (depth-first) | null
Tree.findAll(tree, v => v.length > 6);      // all matching nodes
Tree.filter(tree, v => v === 'Phones');     // parent kept if any descendant matches

// Post-order fold — e.g. count all nodes
Tree.fold(tree, (_value, children: readonly number[]) =>
  1 + children.reduce((a, b) => a + b, 0),
); // 5

console.log(drawTree(tree));
// Electronics
// ├── Phones
// │   ├── iPhone
// │   └── Android
// └── Laptops
```

## Record Utilities

Functional operations on plain objects.

```typescript
import { Record as R } from 'tsentials/record';

const users = { a: { name: 'Alice' }, b: { name: 'Bob' } };

R.map(users, u => u.name);              // { a: 'Alice', b: 'Bob' }
R.filter(users, u => u.name !== 'Bob'); // { a: { name: 'Alice' } }
R.pick(users, 'a');                     // { a: { name: 'Alice' } }
R.omit(users, 'b');                     // { a: { name: 'Alice' } }
R.keys(users);                          // ['a', 'b'] — typed
R.size(users);                          // 2
R.has(users, 'a');                      // true

const scores = { math: 90, art: 40, science: 75 };

R.reduce(scores, 0, (acc, v) => acc + v);      // 205
R.partition(scores, v => v >= 60);             // { pass: { math, science }, fail: { art } }
R.filterMap(scores, v => (v >= 60 ? v + 10 : null)); // { math: 100, science: 85 }
R.mapWithKey(scores, (k, v) => [k.toUpperCase(), v]); // { MATH: 90, ART: 40, SCIENCE: 75 }

// upsert/remove — immutable; the key must belong to the record's key union
R.upsert(scores, 'art', 55);  // { math: 90, art: 55, science: 75 }
R.remove(scores, 'art');      // { math: 90, science: 75 }
```

## String Utilities

```typescript
import { toPascalCase, toCamelCase, toKebabCase, toSnakeCase, toMacroCase, toTrainCase, toTitleCase, toUnderscoreCamelCase } from 'tsentials/string';

toPascalCase('hello world')         // 'HelloWorld'
toCamelCase('hello-world')          // 'helloWorld'
toKebabCase('HelloWorld')           // 'hello-world'
toSnakeCase('helloWorld')           // 'hello_world'
toMacroCase('hello world')          // 'HELLO_WORLD'  (SCREAMING_SNAKE_CASE)
toTrainCase('hello world')          // 'Hello-World'
toTitleCase('hello world foo')      // 'Hello World Foo'
toUnderscoreCamelCase('helloWorld') // '_helloWorld'
```

All functions handle: spaces, hyphens, underscores, camelCase, PascalCase, and mixed input.

## Validation

Eager, Result-based. Default cascade is `Stop` (first failure on a chain skips the rest); `cascade(CascadeMode.Continue)` accumulates. `null`/`undefined` are skipped by every built-in except `notNull`, `notEmpty`, `equal`: guard with `notEmpty()` first. Error code is `<path>.<Rule>`.

```typescript
import { Validator, CascadeMode, type RuleContext } from 'tsentials/validation';

type User = { name: string; email: string; address: { city: string }; items: { sku: string }[] };

const r = Validator.validate(user, (rules) => {
  rules.for('name').notEmpty().maxLength(50);
  rules.for('email').notEmpty().emailAddress();
  rules.for('address.city').notEmpty();
  rules.forEach('items', (item) => { item.for('sku').notEmpty(); });
});
// failure codes: 'name.NotEmpty', 'email.EmailAddress', 'address.city.NotEmpty', 'items[0].sku.NotEmpty'
// success carries the validated instance: Result<User>

class UserValidator extends Validator<User> {
  protected configure(rules: RuleContext<User>) {
    rules.for('name').notEmpty().cascade(CascadeMode.Continue).minLength(3).maxLength(50);
  }
}
new UserValidator().validate(user);                       // Result<User>
RuleEngine.evaluate(new UserValidator().toRule(), user);  // as a Rule<User> (import RuleEngine from 'tsentials/rules')

// Async: await every async rule inside the callback; caller abort rejects, never a validation error
await Validator.validateAsync(user, async (rules, _model, signal) => {
  await rules.for('email').mustAsync(async (e) => await isFree(e, signal), 'Email.Taken', 'Already used');
}, { signal });

Validator.validateWith(Result.success(user), (rules) => { rules.for('name').notEmpty(); }); // railway step
```

Also: `must(pred)`, `must(pred, code, msg)`, `notNull`, `length`, `matches`, `greaterThan`, `inclusiveBetween`, `minCount`, `isDefinedEnum`, `isOneOf`, `setValidator`, `satisfies(rule)`. `validate()` throws `TypeError` if `configure` returns a promise or leaves an async rule un-awaited.

---

## Resilience

Immutable policy; each `with…` returns a new policy and appends the strategy INSIDE the previous ones (first added = outermost; `withFallback` is always outermost). `execute` never rejects except with the caller's abort reason. Retryable = failures whose FIRST error is not Validation/NotFound/Unauthorized/Forbidden, plus thrown values.

```typescript
import { ResiliencePolicy, retryIfFailed } from 'tsentials/resilience';

const policy = ResiliencePolicy.create()
  .withRetry({ maxAttempts: 3, delay: 200 })   // defaults: 3 retries, 1000 ms, exponential
  .withCircuitBreaker()                        // defaults: minimumThroughput 10, 60 s window, 30 s break, ratio 0.5
  .withTimeout(5_000);                         // per attempt; failure code 'Resilience.Timeout'

const user = await policy.execute((signal) => fetchResult.get<User>('/users/42', { signal }), { signal });
// open circuit → failure 'Resilience.CircuitBroken'

const cached = await ResiliencePolicy.create<string>().withTimeout(10_000).withFallback(() => 'cached')
  .execute(async () => Result.failure<string>(Err.failure('X', 'down')));   // success('cached')

await retryIfFailed((signal) => loadOrder(id, signal), { maxAttempts: 2, delay: 100 });
```

**Note:** `maxAttempts` counts RETRIES, so the action runs at most `maxAttempts + 1` times. `executeValue(fn)` wraps a plain value as success.

`withRetry({ shouldRetry })` replaces the retryable check (a throwing predicate stops retrying). A failure with `retryAfterMs` metadata (set by `fetchResult` from a `Retry-After` header) waits at least that long, capped at `maxRetryAfterMs` (default 30 s).

---

## Pagination

```typescript
import { paginate, keysetOrdering, keysetPaginate } from 'tsentials/pagination';

// Offset (in-memory): pageNumber/pageSize clamped (pageSize max 100); totalCount = -1 with includeTotalCount: false
const page = paginate(items, { pageNumber: 2, pageSize: 10 });
page.items; page.totalPages; page.hasNextPage; page.hasPreviousPage;

// Keyset: last key must be unique; cursors are bound to the ordering fingerprint
const byNewest = keysetOrdering<Order>('Order').descending('createdAt', 'date').ascending('id', 'number');
const first = keysetPaginate(orders, { limit: 10 }, byNewest);              // Result<KeysetPaginationResponse<Order>>
if (first.ok) {
  const next = keysetPaginate(orders, { limit: 10, after: first.value.nextCursor }, byNewest);
}
// bad cursor → failure 'KeysetPagination.InvalidCursor'; after + before → 'KeysetPagination.AfterAndBefore'
```

For database queries use `planKeysetPage` + `createKeysetPageResponse` ; `encodeCursor`/`decodeCursor` and a `CursorProtector` (e.g. HMAC) are exported.

---

## Enums

```typescript
import { defineEnum, type EnumMember } from 'tsentials/enums';

const Status = defineEnum('Status', {
  Pending: {},                          // wire name 'pending' (default naming snake_case_lower), value 0
  Active: 'on',                         // string = explicit wire name, value 1
  Disabled: { aliases: ['off'] },
  Unknown: { fallback: true },          // at most one fallback; duplicate wire names/aliases throw a TypeError
});
type Status = EnumMember<typeof Status>;   // 'Pending' | 'Active' | 'Disabled' | 'Unknown'

Status.parse('on')                      // Result<Status> → success('Active'); also 'ACTIVE'/'Active' (case-insensitive), 'off', '2'
Status.parse('nope')                    // failure 'Enum.InvalidValue' (Validation; lists allowed values)
Status.parse('nope', { mode: 'data' })  // success('Unknown') — data mode uses the fallback member
Status.format('Active')                 // 'on'; format('Active', 'number') → '1'
Status.parseNumber(1)                   // success('Active')
Status.is('Active'); Status.wireNames; Status.numberOf('Disabled'); // true; [...]; 2
```

---

## Mediator

Typed in-process request/response with a behavior pipeline. Handlers return `Result`; behaviors wrap them (outermost first: global, then per-handler).

```typescript
import { createMediator, exceptionHandlingBehavior, validationBehavior } from 'tsentials/mediator';

type Requests = { GetUser: { request: { id: number }; response: User } };

const mediator = createMediator<Requests>({ behaviors: [exceptionHandlingBehavior()] })
  .register('GetUser',
    ({ id }, ctx) => id > 0 ? Result.success(loadUser(id)) : Result.failure(Err.notFound('User.NotFound', 'No user')),
    validationBehavior<{ id: number }>([(req) => (req.id > 0 ? Result.ok() : Result.failure(Err.validation('Id.Invalid', 'bad')))]),
  );

const result = await mediator.send('GetUser', { id: 1 }, { signal }); // Promise<Result<User>>
```

`exceptionHandlingBehavior()` turns a thrown handler error into `Err.fromException(e)` (Failure); any abort-like error (`AbortError`/`TimeoutError`, whoever aborted) still propagates, so a cancellation never becomes an error Result. `send` rejects when no handler is registered; `register` throws on a duplicate name. Other behaviors: `loggingBehavior`, `cachingBehavior`, `lockBehavior` (`InProcessResourceLock`), `transactionBehavior`.

---

## Idempotency

Runs an operation once per idempotency key. A later call with the same key gets the stored outcome; the operation does not run again. Wrappers exist for functions, mediator requests and Fetch API handlers, and they share one engine and one store contract.

```typescript
import {
  createIdempotency,
  idempotencyKeys,
  idempotencyScopes,
  RedisIdempotencyStore,
} from 'tsentials/idempotency';

const idem = createIdempotency({
  store: new RedisIdempotencyStore(redis),   // or InMemoryIdempotencyStore for one process
  mode: () => flags.idempotencyMode,         // 'off' | 'observe' | 'enforce'
});

// Functions returning Result<T>
const capture = idem.idempotent(capturePayment, {
  namespace: 'capture-payment',
  key: (cmd: CaptureCommand) => idempotencyKeys.for('capture', cmd.orderId),
  scope: (cmd) => idempotencyScopes.tenant(cmd.tenantId),
});

// Fetch API handlers (Hono, Next.js route handlers, Bun, Deno, Workers): reads the Idempotency-Key header
export const POST = idem.withIdempotency(createOrder, {
  scope: (request) => idempotencyScopes.user(userIdOf(request)),
});

// Mediator: idem.idempotencyBehavior() reads idempotencyKey / idempotencyScope from the request
```

- Same key still running → `Idempotency.InFlight` (Conflict, HTTP 409 with `Retry-After`).
- Same key with another payload → `Idempotency.KeyReused` (Validation, HTTP 422).
- Same key, same payload, completed → the stored outcome (HTTP adds `Idempotency-Replayed: true`).
- Keys are scoped by `(namespace, scope, key)`; a key without a scope is rejected or skipped, never shared by accident.
- Roll out with `observe` first: it answers exactly like `off` and reports what `enforce` would have done.

Stores: `InMemoryIdempotencyStore`, `RedisIdempotencyStore` (bring your own client through `RedisLike`) and any store that passes `describeIdempotencyStoreContract`. Use a store with atomic compare-and-set; an eventually consistent key-value store such as Cloudflare KV is not safe as a lock. On the client side, `tsentials/http` adds `withIdempotencyKey`, `RequestBuilder.idempotencyKey()` and `idempotentRetryClassifier` for `ResiliencePolicy.withRetry({ shouldRetry })`.

The [idempotency guide](./docs/IDEMPOTENCY.md) covers settings, the HTTP response table, lease and retry budgets, a transactional PostgreSQL store, webhooks and rollout.

---

## Design Notes

- **`Result<T>`**: discriminated union, no class, zero runtime overhead
- **`ResultAsync<T>`**: implements `PromiseLike<Result<T>>` for direct `await`; monadic bind named `andThen` to avoid thenable collision
- **`ResultChain<T>`**: fluent sync wrapper; monadic bind named `bind` (not `then`) for the same reason
- **`Maybe<T>`**: pure functional namespace, all operations are static functions
- **`Rule<T>`**: just `(ctx: T) => VoidResult`, no interface hierarchy
- **Subpath-only modules**: `validation`, `resilience`, `pagination`, `enums`, `mediator`, `idempotency` are not in the root entry, keeping the root bundle small
- **Entity base**: mixin factory pattern (`createEntityBase()`), not abstract class inheritance
- **`sideEffects: false`**: all subpath imports are fully tree-shakeable

## AI Skills

Install skills for Claude Code, Cursor, Codex, and 50+ other AI agents:

```bash
npx skills add senrecep/tsentials
```

Each module has a dedicated skill with accurate API examples, correct import paths, and common pitfalls.

## License

MIT © [Recep Şen](https://github.com/senrecep)
