# tsentials — Developer Guide

Railway-oriented programming toolkit for TypeScript.  
Modules: `result`, `maybe`, `errors`, `rules`, `entity`, `http`, `time`, `clone`, `union`.

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
```

### Result<T>
Discriminated union: `{ ok: true; value: T } | { ok: false; errors: AppError[] }`

```typescript
// Sync pipeline
import { Result, ResultChain, Err } from 'tsentials/result';

Result.success(value)
Result.failure(Err.validation('Code', 'message'))
Result.bind(r, fn)   // monadic bind → Result<U>
Result.map(r, fn)    // transform value → Result<U>
Result.ensure(r, pred, err)  // guard
Result.tap(r, fn)    // side effect
Result.match(r, onOk, onErr) // exit pipeline

// Fluent chain
ResultChain.of(result).bind(fn).map(fn).ensure(pred, err).match(ok, err)

// Async pipeline (no intermediate awaits)
await fromAsync(promise)
  .andThen(fn)   // monadic bind (NOT .then — thenable collision)
  .map(fn)
  .ensure(pred, err)
  .tap(fn)
  .match(ok, err)
```

### Critical naming rules
- `ResultAsync.andThen()` — NOT `.then()` (would break PromiseLike protocol)
- `ResultChain.bind()` — NOT `.then()` (same reason: await treats `.then` as thenable)
- `Result.tryAsync()` wraps throwing async fns → `ResultAsync<T>`
- `ResultAsync.fromThrowable()` creates reusable safe wrappers

### Maybe<T>
Functional namespace — all static methods, no class instantiation.

```typescript
import { Maybe } from 'tsentials/maybe';

Maybe.some(value)
Maybe.none<T>()
Maybe.from(nullableValue)       // null/undefined → none
Maybe.fromTry(() => expr)       // throws → none
Maybe.map(m, fn)
Maybe.bind(m, fn)               // fn returns Maybe<U>
Maybe.match(m, onSome, onNone)
Maybe.filter(m, predicate)
Maybe.getOrDefault(m, fallback)
Maybe.getOrElse(m, factory)
Maybe.or(m, fallback)           // Maybe fallback
Maybe.orElse(m, fn)             // lazy Maybe factory
Maybe.tapNone(m, fn)
Maybe.mapIf(m, cond, fn)
Maybe.bindIf(m, cond, fn)
// All have async variants: mapAsync, bindAsync, tapAsync, matchAsync, filterAsync, orAsync
```

### Rule<T>
`type Rule<T> = (ctx: T) => VoidResult` — just a function.

```typescript
import { RuleEngine } from 'tsentials/rules';
import type { Rule } from 'tsentials/rules';

const rule: Rule<User> = ctx =>
  ctx.isActive ? Result.ok() : Result.failure(Err.validation('User.Inactive', 'Not active'));

RuleEngine.and(rule1, rule2)     // all must pass
RuleEngine.or(rule1, rule2)      // at least one must pass
RuleEngine.if(cond, thenRule)    // conditional
RuleEngine.evaluate(rule, ctx)   // returns Promise<VoidResult>
```

### Entity (DDD)
Mixin factory pattern — no deep inheritance.

```typescript
import { createEntityBase, createSoftDeletable } from 'tsentials/entity';

const Base = createEntityBase<string>();
const SoftBase = createSoftDeletable(Base);

class Order extends SoftBase {
  constructor(id: string, public total: number) {
    super({ id });
  }
}
```

## TypeScript configuration
- `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`
- ESM only (`"type": "module"`), `moduleResolution: "bundler"`
- `"sideEffects": false` in package.json for full tree-shaking

## Testing
Vitest — `npm test` runs all 264 tests across 12 test files.
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
