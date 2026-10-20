---
name: tsentials
description: Master skill for tsentials — railway-oriented programming library for TypeScript. Load this skill first when working with any tsentials module. Contains critical naming rules, API patterns, decision trees for module selection, and references to all 24 module-specific skills.
---

# tsentials — Master Skill

Railway-oriented programming toolkit for TypeScript. Errors are values, not exceptions.

**Install:** `npm install tsentials`
**Requirements:** Node.js >= 22, TypeScript >= 5.0, ESM only

## Critical Naming Rules

These naming rules MUST be followed. Getting them wrong causes runtime bugs.

| Context | WRONG | CORRECT | Why |
|---------|-------|---------|-----|
| ResultAsync monadic bind | `.then(fn)` | `.andThen(fn)` | `.then()` is PromiseLike protocol — using it as bind breaks `await` |
| ResultChain monadic bind | `.then(fn)` | `.bind(fn)` | Same reason — `await chain` would treat `.then` as thenable |
| Result static monadic bind | `Result.bind(r, fn)` | `Result.then(r, fn)` | Static namespace intentionally uses `then` (not thenable) |
| AppError message field | `error.message` | `error.description` | Avoids confusion with native `Error.message` |
| Err import path | `from 'tsentials/result'` | `from 'tsentials/errors'` | `Err` factory lives in errors module |
| ResultChain extract | `.toResult()` | `.unwrap()` | Returns underlying `Result<T>` |
| ResultChain fallback | `.getOrElse(v)` | `.unwrapOr(v)` | Also: `.unwrapOrElse(fn)` |
| Result.try (sync) | `Result.trySync(fn)` | `Result.try(fn, onError?)` | No `trySync` — it's just `try` |
| fromAsync input | `fromAsync(Result.success(x))` | `fromAsync(Promise.resolve(Result.success(x)))` | `fromAsync` takes `Promise<Result<T>>`, not sync Result |
| Maybe discriminant | `maybe.kind === 'some'` | `maybe.hasValue === true` | Discriminant is `hasValue: boolean`, no `kind` property |
| Entity pattern | `class X extends EntityBase` | `private _base = createEntityBase()` | Factory returns object, not class — use composition |
| SystemDateTimeProvider | `new SystemDateTimeProvider()` | `SystemDateTimeProvider.utcNow()` | Const object, not a class |
| Time methods | `.now()` / `.nowMs()` | `.utcNow()` / `.utcNowMs()` | All time methods are UTC-prefixed |
| fetchResult usage | `fetchResult<T>(url)` | `fetchResult.get<T>(url)` | Const object with method per HTTP verb |
| RequestBuilder terminal | `.fetchResult<T>()` | `.send<T>()` | Terminal method is `send`, not `fetchResult` |
| deepClone mechanism | "calls .clone()" | self-contained recursive copy | `cloneArray` calls `.clone()`; `deepClone` is its own recursive implementation (never native `structuredClone`) |
| Predicate.and arity | `Predicate.and(a, b, c)` | `Predicate.and(Predicate.and(a, b), c)` | `and`/`or` take exactly 2 args. Use `all`/`any` for variadic |
| Subpath-only modules | `import { Validator } from 'tsentials'` | `from 'tsentials/validation'` | `validation`, `resilience`, `pagination`, `enums`, `mediator`, `idempotency` are not re-exported from the root entry |
| AbortSignal | caller abort becomes a failure | caller abort rejects with `signal.reason` | Any other error (incl. abort-like while the caller's signal is not aborted) becomes a failure |
| String case functions | `toCamelCase(str, opts)` | `toCamelCase(str)` | Single-argument, no options object — normalization is automatic |

## Core API Patterns

### Result<T> — The Foundation

```typescript
// Type shape
type Result<T> = { ok: true; value: T } | { ok: false; errors: readonly AppError[] };

// Creation
Result.success(value)                    // Result<T>
Result.failure(Err.validation(...))      // Result<T>
Result.ok()                              // Result<void>
Result.try(() => JSON.parse(s), e => Err.validation('Parse', 'Invalid'))

// Static pipeline (all take result as first arg — NOT curried)
Result.then(r, fn)          // monadic bind
Result.map(r, fn)           // transform value
Result.ensure(r, pred, err) // guard
Result.tap(r, fn)           // side effect
Result.match(r, onOk, onErr) // exhaustive exit

// Combination
Result.and([r1, r2])        // all succeed, collects ALL errors
Result.or([r1, r2])         // first success
Result.combine(r1, r2, r3)  // heterogeneous tuple
```

### Three API Styles

```typescript
// Style 1: Pure functions
const r = Result.then(Result.ensure(Result.success(user), pred, err), fn);

// Style 2: Fluent chain (sync)
const r = chain(Result.success(user)).bind(fn).ensure(pred, err).map(fn).unwrap();

// Style 3: Async builder
const r = await fromAsync(fetchUser(id)).andThen(fn).ensure(pred, err).match(ok, err);
```

### AppError — Structured Errors

```typescript
interface AppError {
  readonly code: string;              // "User.Email.Invalid"
  readonly description: string;       // NOT .message
  readonly type: ErrorType;           // Validation, NotFound, Conflict, ...
  readonly metadata?: ErrorMetadata;  // ReadonlyMap<string, unknown> — NOT plain object
}

// Creation via Err factory
Err.validation('Code', 'desc', ErrorMetadata.fromRecord({ field: 'email' }))
Err.notFound('Code', 'desc')
Err.unauthorized('Code', 'desc')
Err.forbidden('Code', 'desc')
Err.conflict('Code', 'desc')
Err.unexpected('Code', 'desc')
Err.failure('Code', 'desc')
Err.fromException(caughtError)
```

### RuleEngine — Business Rules

```typescript
// Rule<T> is sync: (context: T) => VoidResult
// AsyncRule<T> is async: (context: T) => Promise<VoidResult>

const rule = RuleEngine.fromPredicate<User>(
  u => u.age >= 18,
  Err.validation('Age', 'Must be 18+')  // or: u => Err.validation(...)
);

RuleEngine.and(r1, r2, r3)     // all must pass, stops at first failure
RuleEngine.andAll(r1, r2, r3)  // all must pass, collects ALL errors
RuleEngine.linear(r1, r2)      // sequential, stops at first failure
RuleEngine.or(r1, r2)          // at least one
RuleEngine.if(cond, then, else?) // cond: Rule<T> | boolean — returns Rule<T>
// An empty rule list → Validation failure 'EMPTY_RULE_ARRAY'

RuleEngine.evaluate(rule, ctx)       // sync → VoidResult
RuleEngine.evaluateAsync(rule, ctx)  // async → Promise<VoidResult>
```

## Module Decision Tree

| Need | Module | Skill |
|------|--------|-------|
| Return errors without exceptions | `result` + `errors` | `tsentials-result`, `tsentials-errors` |
| Async pipelines without try/catch | `result` (`fromAsync`, `ResultAsync`) | `tsentials-result` |
| Optional/nullable values | `maybe` | `tsentials-maybe` |
| Business validation rules | `rules` | `tsentials-rules` |
| Multiple typed outcomes | `union` | `tsentials-union` |
| Partial success (value + warnings) | `these` | `tsentials-these` |
| DDD entities + domain events | `entity` | `tsentials-entity` |
| HTTP calls returning Result | `http` | `tsentials-http` |
| Safe JSON parsing | `json` | `tsentials-json` |
| Testable time abstraction | `time` | `tsentials-time` |
| Deep cloning | `clone` | `tsentials-clone` |
| Function composition (pipe/flow) | `function` | `tsentials-function` |
| Non-empty array guarantee | `array` | `tsentials-array` |
| Recursive hierarchies | `tree` | `tsentials-tree` |
| Functional object manipulation | `record` | `tsentials-record` |
| Structural equality | `eq` | `tsentials-eq` |
| Type-safe ordering/sorting | `ord` | `tsentials-ord` |
| Composable boolean predicates | `predicate` | `tsentials-predicate` |
| Convert between naming conventions | `string` | `tsentials-string` |
| Fluent model validation (Result-based) | `validation` (subpath-only) | `tsentials-validation` |
| Retry / circuit breaker / timeout / fallback | `resilience` (subpath-only) | `tsentials-resilience` |
| Offset and keyset (cursor) paging | `pagination` (subpath-only) | `tsentials-pagination` |
| Enums with wire names, aliases, safe parse | `enums` (subpath-only) | `tsentials-enums` |
| Typed request/response mediator with behaviors | `mediator` (subpath-only) | `tsentials-mediator` |
| Run an operation once per idempotency key (functions, mediator, Fetch handlers) | `idempotency` (subpath-only) | `tsentials-idempotency` |
| Date helpers (next weekday, age, date-only) | `time` | `tsentials-time` |
| Module overview / all imports | — | `tsentials-meta` |

## Design Principles

- **Errors are values.** `Result<T>` makes errors explicit in the type system.
- **Multiple errors.** `AppError[]` — not single error. Applicative validation is first-class.
- **Immutable by default.** `Object.freeze` at runtime, not just compile-time.
- **Namespace merging.** `Result` is both a type and a value — single import, dual use.
- **Zero dependencies.** Full tree-shaking with `"sideEffects": false`.
- **Composition over inheritance.** Entity uses mixin factories, not abstract classes.
- **`description`, not `message`.** Intentional to avoid native Error confusion.

## Common Import Block

```typescript
import { Result, ResultChain, ResultAsync, fromAsync, chain } from 'tsentials/result';
import { maybeToResult, resultToMaybe } from 'tsentials/result';
import { Err, AppError, ErrorType, ErrorMetadata } from 'tsentials/errors';
import { Maybe, tryFirst, tryLast, tryFind, choose, asMaybe } from 'tsentials/maybe';
import { RuleEngine } from 'tsentials/rules';
import type { Rule, AsyncRule } from 'tsentials/rules';
import { pipe, flow } from 'tsentials/function';
import { Union } from 'tsentials/union';
import { These } from 'tsentials/these';
import { NonEmptyArray, head, last, asNonEmptyArray } from 'tsentials/array';
import { Eq } from 'tsentials/eq';
import { Ord, sortBy, min, max } from 'tsentials/ord';
import { Predicate } from 'tsentials/predicate';
import { createEntityBase, createSoftDeletable } from 'tsentials/entity';
import type { DomainEvent } from 'tsentials/entity';
import { fetchResult, RequestBuilder } from 'tsentials/http';
import { SystemDateTimeProvider, createFakeDateTimeProvider } from 'tsentials/time';
import type { DateTimeProvider } from 'tsentials/time';
import { deepClone, cloneArray } from 'tsentials/clone';
import { safeJsonParse, parseAndValidate } from 'tsentials/json';
import { toPascalCase, toCamelCase, toKebabCase, toSnakeCase } from 'tsentials/string';
import { nextDayOfWeek, previousDayOfWeek, DayOfWeek, getAge, toDateOnly, toTimeOnly, msToDate } from 'tsentials/time';

// Subpath-only (not in the root entry)
import { Validator, CascadeMode } from 'tsentials/validation';
import { ResiliencePolicy, retryIfFailed } from 'tsentials/resilience';
import { paginate, keysetOrdering, keysetPaginate } from 'tsentials/pagination';
import { defineEnum } from 'tsentials/enums';
import { createMediator, exceptionHandlingBehavior, validationBehavior } from 'tsentials/mediator';
import { createIdempotency, idempotent, withIdempotency, idempotencyKeys, idempotencyScopes } from 'tsentials/idempotency';
```
