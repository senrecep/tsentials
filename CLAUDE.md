# tsentials — Developer Guide

Railway-oriented programming toolkit for TypeScript.  
Modules: `result`, `maybe`, `errors`, `rules`, `entity`, `http`, `time`, `clone`, `union`, `json`, `string`, `function`, `array`, `eq`, `ord`, `predicate`, `these`, `tree`, `record`.

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
  string/         — String case conversion (toPascalCase, toCamelCase, toKebabCase, toSnakeCase, toMacroCase, toTrainCase, toTitleCase, toUnderscoreCamelCase)
  function/       — pipe, flow, identity, constant, flip — function composition
  array/          — NonEmptyArray<T>, head/tail/last/init, isNonEmpty, asNonEmptyArray
  eq/             — Eq<T> equality type class (strict/string/number/boolean/date, contramap, struct, getArrayEq)
  ord/            — Ord<T> ordering type class (sortBy, min, max, clamp, between, reverse, contramap, struct)
  predicate/      — Predicate<T>, Refinement<A,B> (from, and, or, not, all, any)
  these/          — These<E,A> partial success (Left | Right | Both), Result bridge
  tree/           — Tree<T> recursive hierarchy (map, filter, find, fold, drawTree)
  record/         — Functional object utilities (map, filter, pick, omit, reduce, partition, upsert)
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
Result.traverse(items, fn)                   // A[] → (A → Result<B>) → Result<B[]>, collects ALL errors
await Result.traverseAsync(items, async fn)  // async version

// Fluent chain — bind() NOT then()
chain(Result.success(5)).bind(fn).map(fn).ensure(pred, err).match(ok, err)

// Async pipeline — one await at the end, andThen() NOT then()
// fromAsync takes Promise<Result<T>>, NOT Promise<T>
await fromAsync(promiseOfResult)
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
Functional namespace: all static methods, no class instantiation.

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
Mixin factory pattern instead of deep inheritance.

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

import { HttpCodes } from 'tsentials/http';
import type { HttpCode } from 'tsentials/http';

// Type-safe HTTP status constants
HttpCodes.Ok           // 200
HttpCodes.Created      // 201
HttpCodes.NoContent    // 204
HttpCodes.BadRequest   // 400
HttpCodes.Unauthorized // 401
HttpCodes.Forbidden    // 403
HttpCodes.NotFound     // 404
HttpCodes.Conflict     // 409
// ... 21 total constants
```

### Union\<T\>

```typescript
import { Union } from 'tsentials/union';

type Shape = Union<{ circle: { radius: number }; rect: { w: number; h: number } }>;

// NOTE: use `as Shape` (not `: Shape`) for fresh literals — assignment narrowing
// would otherwise narrow the value to one member and break exhaustive match.
const s = { tag: 'circle', value: { radius: 5 } } as Shape;
Union.match(s, { circle: ({ radius }) => radius * 2, rect: ({ w, h }) => w * h });
Union.is(s, 'circle')    // type guard — narrows to the tagged member
Union.get(s, 'circle')   // value or throws

// Collection utilities
Union.partition(items, 'leftTag', 'rightTag')  // → { lefts: Left[], rights: Right[] }
Union.groupBy(items)                           // → { [tag]: value[] }
```

### Json
Safe JSON parsing that returns `Result<T>` instead of throwing.

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

### String

```typescript
import { toPascalCase, toCamelCase, toKebabCase, toSnakeCase, toMacroCase, toTrainCase, toTitleCase, toUnderscoreCamelCase } from 'tsentials/string';

// Case conversion utilities
toPascalCase('hello-world')          // "HelloWorld"
toCamelCase('hello-world')           // "helloWorld"
toKebabCase('helloWorld')            // "hello-world"
toSnakeCase('helloWorld')            // "hello_world"
toMacroCase('helloWorld')            // "HELLO_WORLD"
toTrainCase('hello_world')           // "Hello-World"
toTitleCase('helloWorld')            // "Hello World"
toUnderscoreCamelCase('helloWorld')  // "_helloWorld"
```

### Function (pipe & flow)

```typescript
import { pipe, flow, identity, constant, flip } from 'tsentials/function';

pipe(5, n => n * 2, n => n + 1, n => String(n))  // "11" — value through unary fns (up to 15 steps)
const f = flow((n: number) => n * 2, n => String(n)); f(5)  // "10" — reusable composition
identity(42)                       // 42
constant(true)()                   // true — always returns the captured value
flip((a: number, b: number) => a - b)(3, 10)  // 7 — reverses binary fn args
```

### Eq\<T\> & Ord\<T\>

Type classes: `Eq<A> = { equals(a, b) }`, `Ord<A> extends Eq<A>` adds `compare(a, b): -1 | 0 | 1`.

```typescript
import { Eq } from 'tsentials/eq';
import { Ord, sortBy, min, max, clamp, between, reverse } from 'tsentials/ord';

// Primitive instances: Eq.strict/string/number/boolean/date, Ord.number/string/boolean/date
const eqUser = Eq.struct({ id: Eq.number, name: Eq.string });   // structural equality
Eq.contramap(Eq.number, (u: User) => u.id)                      // compare by projection
Eq.getArrayEq(Eq.number)                                        // element-wise array equality

