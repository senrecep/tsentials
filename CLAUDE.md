# tsentials — Developer Guide

Railway-oriented programming toolkit for TypeScript.  
Modules: `result`, `maybe`, `errors`, `rules`, `entity`, `http`, `time`, `clone`, `union`, `json`.

## Commands

| Task | Command |
|------|---------|
| Build | `npm run build` |
| Test | `npm test` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Lint + fix | `npm run lint:fix` |
| Format | `npm run format` |
| Full check | `npm run check` |
| Publish dry-run | `npm pack --dry-run` |

## Architecture

### Module structure
```
src/
  errors/         — AppError, ErrorType, ErrorMetadata, Err factory
  result/         — Result<T>, ResultChain<T>, ResultAsync<T>, fromAsync, maybe-bridge
  maybe/          — Maybe<T>, maybe-utils (tryFirst, tryLast, tryFind, choose, asMaybe)
  rules/          — Rule<T> type, RuleEngine (linear/and/or/if + async)
  entity/         — createEntityBase(), withSoftDelete(), DomainEvent
  http/           — fetchResult(), RequestBuilder, httpStatusToError
  time/           — DateTimeProvider, SystemDateTimeProvider, createFakeDateTimeProvider
  clone/          — Cloneable<T>, deepClone(), cloneArray()
  union/          — Union<T> discriminated union utility
  json/           — Json types, isJson/isJsonObject guards, safeJsonParse(), safeJsonStringify(), parseAndValidate()
```

### Result<T>
Discriminated union: `{ ok: true; value: T } | { ok: false; errors: AppError[] }`

```typescript
import { Result, chain, fromAsync } from 'tsentials/result';
import { Err } from 'tsentials/errors';

// Factories
Result.success(value)
Result.failure(Err.validation('Code', 'message'))
Result.ok()                                    // void success
Result.successIf(cond, value, err)             // conditional
Result.failIf(cond, value, err)
Result.try(() => JSON.parse(raw), e => Err.validation('JSON.Invalid', 'Bad'))

// Type guards
Result.isSuccess(r) / Result.isFailure(r)
Result.firstError(r) / Result.lastError(r)

// Pipeline (sync)
Result.then(r, fn)              // monadic bind → Result<U>  ← NOT .bind()
Result.map(r, fn)               // transform value
Result.ensure(r, pred, err)     // guard — err can be a factory (value) => AppError
Result.tap(r, fn)               // side effect on success
Result.tapError(r, fn)          // side effect on failure
Result.match(r, onOk, onErr)    // exhaustive exit

// Conditional pipeline
Result.bindIf(r, cond, fn)      // cond: boolean | (value) => boolean
Result.tapIf(r, cond, fn)
Result.tapErrorIf(r, cond, fn)

// Error recovery
Result.compensate(r, fn)                     // recover from any failure
Result.compensateFirst(r, fn)                // recover using first error
Result.recover(r, pred, fn)                  // recover only if predicate matches
Result.mapError(r, fn)                       // transform error array
Result.else(r, fallback)                     // fallback value

// Extraction
Result.unwrap(r)                             // throws ResultUnwrapError if failure
Result.unwrapOr(r, default)
Result.unwrapOrElse(r, errs => ...)
Result.deconstruct(r)                        // [ok, value, errors] tuple

// Combination
Result.and([r1, r2])                         // all succeed → Result<T[]>, collects ALL errors
Result.or([r1, r2])                          // first success, else all errors
Result.combine(r1, r2, r3)                   // heterogeneous → Result<[T1, T2, T3]>
Result.flatten(Result.success(r))            // Result<Result<T>> → Result<T>
Result.always(r, fn)                         // unconditional — returns fn result

// Fluent chain — bind() NOT then()
chain(Result.success(5)).bind(fn).map(fn).ensure(pred, err).match(ok, err)

// Async pipeline — one await at the end, andThen() NOT then()
await fromAsync(promise)
  .andThen(fn)    // monadic bind
  .map(fn)
  .ensure(pred, err)
  .tap(fn)
  .match(ok, err)

// Async variants on Result namespace
await Result.thenAsync(r, async fn)
await Result.mapAsync(r, async fn)
await Result.bindIfAsync(r, cond, async fn)
await Result.recoverAsync(r, pred, async fn)
await Result.compensateAsync(r, async fn)
await Result.alwaysAsync(r, async fn)
```

