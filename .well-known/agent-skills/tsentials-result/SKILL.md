---
name: tsentials-result
description: Use when handling operation outcomes without exceptions — Result<T> for success/failure, railway-oriented chaining with then/map/ensure, ResultChain for fluent sync pipelines, ResultAsync<T> for async chains that resolve once at the end, Result.combine for merging heterogeneous results, and maybe-bridge for Maybe<->Result conversion.
---

# tsentials/result

`Result<T>` models operation outcomes as values. No exceptions for control flow — errors are data.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { Result, ResultChain, chain, ResultAsync, fromAsync } from 'tsentials/result';
import type { VoidResult } from 'tsentials/result';
import { maybeToResult, resultToMaybe } from 'tsentials/result';
```

---

## Result\<T\>

Discriminated union: `{ ok: true; value: T } | { ok: false; errors: AppError[] }`.

```typescript
import { Err } from 'tsentials/errors';

// Success
const ok: Result<number> = Result.success(42);

// Failure
const fail: Result<number> = Result.failure(Err.validation('Input.Invalid', 'Input was invalid.'));

// Failure with multiple errors
const multi: Result<number> = Result.failure(
  Err.validation('Name.Empty', 'Name is required.'),
  Err.validation('Email.Invalid', 'Email is invalid.'),
);

// Void result (no value)
const voidOk: VoidResult = Result.ok();

// Conditional creation
Result.successIf(age >= 18, user, Err.validation('Age.Invalid', 'Must be 18+'));
Result.failIf(user.isBanned, user, Err.validation('User.Banned', 'Banned'));
```

## Checking the Result

```typescript
if (result.ok) {
  console.log(result.value); // T — only available when ok === true
} else {
  console.log(result.errors[0]?.description); // AppError[] — only when ok === false
}

// Type guards
Result.isSuccess(result) // narrows to { ok: true; value: T }
Result.isFailure(result) // narrows to { ok: false; errors: AppError[] }

