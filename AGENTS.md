# tsentials — Agent Guide

## Quick Reference

**Package:** `tsentials` (npm)  
**Purpose:** Railway-oriented programming — error-as-value, no exceptions  
**Node:** ≥18, TypeScript ≥5.0, ESM only

## Import Paths

```typescript
import { Result, ResultChain, ResultAsync, fromAsync, chain, maybeToResult, resultToMaybe } from 'tsentials/result';
import { Err, AppError, ErrorType, ErrorMetadata } from 'tsentials/errors';
import { Maybe, tryFirst, tryLast, tryFind, choose, asMaybe } from 'tsentials/maybe';
import { RuleEngine } from 'tsentials/rules';
import type { Rule } from 'tsentials/rules';
import { createEntityBase, createSoftDeletable } from 'tsentials/entity';
import type { DomainEvent } from 'tsentials/entity';
import { fetchResult, RequestBuilder } from 'tsentials/http';
import { SystemDateTimeProvider, createFakeDateTimeProvider } from 'tsentials/time';
import { deepClone, cloneArray } from 'tsentials/clone';
import { Union } from 'tsentials/union';
import { safeJsonParse, safeJsonStringify, parseAndValidate, isJsonObject, isJson } from 'tsentials/json';
import type { Json, JsonObject } from 'tsentials/json';
import { pipe, flow } from 'tsentials/function';
import { Eq } from 'tsentials/eq';
import { Ord, sortBy } from 'tsentials/ord';
import { Predicate } from 'tsentials/predicate';
import { NonEmptyArray, head, asNonEmptyArray } from 'tsentials/array';
import { These } from 'tsentials/these';
import { Tree } from 'tsentials/tree';
import { Record } from 'tsentials/record';
```

---

## Core Patterns

### Result\<T\> — error handling without exceptions

```typescript
import { Result } from 'tsentials/result';
import { Err } from 'tsentials/errors';

// Factory
Result.success(value)
Result.failure(Err.validation('Code', 'message'))
Result.ok()                                          // void success
Result.successIf(cond, value, err)                   // conditional success
Result.failIf(cond, value, err)                      // conditional failure
Result.try(() => JSON.parse(raw), e => Err.validation('JSON.Invalid', 'Bad JSON'))

// Type guards
Result.isSuccess(r)   // r is { ok: true; value: T }
Result.isFailure(r)   // r is { ok: false; errors: AppError[] }
Result.firstError(r)  // AppError
Result.lastError(r)   // AppError

// Pipeline (sync)
Result.then(r, fn)                // monadic bind → Result<U>  ← NOT .bind()
Result.map(r, fn)                 // transform value
Result.ensure(r, pred, err)       // guard — err can be a factory fn
Result.tap(r, fn)                 // side effect on success
Result.tapError(r, fn)            // side effect on failure
Result.match(r, onOk, onErr)      // exhaustive exit

// Conditional pipeline
Result.bindIf(r, cond, fn)        // bind only if condition/predicate true
Result.tapIf(r, cond, fn)         // tap only if condition/predicate true
Result.tapErrorIf(r, cond, fn)    // tapError only if condition/predicate true

// Error recovery
Result.compensate(r, fn)          // recover from any failure
Result.compensateFirst(r, fn)     // recover using first error
Result.recover(r, pred, fn)       // recover only if first error matches predicate
Result.mapError(r, fn)            // transform error array
Result.else(r, fallback)          // fallback value on failure

// Extraction
Result.unwrap(r)                  // throws if failure
Result.unwrapOr(r, default)       // default value on failure
Result.unwrapOrElse(r, fn)        // computed default on failure
Result.deconstruct(r)             // [ok, value, errors] tuple

// Combination
Result.and([r1, r2])              // all must succeed — collects ALL errors
Result.or([r1, r2])               // first success wins — collects all errors if all fail
Result.combine(r1, r2, r3)        // heterogeneous tuple Result<[T1, T2, T3]>
Result.flatten(r)                 // Result<Result<T>> → Result<T>
Result.always(r, fn)              // unconditional cleanup — returns fn result
Result.ap(fab, fa)                // applicative apply
Result.partition(results)         // split into { ok: T[], err: AppError[] }
Result.sequence(promises)         // await Promise<Result<T>>[] → Result<T[]>
```