### Critical naming rules
- `ResultAsync.andThen()` — NOT `.then()` (would break PromiseLike protocol)
- `ResultChain.bind()` — NOT `.then()` (same reason: await treats `.then` as thenable)
- `Result.then()` — sync monadic bind on the static namespace (intentionally named `then`, not `bind`)
- `error.description` — NOT `.message` (AppError uses `description`)

### Maybe<T>
Functional namespace — all static methods, no class instantiation.

```typescript
import { Maybe, tryFirst, tryLast, tryFind, choose, asMaybe } from 'tsentials/maybe';

// Factory
Maybe.some(value)
Maybe.none<T>()
Maybe.from(nullableValue)              // null/undefined → None
Maybe.fromTry(() => expr)              // thrown → None

// Type guards
Maybe.isSome(m) / Maybe.isNone(m)

// Pipeline
Maybe.map(m, fn)
Maybe.bind(m, fn)                      // fn returns Maybe<U>
Maybe.filter(m, predicate)
Maybe.match(m, onSome, onNone)
Maybe.tap(m, fn)
Maybe.tapNone(m, fn)                   // side effect when None

// Conditional
Maybe.mapIf(m, cond, fn)
Maybe.bindIf(m, cond, fn)

// Extraction
Maybe.getOrDefault(m, fallback)
Maybe.getOrElse(m, factory)
Maybe.getOrUndefined(m)                // T | undefined
Maybe.getOrThrow(m, message)
Maybe.deconstruct(m)                   // [true, T] | [false, undefined]

// Fallback chain
Maybe.or(m, fallbackMaybe)
Maybe.orElse(m, () => fallbackMaybe)   // lazy

// Async variants
Maybe.mapAsync / bindAsync / filterAsync / tapAsync / matchAsync / orAsync

// Collection utilities
tryFirst(items) / tryLast(items) / tryFind(items, pred)  // Maybe<T>
choose([Maybe.some(1), Maybe.none(), Maybe.some(3)])     // [1, 3]
asMaybe(nullableValue)                                   // Maybe<T>
```

### Rule<T>
`type Rule<T> = (ctx: T) => VoidResult` — just a function.

```typescript
import { RuleEngine } from 'tsentials/rules';
import type { Rule } from 'tsentials/rules';

// Define inline
const isActive: Rule<User> = ctx =>
  ctx.isActive ? Result.ok() : Result.failure(Err.validation('User.Inactive', 'Not active'));

// From predicate — static or dynamic error
const isAdult = RuleEngine.fromPredicate<User>(u => u.age >= 18, Err.validation('Age.Invalid', 'Must be 18+'));
const hasBalance = RuleEngine.fromPredicate<Account>(
  a => a.balance > 0,
  a => Err.validation('Account.Insufficient', `Balance ${a.balance} too low`),
);

// Combinators
RuleEngine.and(rule1, rule2)       // ALL must pass — collects ALL errors
RuleEngine.linear(rule1, rule2)    // ALL must pass — stops at first failure
RuleEngine.or(rule1, rule2)        // at least one must pass
RuleEngine.if(cond, then, else?)   // conditional branching

// Async
RuleEngine.fromPredicateAsync<T>(async pred, err)
RuleEngine.andAsync / linearAsync / orAsync / ifAsync

// Evaluation
RuleEngine.evaluate(rule, ctx)            // Promise<VoidResult>
RuleEngine.evaluateAsync(asyncRule, ctx)  // Promise<VoidResult>
```

### Entity (DDD)
Mixin factory pattern — no deep inheritance.

