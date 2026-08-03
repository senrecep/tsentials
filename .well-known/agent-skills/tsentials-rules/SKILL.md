---
name: tsentials-rules
description: Use when composing business validation logic — define rules as typed functions returning VoidResult, combine with RuleEngine.and/or/linear/if, evaluate synchronously or asynchronously with evaluateAsync.
---

# tsentials/rules

Composable rule engine for TypeScript. Define business logic as small typed functions and combine them freely. Sync and async rules are separate types.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { RuleEngine } from 'tsentials/rules';
import type { Rule, AsyncRule, TypedRule, TypedAsyncRule } from 'tsentials/rules';
```

---

## Types

```typescript
// Sync rule — returns VoidResult directly (NOT a Promise)
type Rule<TContext> = (context: TContext) => VoidResult;

// Async rule — returns Promise<VoidResult>
type AsyncRule<TContext> = (context: TContext) => Promise<VoidResult>;

// Typed rule — returns a value on success
type TypedRule<TContext, TResult> = (context: TContext) => Result<TResult>;

// Async typed rule
type TypedAsyncRule<TContext, TResult> = (context: TContext) => Promise<Result<TResult>>;
```

> **Critical:** `Rule<T>` is **sync only**. Use `AsyncRule<T>` for async predicates. Do NOT type an `async` function as `Rule<T>`.

---

## Defining Rules

```typescript
import { Result } from 'tsentials/result';
import { Err } from 'tsentials/errors';

type User = { age: number; email: string; emailVerified: boolean };

// Sync rule
const isAdult: Rule<User> = ctx =>
  ctx.age >= 18
    ? Result.ok()
    : Result.failure(Err.validation('User.Underage', 'Must be 18 or older.'));

// Async rule — note: AsyncRule<User>, NOT Rule<User>
const hasVerifiedEmail: AsyncRule<User> = async ctx => {
  const verified = await checkEmailVerification(ctx.email);
  return verified
    ? Result.ok()
    : Result.failure(Err.validation('User.EmailUnverified', 'Verify your email first.'));
};
```

---

## Factories

### `RuleEngine.fromPredicate` — rule from a predicate (sync)

The `error` argument can be a static `AppError` or a factory `(ctx: T) => AppError`.

```typescript
// Static error
const isAdult = RuleEngine.fromPredicate<User>(
  u => u.age >= 18,
  Err.validation('User.Underage', 'Must be 18+'),
);

// Dynamic error (receives context)
const hasBalance = RuleEngine.fromPredicate<Account>(
  a => a.balance > 0,
  a => Err.validation('Account.Insufficient', `Balance ${a.balance} is too low`),
);
```

### `RuleEngine.fromPredicateAsync` — rule from an async predicate

```typescript
const isEmailUnique = RuleEngine.fromPredicateAsync<User>(
  async u => !(await emailExistsInDb(u.email)),
  Err.validation('User.EmailTaken', 'Email already in use'),
);
```

---

## Evaluation

### `evaluate` — synchronous, returns `VoidResult` directly

```typescript
// evaluate() is SYNC — no await needed
const result = RuleEngine.evaluate(isAdult, user);

if (result.ok) {
  console.log('Passed');
} else {
  console.log(result.errors[0]?.description);
}
```

### `evaluateAsync` — asynchronous, returns `Promise<VoidResult>`

```typescript
// evaluateAsync() is for AsyncRule<T>
const result = await RuleEngine.evaluateAsync(hasVerifiedEmail, user);

if (!result.ok) {
  console.log(result.errors[0]?.description);
}
```

---

## Sync Combinators

All sync combinators accept `Rule<TContext>` and return `Rule<TContext>`.

### `RuleEngine.and` — all must pass, collects ALL failures

```typescript
const canRegister = RuleEngine.and(isAdult, hasEmail, isAllowedRegion);

const result = RuleEngine.evaluate(canRegister, user);
// If multiple rules fail, result.errors contains errors from all failing rules
```

### `RuleEngine.linear` — all must pass, stops at first failure

```typescript
const pipeline = RuleEngine.linear(isAdult, hasEmail, hasCompletedProfile);
// Stops at the first failing rule — subsequent rules are not evaluated
// Use when later rules depend on earlier ones passing
```

### `RuleEngine.or` — at least one must pass

```typescript
const canAccess = RuleEngine.or(isAdmin, isPremiumUser);
```

### `RuleEngine.if` — conditional branching, returns `Rule<TContext>`

`RuleEngine.if` returns a **new `Rule<TContext>`** — it does NOT take a context argument. Evaluate the returned rule separately.

```typescript
// Build a conditional rule
const accessRule = RuleEngine.if(
  isAdult,      // condition rule
  grantAccess,  // onTrue branch
  denyAccess,   // onFalse branch (optional)
);

