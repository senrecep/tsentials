---
name: tsentials-result
description: Use when handling operation outcomes without exceptions — Result<T> for success/failure, railway-oriented chaining with map/ensure/andThen, ResultChain for fluent sync pipelines, ResultAsync<T> for async chains that resolve once at the end, and Result.combine for merging multiple results.
---

# tsentials/result

`Result<T>` models operation outcomes as values. No exceptions for control flow — errors are data.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { Result, ResultChain, ResultAsync, fromAsync } from 'tsentials/result';
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
```

## Checking the Result

```typescript
if (result.ok) {
  console.log(result.value); // T — only available when ok === true
} else {
  console.log(result.errors[0]?.description); // AppError[] — only available when ok === false
}
```

---

## ResultChain — fluent sync pipeline

```typescript
import { ResultChain } from 'tsentials/result';

const price = ResultChain.of(Result.success(100))
  .map(n => n * 1.2)                                                      // transform value
  .ensure(n => n < 200, Err.validation('Price.TooHigh', 'Exceeds limit')) // guard condition
  .bind(n => divide(n, 2))                                                 // flatMap — returns Result<T>
  .map(n => `$${n.toFixed(2)}`)
  .match(
    s => s,          // onSuccess
    () => '$0.00',   // onFailure
  );
// => "$60.00"
```

> **Important:** Use `.bind()` — NOT `.then()`. `.then()` is reserved for `PromiseLike` and breaks `await`.

### ResultChain methods

| Method | Description |
|--------|-------------|
| `.map(fn)` | Transform the success value |
| `.bind(fn)` | FlatMap — `fn` returns `Result<U>` |
| `.ensure(predicate, error)` | Add a guard; adds error if predicate fails |
| `.tap(fn)` | Side-effect without changing the value |
| `.match(onSuccess, onFailure)` | Consume and unwrap |
| `.getOrElse(fallback)` | Unwrap or return fallback |
| `.toResult()` | Get the underlying `Result<T>` |

---

## ResultAsync\<T\> — async pipeline

`ResultAsync<T>` implements `PromiseLike<Result<T>>`. The entire chain builds synchronously and resolves **once** at the end with a single `await`.

```typescript
import { fromAsync } from 'tsentials/result';

const profile = await fromAsync(fetchUser(userId))
  .andThen(user => validateUser(user))   // flatMap returning Promise<Result<T>> or Result<T>
  .ensure(user => user.isActive, Err.validation('User.Inactive', 'Not active'))
  .map(user => user.profile)
  .tap(p => console.log('fetched', p.name))
  .match(
    profile => profile,
    () => null,
  );
```

> **Important:** Use `.andThen()` — NOT `.then()`. `.then()` is the `PromiseLike` protocol method.

### ResultAsync methods

| Method | Description |
|--------|-------------|
| `.andThen(fn)` | FlatMap — `fn` returns `Result<U>` or `Promise<Result<U>>` |
| `.map(fn)` | Transform the success value (sync or async `fn`) |
| `.ensure(predicate, error)` | Guard condition |
| `.tap(fn)` | Side-effect |
| `.match(onSuccess, onFailure)` | Consume — returns `Promise<R>` |
| `.getOrElse(fallback)` | Unwrap or fallback — returns `Promise<T>` |

### Wrapping async sources

```typescript
// From Promise<Result<T>>
const r1 = fromAsync(someAsyncFn());

// From Result<T> (already resolved)
const r2 = fromAsync(Result.success(42));
```

---

## Static utilities

```typescript
// Combine — all-or-nothing, collects all errors
const combined: Result<[number, string]> = Result.combine(
  Result.success(42),
  Result.success('hello'),
);

// Flatten — unwrap nested Result<Result<T>>
const flat: Result<number> = Result.flatten(Result.success(Result.success(42)));

// trySync — catches thrown exceptions → Result<T>
const safe: Result<number> = Result.trySync(() => JSON.parse(input) as number);

// unwrapOr — extract value or fallback
const val: number = Result.unwrapOr(result, 0);
```

---

## Best Practices

- Never access `.value` without checking `.ok === true` first
- `errors` is an array — `result.errors[0]?.description` (not `.message`)
- Use `Result.combine()` to merge independent results before proceeding
- Use `fromAsync()` for all async chains — a single `await` at the end is more efficient than awaiting each step
- Use `.bind()` in `ResultChain` and `.andThen()` in `ResultAsync` — never `.then()`