### Async Pipeline — fromAsync / ResultAsync\<T\>

`ResultAsync<T>` builds the chain synchronously, resolves in one `await` at the end.

```typescript
import { fromAsync } from 'tsentials/result';

const profile = await fromAsync(fetchUser(userId))
  .andThen(user => validateUser(user))     // NOTE: andThen, NOT then
  .ensure(user => user.isActive, Err.validation('User.Inactive', 'Not active'))
  .map(user => user.profile)
  .tap(p => console.log('fetched', p.name))
  .match(profile => profile, () => null);

// Async variants on Result namespace
await Result.thenAsync(r, async fn)
await Result.mapAsync(r, async fn)
await Result.ensureAsync(r, async pred, err)
await Result.tapAsync(r, async fn)
await Result.tapErrorAsync(r, async fn)
await Result.compensateAsync(r, async fn)
await Result.compensateFirstAsync(r, async fn)
await Result.recoverAsync(r, pred, async fn)
await Result.mapErrorAsync(r, async fn)
await Result.bindIfAsync(r, cond, async fn)
await Result.alwaysAsync(r, async fn)
```

### ResultChain\<T\> — fluent sync wrapper

```typescript
import { chain } from 'tsentials/result';

const r = chain(Result.success(5))
  .bind(n => Result.success(n * 2))      // NOTE: bind() here, not then()
  .ensure(n => n > 5, Err.validation('Value.TooSmall', 'Too small'))
  .map(n => `value: ${n}`)
  .unwrap();
```

### Maybe\<T\> — null-safe optional values

```typescript
import { Maybe } from 'tsentials/maybe';

// Factory
Maybe.some(value)
Maybe.none<T>()
Maybe.from(nullable)              // null/undefined → None
Maybe.fromTry(() => expr)         // thrown → None

// Type guards
Maybe.isSome(m)                   // m is { hasValue: true; value: T }
Maybe.isNone(m)                   // m is { hasValue: false }

// Pipeline
Maybe.map(m, fn)
Maybe.bind(m, fn)                 // fn returns Maybe<U>
Maybe.filter(m, pred)
Maybe.match(m, onSome, onNone)
Maybe.tap(m, fn)
Maybe.tapNone(m, fn)              // side effect when None

// Conditional
Maybe.mapIf(m, cond, fn)
Maybe.bindIf(m, cond, fn)

// Extraction
Maybe.getOrDefault(m, fallback)
Maybe.getOrElse(m, factory)
Maybe.getOrUndefined(m)           // T | undefined
Maybe.getOrThrow(m, message)      // throws if None
Maybe.deconstruct(m)              // [true, T] | [false, undefined]

// Fallback chain
Maybe.or(m, fallbackMaybe)
Maybe.orElse(m, () => fallbackMaybe)

// Async variants
await Maybe.mapAsync(m, async fn)
await Maybe.bindAsync(m, async fn)
await Maybe.filterAsync(m, async pred)
await Maybe.tapAsync(m, async fn)
await Maybe.matchAsync(m, async onSome, async onNone)
await Maybe.orAsync(m, async () => fallbackMaybe)

// Collection utilities
tryFirst(items)                   // Maybe<T>
tryLast(items)                    // Maybe<T>
tryFind(items, pred)              // Maybe<T>
choose([Maybe.some(1), Maybe.none(), Maybe.some(3)])  // [1, 3] — unwraps Somes
asMaybe(nullableValue)            // Maybe<T>
```

### Result ↔ Maybe Bridge