// Evaluate the composed rule
const result = RuleEngine.evaluate(accessRule, user);
```

---

## Async Combinators

All async combinators accept `AsyncRule<TContext>` and return `AsyncRule<TContext>`.

```typescript
RuleEngine.andAsync(...rules)       // all must pass, collects ALL failures
RuleEngine.linearAsync(...rules)    // stops on first failure
RuleEngine.orAsync(...rules)        // at least one must pass
RuleEngine.ifAsync(cond, onTrue, onFalse?)  // conditional, returns AsyncRule<TContext>
```

```typescript
const asyncRule = RuleEngine.andAsync(isEmailUnique, hasVerifiedEmail);
const result = await RuleEngine.evaluateAsync(asyncRule, user);
```

---

## Typed Combinators

Typed rules carry a result value on success (`Result<TResult>` instead of `VoidResult`).

```typescript
// Sync typed combinators
RuleEngine.linearTyped<TContext, TResult>(...rules: TypedRule<TContext, TResult>[])
RuleEngine.andTyped<TContext, TResult>(...rules: TypedRule<TContext, TResult>[])
RuleEngine.orTyped<TContext, TResult>(...rules: TypedRule<TContext, TResult>[])

// Async typed combinators
RuleEngine.linearTypedAsync<TContext, TResult>(...rules: TypedAsyncRule<TContext, TResult>[])
RuleEngine.andTypedAsync<TContext, TResult>(...rules: TypedAsyncRule<TContext, TResult>[])
RuleEngine.orTypedAsync<TContext, TResult>(...rules: TypedAsyncRule<TContext, TResult>[])
```

All three typed combinators return `Result.success(value)` when their rules pass: `andTyped`/`andTypedAsync` carry the *last passing* rule's value, `orTyped`/`orTypedAsync` carry the value of the *first passing* rule, and `linearTyped`/`linearTypedAsync` carry the *last* rule's value once the whole sequence passes. Zero rules is a special case per combinator: `linearTyped`/`linearTypedAsync` return a `RuleEngine.Empty` failure; `andTyped`/`andTypedAsync` return `Result.success(undefined)` (no errors to collect); `orTyped`/`orTypedAsync` **throw** `Error('Result.failureFrom requires at least one error.')` — same as the untyped `or` — because there are no errors to report and no success to return.

---

## Domain Error Hierarchies with Rules

```typescript
const RegistrationErrors = {
  underage:      Err.validation('Registration.Underage', 'Applicant must be at least 18.'),
  noEmail:       Err.validation('Registration.NoEmail', 'Email is required.'),
  regionBlocked: Err.forbidden('Registration.RegionBlocked', 'Not available in your region.'),
} as const;

const isAdult: Rule<ApplicantContext> = ctx =>
  ctx.age >= 18 ? Result.ok() : Result.failure(RegistrationErrors.underage);

const hasEmail: Rule<ApplicantContext> = ctx =>
  ctx.email.length > 0 ? Result.ok() : Result.failure(RegistrationErrors.noEmail);

const isAllowedRegion: Rule<ApplicantContext> = ctx =>
  ctx.isAllowedRegion ? Result.ok() : Result.failure(RegistrationErrors.regionBlocked);

// Compose — collects all failures
const canRegister = RuleEngine.and(isAdult, hasEmail, isAllowedRegion);

const result = RuleEngine.evaluate(canRegister, applicant);

if (!result.ok) {
  result.errors.forEach(e => console.log(`[${e.type}] ${e.code}: ${e.description}`));
}
```

---

## Rules with the HTTP Layer

```typescript
import { fromAsync } from 'tsentials/result';

// evaluate() is sync — call it inside .andThen() to fold it into the async pipeline
const response = await fromAsync(fetchUser(userId))
  .andThen(user => RuleEngine.evaluate(canRegister, user))
  .match(
    () => 'Registration approved',
    errors => `Denied: ${errors.map(e => e.description).join(', ')}`,
  );
```

---

## Best Practices

- `Rule<T>` is sync only — never annotate an `async` function as `Rule<T>`, use `AsyncRule<T>`
- `RuleEngine.and()` collects **all** failures; `RuleEngine.linear()` stops at the **first** failure
- Prefer `RuleEngine.linear()` for sequential guards where later checks depend on earlier ones passing
- `RuleEngine.if()` returns a `Rule<TContext>` — evaluate it with `RuleEngine.evaluate(rule, ctx)`
- `RuleEngine.evaluate()` is sync and returns `VoidResult` directly — no `await` needed
- `RuleEngine.evaluateAsync()` is for `AsyncRule<T>` — always `await` it
- Use `RuleEngine.fromPredicate()` with a factory error `(ctx) => AppError` for context-aware error messages
- Group domain errors in `const` objects — rules read like domain language
- Test each rule in isolation: `RuleEngine.evaluate(rule, context)` → assert result