```typescript
import { createEntityBase, createSoftDeletable } from 'tsentials/entity';
import type { DomainEvent } from 'tsentials/entity';

class Order {
  private readonly _base = createEntityBase();
  private readonly _soft = createSoftDeletable();

  get domainEvents() { return this._base.domainEvents; }
  get createdAt()    { return this._base.createdAt; }
  get updatedAt()    { return this._base.updatedAt; }
  get isDeleted()    { return this._soft.isDeleted; }

  raise(event: DomainEvent)            { this._base.raise(event); }
  clearDomainEvents()                  { return this._base.clearDomainEvents(); }
  setCreatedInfo(at: Date, by: string) { this._base.setCreatedInfo(at, by); }
  setUpdatedInfo(at: Date, by: string) { this._base.setUpdatedInfo(at, by); }
  markAsDeleted(at: Date, by: string)  { this._soft.markAsDeleted(at, by); }
  restore()                            { this._soft.restore(); }
}
```

### HTTP

```typescript
import { fetchResult, RequestBuilder } from 'tsentials/http';

// Never throws — Result<T> on all outcomes
await fetchResult.get<User>('/users/42')
await fetchResult.post('/users', body)
await fetchResult.put('/users/1', body)
await fetchResult.patch('/users/1', partial)
await fetchResult.delete('/users/1')

// Fluent builder
await RequestBuilder.get('/users')
  .header('Authorization', `Bearer ${token}`)
  .query('page', '1')
  .send<User[]>();

await RequestBuilder.post('/users').json({ name: 'Alice' }).send<User>();

// Status → ErrorType: 400/422→Validation, 401→Unauthorized, 403→Forbidden,
//   404/410→NotFound, 409/429→Conflict, ≥500→Unexpected
```

### Union\<T\>

```typescript
import { Union } from 'tsentials/union';

type Shape = Union<{ circle: { radius: number }; rect: { w: number; h: number } }>;

const s: Shape = { tag: 'circle', value: { radius: 5 } };
Union.match(s, { circle: ({ radius }) => radius * 2, rect: ({ w, h }) => w * h });
Union.is(s, 'circle')    // type guard
Union.get(s, 'circle')   // value or throws
```

### Json
Safe JSON parsing — returns `Result<T>`, never throws.

```typescript
import { safeJsonParse, safeJsonStringify, parseAndValidate } from 'tsentials/json';
import { isJson, isJsonObject, isJsonArray, isJsonPrimitive } from 'tsentials/json';
import type { Json, JsonObject } from 'tsentials/json';

// Parse — Result<Json>
const result = safeJsonParse('{"name":"Alice","age":30}');
if (result.ok) console.log(result.value);            // { name: "Alice", age: 30 }
else console.error(result.errors[0].code);           // 'Json.SyntaxError' | 'Json.ValidationError'

// Stringify — Result<string>, catches circular refs
safeJsonStringify({ id: 1, tags: ['a'] })            // Result<string> — 'Json.StringifyFailed' on error

// Parse + validate to domain type
function isUser(v: unknown): v is User {
  return isJsonObject(v) && typeof v.name === 'string' && typeof v.age === 'number';
}
parseAndValidate<User>(raw, isUser)                  // Result<User> — 'Json.TypeValidationError' on guard failure

// Type guards
isJsonPrimitive('hello')   // true  — string | number | boolean | null
isJsonArray([1, 2])        // true
isJsonObject({ a: 1 })     // true  — plain objects only
isJsonObject(new Date())   // false — rejects Date, Map, class instances
isJson({ nested: [null] }) // true  — recursive validation
isJson({ fn: () => {} })   // false — functions not valid JSON

// Pipeline integration
const processed = Result.then(safeJsonParse(rawInput), data => validatePayload(data));
```

## TypeScript configuration
- `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`
- ESM only (`"type": "module"`), `moduleResolution: "bundler"`
- `"sideEffects": false` in package.json for full tree-shaking

## Testing
Vitest — `npm test` runs all 652 tests across 22 test files.
Test files mirror src/ structure under `tests/`.

## Publishing
```bash
npm version patch   # bump version
npm publish         # runs prepublishOnly: build + test first
```
Or push a `v*` tag to trigger the GitHub Actions publish workflow.

## Lint (Biome)
`npm run check` — lints and checks formatting.
`npm run lint:fix` — auto-fix lint issues.
`npm run format` — auto-format.
