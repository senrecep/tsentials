---
name: tsentials-rules
description: Use when composing business validation logic — define rules as functions returning VoidResult, combine with RuleEngine.and/or/linear/if, evaluate with RuleEngine.evaluate with full async support.
---

# tsentials/rules

Composable rule engine for TypeScript. Define business logic as small rules and combine them freely with full async support.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { RuleEngine } from 'tsentials/rules';
import type { Rule } from 'tsentials/rules';
```

---

## Rule\<T\>

A `Rule<T>` is just a function: `(ctx: T) => VoidResult | Promise<VoidResult>`.

```typescript
import { Result } from 'tsentials/result';
import { Err } from 'tsentials/errors';

type User = { age: number; email: string; emailVerified: boolean };

// Inline rule
const isAdult: Rule<User> = ctx =>
  ctx.age >= 18
    ? Result.ok()
    : Result.failure(Err.validation('User.Underage', 'Must be 18 or older.'));

// Async rule
const hasVerifiedEmail: Rule<User> = async ctx => {
  const verified = await checkEmailVerification(ctx.email);
  return verified
    ? Result.ok()
    : Result.failure(Err.validation('User.EmailUnverified', 'Verify your email first.'));
};
```

---

## Evaluating a Single Rule

```typescript
const result = await RuleEngine.evaluate(isAdult, user);

if (result.ok) {
  console.log('Passed');
} else {
  console.log(result.errors[0]?.description);
}
```

---

## Combining Rules

### `RuleEngine.and` — all must pass (collects all failures)

```typescript
const canRegister = RuleEngine.and(isAdult, hasVerifiedEmail);

const result = await RuleEngine.evaluate(canRegister, user);
// If both fail, result.errors contains errors from both rules
```

### `RuleEngine.or` — at least one must pass

```typescript
const canAccess = RuleEngine.or(isAdmin, isPremiumUser);
```

### `RuleEngine.linear` — stop on first failure

```typescript
const pipeline = RuleEngine.linear(isAdult, hasVerifiedEmail, hasCompletedProfile);
// Stops at the first failing rule — subsequent rules are not evaluated
```

### `RuleEngine.if` — conditional branching

```typescript
const result = await RuleEngine.if(
  isAdult,        // condition rule
  grantAccess,    // success branch
  denyAccess,     // failure branch
  user,
);
```

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

const result = await RuleEngine.evaluate(canRegister, applicant);

if (!result.ok) {
  result.errors.forEach(e => console.log(`[${e.type}] ${e.code}: ${e.description}`));
}
```

---

## Rules with the HTTP Layer

```typescript
import { fromAsync } from 'tsentials/result';

// Use rule evaluation inside a ResultAsync pipeline
const response = await fromAsync(fetchUser(userId))
  .andThen(user => RuleEngine.evaluate(canRegister, user))
  .match(
    () => 'Registration approved',
    errors => `Denied: ${errors.map(e => e.description).join(', ')}`,
  );
```

---

## Best Practices

- `Rule<T>` is just a function — no class, no interface hierarchy required
- `RuleEngine.and()` collects **all** failures; `RuleEngine.linear()` stops at the **first** failure
- Prefer `RuleEngine.linear()` for sequential guards where later checks depend on earlier ones passing
- Group domain errors in const objects — rules read like domain language
- Test each rule in isolation: `await RuleEngine.evaluate(rule, context)` → assert result
