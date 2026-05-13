---
name: tsentials-meta
description: Use when deciding which tsentials module to use — overview of all 10 subpath imports organized by concern, install command, and a quick-reference table mapping problems to modules.
---

# tsentials — Module Index

tsentials is a modular TypeScript library for railway-oriented programming. Each module is a separate subpath import — import only what you need, everything is tree-shakeable.

## Installation

```bash
npm install tsentials
```

**Requirements:** Node.js ≥ 18, TypeScript ≥ 5.0

## All Modules

### Functional Core

| Import | Contents | Skill |
|--------|----------|-------|
| `tsentials/result` | `Result<T>`, `ResultChain`, `ResultAsync<T>`, `fromAsync` | `tsentials-result` |
| `tsentials/errors` | `AppError`, `ErrorType`, `Err` factory | `tsentials-errors` |
| `tsentials/maybe` | `Maybe<T>`, `tryFirst`, `tryFind`, `choose` | `tsentials-maybe` |
| `tsentials/union` | `Union<T>` discriminated union utility | `tsentials-union` |

### Business Rules

| Import | Contents | Skill |
|--------|----------|-------|
| `tsentials/rules` | `Rule<T>`, `RuleEngine` | `tsentials-rules` |

### Domain Model (DDD)

| Import | Contents | Skill |
|--------|----------|-------|
| `tsentials/entity` | `createEntityBase`, `createSoftDeletable`, `DomainEvent` | `tsentials-entity` |

### Web / Infrastructure

| Import | Contents | Skill |
|--------|----------|-------|
| `tsentials/http` | `fetchResult`, `RequestBuilder` | `tsentials-http` |

### Utilities

| Import | Contents | Skill |
|--------|----------|-------|
| `tsentials/time` | `DateTimeProvider`, `SystemDateTimeProvider`, `createFakeDateTimeProvider` | `tsentials-time` |
| `tsentials/clone` | `Cloneable<T>`, `deepClone`, `cloneArray` | `tsentials-clone` |
| `tsentials/json` | `Json`, `JsonObject`, `JsonArray`, `JsonPrimitive`, `safeJsonParse`, `safeJsonStringify`, `parseAndValidate`, type guards | `tsentials-json` |

---

## Problem → Module Quick Reference

| Problem | Module |
|---------|--------|
| Return errors without throwing exceptions | `tsentials/result` + `tsentials/errors` |
| Chain async operations without try/catch | `tsentials/result` (`fromAsync`) |
| Represent optional / nullable values safely | `tsentials/maybe` |
| Return one of several distinct typed outcomes | `tsentials/union` |
| Compose business validation rules | `tsentials/rules` |
| DDD aggregate base class + domain events | `tsentials/entity` |
| Soft-deletable domain entities | `tsentials/entity` (`createSoftDeletable`) |
| HTTP calls that return Result<T> | `tsentials/http` |
| Testable time / freeze clock in tests | `tsentials/time` |
| Deep-copy domain objects | `tsentials/clone` |
| Parse JSON without try/catch | `tsentials/json` (`safeJsonParse`) |
| Parse JSON and validate against a type | `tsentials/json` (`parseAndValidate`) |

---

## Import Reference

```typescript
import { Result, ResultChain, ResultAsync, fromAsync } from 'tsentials/result';
import { Err, AppError, ErrorType }                    from 'tsentials/errors';
import { Maybe, tryFirst, tryFind, choose }            from 'tsentials/maybe';
import { Union }                                        from 'tsentials/union';
import { RuleEngine }                                   from 'tsentials/rules';
import type { Rule }                                    from 'tsentials/rules';
import { createEntityBase, createSoftDeletable }       from 'tsentials/entity';
import type { DomainEvent }                             from 'tsentials/entity';
import { fetchResult, RequestBuilder }                  from 'tsentials/http';
import { SystemDateTimeProvider, createFakeDateTimeProvider } from 'tsentials/time';
import type { DateTimeProvider }                        from 'tsentials/time';
import { deepClone, cloneArray }                        from 'tsentials/clone';
import type { Cloneable }                               from 'tsentials/clone';
import { safeJsonParse, safeJsonStringify, parseAndValidate } from 'tsentials/json';
import { isJson, isJsonObject }                         from 'tsentials/json';
import type { Json, JsonObject }                        from 'tsentials/json';
```

---

## Key Design Decisions

| Decision | Detail |
|----------|--------|
| `Result<T>` shape | `{ ok: true; value: T } \| { ok: false; errors: AppError[] }` — discriminated union, no class |
| `ResultAsync<T>` | Implements `PromiseLike<Result<T>>` — direct `await`; monadic bind is `andThen()` not `then()` |
| `ResultChain<T>` | Fluent sync wrapper; monadic bind is `bind()` not `then()` |
| `Maybe<T>` | Pure functional namespace — all operations are static functions |
| `Rule<T>` | Just `(ctx: T) => VoidResult` — no interface hierarchy |
| Entity base | Mixin factory pattern (`createEntityBase()`) — not abstract class inheritance |
| `sideEffects: false` | All subpath imports are fully tree-shakeable |
| ESM only | `"type": "module"`, `moduleResolution: "bundler"` |

---

## Common Pitfalls

| Wrong | Correct | Why |
|-------|---------|-----|
| `resultAsync.then(fn)` | `resultAsync.andThen(fn)` | `.then()` is the `PromiseLike` protocol |
| `chain.then(fn)` | `chain.bind(fn)` | Same reason — breaks `await` |
| `import { Err } from 'tsentials/result'` | `import { Err } from 'tsentials/errors'` | `Err` lives in the errors module |
| `error.message` | `error.description` | Property is named `description` |
| `throw new Error(...)` | `Result.failure(Err.unexpected(...))` | Errors are values, not exceptions |