// Error accessors
Result.firstError(result) // AppError — first error (or synthetic error if success)
Result.lastError(result)  // AppError — last error
```

---

## Result Static Functions — Full API

All static functions take `(result, ...)` as first argument. They are NOT curried.

### Factories

| Function | Description |
|----------|-------------|
| `Result.success(value)` | Successful `Result<T>` |
| `Result.ok()` | Successful `VoidResult` |
| `Result.failure(...errors)` | Failed `Result<T>` (1+ AppError) |
| `Result.failureFrom(errors)` | Failed from `readonly AppError[]` |
| `Result.fromValue(value)` | Alias for `Result.success(value)` |
| `Result.fromError(error)` | Alias for `Result.failure(error)` |
| `Result.successIf(cond, value, error)` | Success if true, failure otherwise |
| `Result.failIf(cond, value, error)` | Failure if true, success otherwise |
| `Result.try(fn, onError?)` | Catches thrown exceptions -> `Result<T>` |
| `Result.tryAsync(fn, onError?)` | Async version of `try` -> `Promise<Result<T>>` |

> **CRITICAL:** `Result.try()` — NOT `Result.trySync()`. `trySync` does not exist.

### Sync Pipeline

| Function | Signature | Description |
|----------|-----------|-------------|
| `Result.then(r, fn)` | `(Result<T>, (T) => Result<U>) => Result<U>` | Monadic bind (flatMap) |
| `Result.map(r, fn)` | `(Result<T>, (T) => U) => Result<U>` | Transform success value |
| `Result.ensure(r, pred, err)` | `(Result<T>, pred, AppError \| (T) => AppError) => Result<T>` | Guard — fails if predicate false |
| `Result.tap(r, fn)` | `(Result<T>, (T) => void) => Result<T>` | Side effect on success |
| `Result.tapError(r, fn)` | `(Result<T>, (AppError[]) => void) => Result<T>` | Side effect on failure |
| `Result.tapErrorFirst(r, fn)` | `(Result<T>, (AppError) => void) => Result<T>` | Side effect on first error only |
| `Result.mapError(r, fn)` | `(Result<T>, (AppError[]) => AppError[]) => Result<T>` | Transform errors |
| `Result.match(r, onOk, onErr)` | `(Result<T>, (T) => U, (AppError[]) => U) => U` | Exhaustive pattern match |
| `Result.matchFirst(r, onOk, onErr)` | Pattern match using first error only |
| `Result.matchLast(r, onOk, onErr)` | Pattern match using last error only |
| `Result.switch(r, onOk, onErr)` | Void-only pattern match (side effects) |
| `Result.switchFirst(r, onOk, onErr)` | Void switch using first error |
| `Result.switchLast(r, onOk, onErr)` | Void switch using last error |
| `Result.else(r, fallback)` | `(Result<T>, T \| (AppError[]) => T) => Result<T>` | Fallback value on failure |
| `Result.compensate(r, fn)` | `(Result<T>, (AppError[]) => Result<T>) => Result<T>` | Recover from failure |
| `Result.compensateFirst(r, fn)` | Recover using first error only |
| `Result.recover(r, pred, fn)` | Recover only if predicate matches first error |
| `Result.failWhen(r, pred, err)` | Opposite of ensure — fails if predicate true |
| `Result.ensureNotNull(r, err)` | Guards against null/undefined value |
| `Result.tryCatch(r, fn, err?)` | Apply fn to value, catch exceptions |
| `Result.always(r, fn)` | Unconditional — returns `fn(result)` |

### Conditional Pipeline

| Function | Description |
|----------|-------------|
| `Result.bindIf(r, cond, fn)` | Bind only if condition true; `cond: boolean \| (T) => boolean` |
| `Result.tapIf(r, cond, fn)` | Tap only if condition true |
| `Result.tapErrorIf(r, cond, fn)` | TapError only if condition true; `cond: boolean \| (AppError[]) => boolean` |

### Extraction

| Function | Description |
|----------|-------------|
| `Result.unwrap(r)` | Returns value or throws `ResultUnwrapError` |
| `Result.unwrapOr(r, defaultValue)` | Returns value or default |
| `Result.unwrapOrElse(r, fn)` | Returns value or computes from errors |
| `Result.deconstruct(r)` | `[ok: true, value: T, errors: null] \| [ok: false, value: null, errors: AppError[]]` |
| `Result.tryGet(r)` | `[ok, value, errors]` tuple with undefined instead of null |

### Combination

| Function | Description |
|----------|-------------|
| `Result.and(results)` | All must succeed -> `Result<T[]>`, collects ALL errors |
| `Result.or(results)` | First success wins, else all errors |
| `Result.combine(r1, r2, ...)` | Heterogeneous -> `Result<[T1, T2, ...]>`, collects ALL errors |
| `Result.flatten(r)` | `Result<Result<T>>` -> `Result<T>` |
| `Result.ap(fab, fa)` | Applicative apply |
| `Result.partition(results)` | Split into `{ ok: T[], err: AppError[] }` |
| `Result.sequence(promises)` | `Promise<Result<T>>[]` -> `Promise<Result<T[]>>` |

### Async Static Pipeline

These take a sync `Result<T>` and an async function:

| Function | Description |
|----------|-------------|
| `Result.thenAsync(r, fn)` | Async monadic bind |
| `Result.mapAsync(r, fn)` | Async map |
| `Result.ensureAsync(r, pred, err)` | Async ensure |
| `Result.tapAsync(r, fn)` | Async tap |
| `Result.tapErrorAsync(r, fn)` | Async tapError |
| `Result.mapErrorAsync(r, fn)` | Async mapError |
| `Result.compensateAsync(r, fn)` | Async compensate |
| `Result.compensateFirstAsync(r, fn)` | Async compensateFirst |
| `Result.recoverAsync(r, pred, fn)` | Async recover |
| `Result.bindIfAsync(r, cond, fn)` | Async conditional bind |
| `Result.alwaysAsync(r, fn)` | Async always |
| `Result.tryCatchAsync(r, fn, err?)` | Async tryCatch |

---

## ResultChain — fluent sync pipeline

```typescript
import { chain, ResultChain } from 'tsentials/result';

const price = chain(Result.success(100))
  .map(n => n * 1.2)
  .ensure(n => n < 200, Err.validation('Price.TooHigh', 'Exceeds limit'))
  .bind(n => divide(n, 2))
  .map(n => `$${n.toFixed(2)}`)
  .match(
    s => s,
    () => '$0.00',
  );