```typescript
import { maybeToResult, resultToMaybe } from 'tsentials/result';

maybeToResult(Maybe.from(user), Err.notFound('User.NotFound', 'Missing'))  // Result<T>
resultToMaybe(Result.success(42))   // Some(42)
resultToMaybe(Result.failure(err))  // None — errors are dropped
```

### Errors — Err factory

```typescript
import { Err, ErrorType, ErrorMetadata } from 'tsentials/errors';

Err.validation('Field.Required', 'Name is required')
Err.notFound('User.NotFound', 'User does not exist')
Err.unexpected('DB.ConnectionFailed', 'Cannot connect')
Err.conflict('Email.AlreadyTaken', 'Email already in use')
Err.unauthorized('Auth.InvalidToken', 'Token expired')
Err.forbidden('Permissions.Denied', 'Insufficient permissions')
Err.fromException(error)                                    // wraps native Error
Err.fromException(error, ErrorType.Unexpected, 'Net.Timeout')
Err.equals(errA, errB)                                      // structural equality

// AppError properties: .code  .description  .type  .metadata
// NOTE: it is .description, NOT .message

// Metadata
const meta = ErrorMetadata.fromRecord({ field: 'email' })
Err.validation('Email.Invalid', 'Bad format', meta)
ErrorMetadata.combine(meta1, meta2)
ErrorMetadata.toRecord(meta)
```

### Rules — RuleEngine

```typescript
import { RuleEngine } from 'tsentials/rules';
import type { Rule } from 'tsentials/rules';

// Rule is just a function: (ctx: T) => VoidResult
const isAdult: Rule<User> = ctx =>
  ctx.age >= 18 ? Result.ok() : Result.failure(Err.validation('Age.Invalid', 'Must be 18+'));

// From predicate
const isAdult = RuleEngine.fromPredicate<User>(u => u.age >= 18, Err.validation(...));
const hasBalance = RuleEngine.fromPredicate<Account>(
  a => a.balance > 0,
  a => Err.validation('Account.Insufficient', `Balance ${a.balance} too low`),  // dynamic error
);

// Combinators
RuleEngine.and(r1, r2)         // ALL must pass — collects ALL errors
RuleEngine.linear(r1, r2)      // ALL must pass — stops at first failure
RuleEngine.or(r1, r2)          // AT LEAST ONE must pass
RuleEngine.if(cond, then, else?)  // conditional branching

// Async
RuleEngine.fromPredicateAsync<T>(async pred, err)
RuleEngine.andAsync(r1, r2)
RuleEngine.linearAsync(r1, r2)
RuleEngine.orAsync(r1, r2)
RuleEngine.ifAsync(cond, then, else?)

// Evaluation
RuleEngine.evaluate(rule, ctx)              // Promise<VoidResult>
RuleEngine.evaluateAsync(asyncRule, ctx)    // Promise<VoidResult>
```

### HTTP — fetchResult

```typescript
import { fetchResult, RequestBuilder } from 'tsentials/http';

// Never throws — all errors captured as Result<T>
await fetchResult.get<User>('/users/42')
await fetchResult.post('/users', body)
await fetchResult.put('/users/1', body)
await fetchResult.patch('/users/1', partial)
await fetchResult.delete('/users/1')

// Fluent builder
const users = await RequestBuilder.get('/users')
  .header('Authorization', `Bearer ${token}`)
  .query('page', '1')
  .query('limit', '10')
  .send<User[]>();

await RequestBuilder.post('/users')
  .header('X-Idempotency-Key', key)
  .json({ name: 'Alice' })
  .send<User>();

// Status → ErrorType: 400/422→Validation, 401→Unauthorized, 403→Forbidden,
//   404/410→NotFound, 409/429→Conflict, ≥500→Unexpected
```

### Entity Base (DDD)