const byAge = Ord.contramap(Ord.number, (u: User) => u.age);
sortBy(users, byAge)               // sorted copy (ascending)
sortBy(users, reverse(byAge))      // descending
min(byAge, a, b) / max(byAge, a, b)
clamp(Ord.number, 0, 100, 150)     // 100 — throws if lower > upper
between(Ord.number, 0, 100, 42)    // true
Ord.struct({ name: Ord.string, age: Ord.number })  // field-by-field, short-circuits
```

### Predicate\<T\>

`Predicate<A> = { test(value): boolean }` — composable boolean logic.

```typescript
import { Predicate } from 'tsentials/predicate';

const isAdult = Predicate.from((u: User) => u.age >= 18);
Predicate.and(p1, p2) / Predicate.or(p1, p2) / Predicate.not(p)
Predicate.all(p1, p2, p3)          // every predicate must pass
Predicate.any(p1, p2, p3)          // at least one must pass
Predicate.refinement((v: unknown): v is string => typeof v === 'string')  // narrows on .test()
```

### NonEmptyArray\<T\>

```typescript
import { NonEmptyArray, isNonEmpty, prepend, append, head, tail, last, init, asNonEmptyArray } from 'tsentials/array';

const items: NonEmptyArray<string> = ['a', 'b', 'c'];
head(items) / last(items)          // safe — no Maybe, no null check
tail(items) / init(items)          // plain arrays
isNonEmpty(plainArray)             // type guard, narrows to NonEmptyArray<T>
prepend(0, [1, 2]) / append([1, 2], 3)  // construct NonEmptyArray
asNonEmptyArray([])                // Maybe.none — safe conversion
NonEmptyArray.map(items, fn)       // preserves non-empty guarantee (also: reverse, sort)
NonEmptyArray.filter(items, fn)    // plain array — filtering may empty it
```

### These\<E, A\>

Partial success: `Left` (errors only) | `Right` (value only) | `Both` (value AND errors).
For the `Result` bridge, use `These<AppError[], A>`, since `toResult` expects the error side to be an array.

```typescript
import { These } from 'tsentials/these';
import { Err, type AppError } from 'tsentials/errors';

const parseAge = (raw: string): These<AppError[], number> => {
  const age = Number(raw);
  if (Number.isNaN(age)) return These.left([Err.validation('Age.NaN', 'Not a number')]);
  if (age < 0) return These.both([Err.validation('Age.Negative', 'Clamped to 0')], 0);
  return These.right(age);
};

These.isLeft(t) / These.isRight(t) / These.isBoth(t)   // type guards — narrow
These.map(t, fn) / These.mapLeft(t, fn) / These.flatMap(t, fn)
These.tap(t, fn) / These.tapLeft(t, fn)
These.match(t, onLeft, onRight, onBoth)                // exhaustive
These.getRight(t) / These.getLeft(t)                   // value | undefined
These.toResult(t)          // Both → failure (errors win)
These.toResultLenient(t)   // Both → success (errors discarded)
These.fromResult(r)        // Result<T> → These<readonly AppError[], T>
These.partition(theses)    // { lefts: E[], rights: A[], boths: {error, value}[] }
```

### Tree\<T\>

`Tree<T> = { value: T; forest: Tree<T>[] }` — recursive hierarchies.

```typescript
import { Tree, drawTree } from 'tsentials/tree';

const t = Tree.of('Electronics', [
  Tree.of('Phones', [Tree.leaf('iPhone'), Tree.leaf('Android')]),
  Tree.leaf('Laptops'),
]);

Tree.toArray(t)            // ['Electronics', 'Phones', 'iPhone', 'Android', 'Laptops'] (pre-order)
Tree.toArrayWithDepth(t)   // [{ value, depth }, ...]
Tree.size(t)               // 5
Tree.map(t, fn)            // preserves structure
Tree.filter(t, pred)       // Tree<T> | null — parent kept if any descendant matches
Tree.find(t, pred)         // first matching node (depth-first) | null
Tree.findAll(t, pred)      // all matching nodes
Tree.fold(t, (value, childResults) => ...)  // post-order reduction
drawTree(t)                // pretty-printed with ├── └── lines
```

### Record utilities

Functional operations on plain objects. NOTE: `upsert`'s key must belong to the record's key union.

```typescript
import { Record as R } from 'tsentials/record';

R.keys(rec) / R.values(rec) / R.entries(rec)   // typed arrays
R.has(rec, key) / R.size(rec) / R.isEmpty(rec)
R.map(rec, (v, k) => ...)                      // preserves keys
R.mapWithKey(rec, (k, v) => [newKey, v])       // can rename keys
R.filter(rec, pred)                            // Partial<Record<K, V>>
R.filterMap(rec, v => mappedOrNull)            // map + drop nullish results
R.upsert(rec, key, value)                      // immutable insert/update
R.remove(rec, key) / R.pick(rec, ...keys) / R.omit(rec, ...keys)
R.reduce(rec, initial, (acc, v, k) => ...)
R.partition(rec, pred)                         // { pass, fail }
```

## TypeScript configuration
- `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`
- ESM only (`"type": "module"`), `moduleResolution: "bundler"`
- `"sideEffects": false` in package.json for full tree-shaking

## Testing
Vitest. `npm test` runs all 1079 tests across 33 test files.
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