// => "$60.00"
```

> **CRITICAL:** Use `.bind()` — NOT `.then()`. `.then()` would make ResultChain look like a thenable to `await`, breaking the pipeline.

### Entry points

| Entry | Description |
|-------|-------------|
| `chain(result)` | Shorthand for `ResultChain.of(result)` |
| `ResultChain.of(result)` | Wrap a `Result<T>` |
| `ResultChain.fromPromise(promise)` | `Promise<Result<T>>` -> `Promise<ResultChain<T>>` |

### Sync methods

| Method | Description |
|--------|-------------|
| `.bind(fn)` | FlatMap — `fn` returns `Result<U>` |
| `.map(fn)` | Transform the success value |
| `.ensure(pred, error)` | Guard; fails if predicate false. `error: AppError \| (T) => AppError` |
| `.tap(fn)` | Side-effect on success |
| `.tapError(fn)` | Side-effect on failure |
| `.mapError(fn)` | Transform error array |
| `.else(fallback)` | Fallback value on failure; `fallback: T \| (AppError[]) => T` |
| `.compensate(fn)` | Recover from failure |
| `.compensateFirst(fn)` | Recover using first error |
| `.recover(pred, fn)` | Recover if predicate matches first error |
| `.bindIf(cond, fn)` | Conditional bind; `cond: boolean \| (T) => boolean` |
| `.tapIf(cond, fn)` | Conditional tap |
| `.tapErrorIf(cond, fn)` | Conditional tapError |
| `.always(fn)` | Unconditional — returns `fn(result)` |
| `.match(onOk, onErr)` | Exhaustive pattern match — exits the chain |
| `.unwrap()` | Returns the underlying `Result<T>` |
| `.unwrapOr(default)` | Returns value or default |
| `.unwrapOrElse(fn)` | Returns value or computes from errors |

> **CRITICAL:** `.unwrap()` returns the underlying `Result<T>`, NOT the raw value. There is NO `.toResult()` method and NO `.getOrElse()` method on ResultChain.

### Async methods (return Promise)

| Method | Description |
|--------|-------------|
| `.thenAsync(fn)` | Async bind -> `Promise<ResultChain<U>>` |
| `.mapAsync(fn)` | Async map -> `Promise<ResultChain<U>>` |
| `.ensureAsync(pred, err)` | Async ensure -> `Promise<ResultChain<T>>` |
| `.tapAsync(fn)` | Async tap -> `Promise<ResultChain<T>>` |
| `.tapErrorAsync(fn)` | Async tapError -> `Promise<ResultChain<T>>` |
| `.compensateAsync(fn)` | Async compensate -> `Promise<ResultChain<T>>` |
| `.compensateFirstAsync(fn)` | Async compensateFirst -> `Promise<ResultChain<T>>` |
| `.recoverAsync(pred, fn)` | Async recover -> `Promise<ResultChain<T>>` |
| `.bindIfAsync(cond, fn)` | Async conditional bind -> `Promise<ResultChain<T>>` |
| `.mapErrorAsync(fn)` | Async mapError -> `Promise<ResultChain<T>>` |
| `.elseAsync(fallback)` | Async else -> `Promise<ResultChain<T>>` |
| `.alwaysAsync(fn)` | Async always -> `Promise<U>` |
| `.matchAsync(onOk, onErr)` | Async match -> `Promise<U>` |

---

## ResultAsync\<T\> — async pipeline

`ResultAsync<T>` implements `PromiseLike<Result<T>>`. The entire chain builds synchronously and resolves **once** at the end with a single `await`.

```typescript
import { fromAsync } from 'tsentials/result';

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

> **CRITICAL:** Use `.andThen()` — NOT `.then()`. `.then()` is the `PromiseLike` protocol method and must not be used for monadic bind.

> **CRITICAL:** `fromAsync()` takes `Promise<Result<T>>`, NOT a sync `Result<T>`. `fromAsync(Result.success(42))` is a TYPE ERROR. Use `ResultAsync.fromResult(Result.success(42))` or `fromAsync(Promise.resolve(Result.success(42)))` instead.

### Static factories

| Factory | Description |
|---------|-------------|
| `fromAsync(promise)` | Convenience alias for `ResultAsync.from(promise)` |
| `ResultAsync.from(promise)` | Wrap `Promise<Result<T>>` |
| `ResultAsync.success(value)` | Resolved successful `ResultAsync<T>` |
| `ResultAsync.ok()` | Resolved successful void `ResultAsync<void>` |
| `ResultAsync.failure(...errors)` | Resolved failed `ResultAsync<T>` |
| `ResultAsync.fromResult(result)` | Lift sync `Result<T>` into `ResultAsync<T>` |
| `ResultAsync.try(fn, onError?)` | Wrap throwing async fn -> `ResultAsync<T>` |
| `ResultAsync.fromThrowable(fn, onError?)` | Create reusable wrapper for throwing async functions |