```typescript
import { createEntityBase, createSoftDeletable } from 'tsentials/entity';
import type { DomainEvent } from 'tsentials/entity';

class Order {
  private readonly _base = createEntityBase();
  private readonly _soft = createSoftDeletable();

  get domainEvents()  { return this._base.domainEvents; }
  get createdAt()     { return this._base.createdAt; }
  get updatedAt()     { return this._base.updatedAt; }
  get isDeleted()     { return this._soft.isDeleted; }
  get deletedAt()     { return this._soft.deletedAt; }

  raise(event: DomainEvent)         { this._base.raise(event); }
  clearDomainEvents()               { return this._base.clearDomainEvents(); }
  setCreatedInfo(at: Date, by: string) { this._base.setCreatedInfo(at, by); }
  setUpdatedInfo(at: Date, by: string) { this._base.setUpdatedInfo(at, by); }
  markAsDeleted(at: Date, by: string)  { this._soft.markAsDeleted(at, by); }
  restore()                         { this._soft.restore(); }
}
```

### Union\<T\> — discriminated union

```typescript
import { Union } from 'tsentials/union';

type PaymentResult = Union<{
  success: { transactionId: string };
  pending: { estimatedMs: number };
  failed:  { error: AppError };
}>;

const r: PaymentResult = { tag: 'success', value: { transactionId: 'txn_123' } };

Union.match(r, {
  success: ({ transactionId }) => `Paid: ${transactionId}`,
  pending: ({ estimatedMs })   => `Pending ${estimatedMs}ms`,
  failed:  ({ error })         => `Failed: ${error.description}`,
});

Union.is(r, 'success')         // type guard
Union.get(r, 'success')        // value or throws
```

### Time

```typescript
import { SystemDateTimeProvider, createFakeDateTimeProvider } from 'tsentials/time';

SystemDateTimeProvider.utcNow()      // production
SystemDateTimeProvider.utcNowDate()  // UTC midnight
SystemDateTimeProvider.utcNowMs()    // ms timestamp

// Tests
const fake = createFakeDateTimeProvider(new Date('2024-06-01T12:00:00Z'));
fake.advance(1000)        // +1 second
fake.setTime(newDate)     // jump to any time
```

### JSON — never use JSON.parse directly

```typescript
import { safeJsonParse, safeJsonStringify, parseAndValidate, isJsonObject } from 'tsentials/json';

// Never throws — returns Result<Json>
const result = safeJsonParse('{"name":"Alice","age":30}');
// error codes: 'Json.SyntaxError' | 'Json.ValidationError' | 'Json.StringifyFailed'

safeJsonStringify({ id: 1 })  // Result<string> — catches circular refs

// Parse + type guard → Result<T>
function isUser(v: unknown): v is User {
  return isJsonObject(v) && typeof v.name === 'string' && typeof v.age === 'number';
}
parseAndValidate<User>(raw, isUser)

// isJsonObject: plain objects ONLY — rejects Date, Map, class instances
// Chains directly into Result pipeline
Result.then(safeJsonParse(raw), data => validatePayload(data));
```

---

## Important: Naming Pitfalls

| Wrong | Correct | Why |
|-------|---------|-----|
| `resultAsync.then(fn)` | `resultAsync.andThen(fn)` | `.then()` is reserved for PromiseLike |
| `chain.then(fn)` | `chain.bind(fn)` | Same reason — breaks await |
| `new AppError(...)` | `Err.validation(code, msg)` | Use factory methods |
| `throw error` | `Result.failure(Err.unexpected(...))` | Errors are values |
| `error.message` | `error.description` | AppError property is `.description` |
| `JSON.parse(raw)` | `safeJsonParse(raw)` | Never throws |
| `import { Err } from 'tsentials/result'` | `import { Err } from 'tsentials/errors'` | Wrong module |

---

## Build & Test

```bash
npm run build      # tsc compile
npm test           # vitest run (762 tests)
npm run check      # biome lint + format check
npm run lint:fix   # auto-fix lint
```
