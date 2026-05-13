# tsentials — Agent Guide

## Quick Reference

**Package:** `tsentials` (npm)  
**Purpose:** Railway-oriented programming — error-as-value, no exceptions  
**Node:** ≥18, TypeScript ≥5.0, ESM only

## Import Paths

```typescript
import { Result, ResultChain, ResultAsync, fromAsync } from 'tsentials/result';
import { Err } from 'tsentials/errors';
import { Maybe, tryFirst, tryFind, choose } from 'tsentials/maybe';
import { AppError, ErrorType } from 'tsentials/errors';
import { RuleEngine } from 'tsentials/rules';
import type { Rule } from 'tsentials/rules';
import { createEntityBase, createSoftDeletable } from 'tsentials/entity';
import { fetchResult, RequestBuilder } from 'tsentials/http';
import { SystemDateTimeProvider } from 'tsentials/time';
import { deepClone, cloneArray } from 'tsentials/clone';
import { Union } from 'tsentials/union';
import { safeJsonParse, safeJsonStringify, parseAndValidate, isJsonObject } from 'tsentials/json';
import type { Json, JsonObject } from 'tsentials/json';
```

## Core Patterns

### Error handling — always use Result<T>
```typescript
// Return Result<T> from domain functions
function divide(a: number, b: number): Result<number> {
  if (b === 0) return Result.failure(Err.validation('Math.DivideByZero', 'Cannot divide by zero'));
  return Result.success(a / b);
}

// Chain with bind/map/ensure
const result = Result.bind(divide(10, 2), n => Result.success(n * 2));

// Async: use ResultAsync for promise chains
const value = await fromAsync(fetchData())
  .andThen(data => validate(data))  // NOTE: andThen, NOT then
  .map(data => transform(data))
  .match(v => v, () => null);
```

### Null handling — always use Maybe<T>
```typescript
// Wrap nullable values
const name = Maybe.from(user.nickname);

// Chain operations
const display = Maybe.getOrDefault(
  Maybe.map(Maybe.filter(name, s => s.length > 0), s => s.toUpperCase()),
  'Anonymous'
);
```

### Validation — use Rule<T>
```typescript
// Rules are just functions: (ctx: T) => VoidResult
const isAdult: Rule<User> = ctx =>
  ctx.age >= 18 ? Result.ok() : Result.failure(Err.validation('Age.Invalid', 'Must be 18+'));

const result = await RuleEngine.evaluate(RuleEngine.and(isAdult, hasEmail), user);
```

### JSON — always use safeJsonParse, never JSON.parse
```typescript
import { safeJsonParse, safeJsonStringify, parseAndValidate, isJsonObject } from 'tsentials/json';

// Never throws — returns Result<Json>
const result = safeJsonParse('{"name":"Alice","age":30}');
if (result.ok) console.log(result.value);          // { name: "Alice", age: 30 }
else console.error(result.errors[0].code);
// error codes: 'Json.SyntaxError' | 'Json.ValidationError' | 'Json.StringifyFailed'

// Stringify — catches circular references
const json = safeJsonStringify({ id: 1, tags: ['a', 'b'] }); // Result<string>

// Parse + type guard in one step — returns typed Result<T>
function isUser(v: unknown): v is User {
  return isJsonObject(v) && typeof v.name === 'string' && typeof v.age === 'number';
}
const user = parseAndValidate<User>(rawString, isUser); // Result<User>

// isJsonObject — plain objects ONLY, rejects Date / Map / class instances
isJsonObject(new Date())  // false  ← typeof check would pass, this does not
isJsonObject({ a: 1 })    // true

// Chains directly into railway pipeline
const processed = Result.then(safeJsonParse(raw), data => validatePayload(data));
```

## Important: Naming Pitfalls

| Wrong | Correct | Why |
|-------|---------|-----|
| `resultAsync.then(fn)` | `resultAsync.andThen(fn)` | `.then()` is reserved for PromiseLike |
| `chain.then(fn)` | `chain.bind(fn)` | Same reason — breaks await |
| `new AppError(...)` | `Err.validation(code, msg)` | Use factory methods |
| `throw error` | `Result.failure(Err.unexpected(...))` | Errors are values |

## Build & Test

```bash
npm run build      # tsc compile
npm test           # vitest run (652 tests)
npm run check      # biome lint + format check
npm run lint:fix   # auto-fix lint
```