### Instance methods (all return `ResultAsync<U>` unless noted)

| Method | Description |
|--------|-------------|
| `.andThen(fn)` | Monadic bind — `fn` returns `Result<U>`, `ResultAsync<U>`, or `Promise<Result<U>>` |
| `.map(fn)` | Transform value (sync or async fn) |
| `.ensure(pred, error)` | Guard (sync or async predicate) |
| `.tap(fn)` | Side-effect on success (sync or async) |
| `.tapError(fn)` | Side-effect on failure (sync or async) |
| `.mapError(fn)` | Transform errors (sync or async) |
| `.compensate(fn)` | Recover from failure — `fn` returns `Result<T>`, `ResultAsync<T>`, or `Promise<Result<T>>` |
| `.compensateFirst(fn)` | Recover using first error |
| `.recover(pred, fn)` | Recover if predicate matches first error |
| `.else(fallback)` | Fallback value on failure; `fallback: T \| (AppError[]) => T \| Promise<T>` |
| `.bindIf(cond, fn)` | Conditional bind |
| `.tapIf(cond, fn)` | Conditional tap |
| `.always(fn)` | Unconditional — returns `Promise<U>` |
| `.match(onOk, onErr)` | Exhaustive match — returns `Promise<U>` |
| `.unwrap()` | Returns `Promise<T>` — throws `ResultUnwrapError` if failed |
| `.unwrapOr(default)` | Returns `Promise<T>` — value or default |
| `.toResult()` | Returns `Promise<Result<T>>` — raw promise |

> **CRITICAL:** There is NO `.getOrElse()` on ResultAsync. Use `.unwrapOr(default)` instead.

### Static utilities

| Method | Description |
|--------|-------------|
| `ResultAsync.sequence(results)` | `ResultAsync<T>[]` -> `ResultAsync<T[]>` (all-or-nothing) |
| `ResultAsync.partition(results)` | `ResultAsync<T>[]` -> `Promise<{ ok: T[], err: AppError[] }>` |

---

## Maybe Bridge

```typescript
import { maybeToResult, resultToMaybe } from 'tsentials/result';
import { Maybe } from 'tsentials/maybe';
import { Err } from 'tsentials/errors';

// Maybe -> Result (None becomes failure)
const result = maybeToResult(Maybe.from(user), Err.notFound('User.NotFound', 'User not found'));

// Result -> Maybe (failure becomes None)
const maybe = resultToMaybe(Result.success(42)); // Maybe.some(42)
```

---

## Critical Naming Rules

| Rule | Correct | Wrong |
|------|---------|-------|
| Static monadic bind | `Result.then(r, fn)` | `Result.bind(r, fn)` |
| ResultAsync monadic bind | `.andThen(fn)` | `.then(fn)` — breaks PromiseLike |
| ResultChain monadic bind | `.bind(fn)` | `.then(fn)` — breaks await |
| Error description | `error.description` | `error.message` |
| Catch exceptions | `Result.try(fn)` | `Result.trySync(fn)` — does not exist |
| Chain get result | `.unwrap()` returns `Result<T>` | `.toResult()` — does not exist on ResultChain |
| Chain get value | `.unwrapOr(default)` | `.getOrElse(fallback)` — does not exist |
| fromAsync input | `fromAsync(promise)` — Promise only | `fromAsync(Result.success(42))` — TYPE ERROR |
| Static fn shape | `Result.map(result, fn)` | Not curried |

## Best Practices

- Never access `.value` without checking `.ok === true` first
- `errors` is an array — `result.errors[0]?.description` (not `.message`)
- Use `Result.combine()` to merge independent heterogeneous results before proceeding
- Use `Result.and()` for homogeneous result arrays
- Use `fromAsync()` for all async chains — a single `await` at the end is more efficient than awaiting each step
- Use `.bind()` in `ResultChain` and `.andThen()` in `ResultAsync` — never `.then()`
- Use `ResultAsync.fromResult()` to lift a sync Result into an async pipeline — NOT `fromAsync()`
- Use `Result.try()` to wrap throwing sync functions — NOT `Result.trySync()`
- `Result.ensure` error parameter can be a factory: `(value: T) => AppError` for dynamic error messages
