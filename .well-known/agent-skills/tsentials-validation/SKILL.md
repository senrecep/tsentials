---
name: tsentials-validation
description: Use when validating a model with fluent, eager, Result-based rules — Validator.validate with rules.for('path').notEmpty().maxLength(), nested paths and forEach for collections, cascade modes, subclassable Validator<T>, validateAsync with mustAsync and AbortSignal, validateWith as a railway step.
---

# tsentials/validation

Fluent model validation that returns `Result<T>`. Rules run eagerly; the success value is the validated instance. **Subpath-only:** not exported from the root `tsentials` entry.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { Validator, CascadeMode } from 'tsentials/validation';
import type { RuleContext, RuleChain, Configure, AsyncConfigure } from 'tsentials/validation';
```

---

## Inline validation

```typescript
type User = { name: string; email: string; address: { city: string }; items: { sku: string }[] };

const r = Validator.validate(user, (rules) => {
  rules.for('name').notEmpty().maxLength(50);
  rules.for('email').notEmpty().emailAddress();
  rules.for('address.city').notEmpty();            // dotted paths are type-checked
  rules.forEach('items', (item) => {
    item.for('sku').notEmpty();
  });
});
// r: Result<User>
// failure codes: 'name.NotEmpty', 'email.EmailAddress', 'address.city.NotEmpty', 'items[0].sku.NotEmpty'
```

Error code format is `<path>.<Rule>`; all errors have type `Validation`.

## Validator subclass

```typescript
class UserValidator extends Validator<User> {
  protected configure(rules: RuleContext<User>) {
    rules.for('name').notEmpty().cascade(CascadeMode.Continue).minLength(3).maxLength(50);
  }
}

const validator = new UserValidator();
validator.validate(user);        // Result<User>
validator.toRule();              // Rule<User> — plug into RuleEngine (tsentials/rules)
```

## Cascade and null handling

- Default cascade is `Stop`: the first failure on a chain skips the remaining rules of that chain. Use `.cascade(CascadeMode.Continue)` to accumulate.
- `null`/`undefined` are **skipped** by every built-in rule except `notNull`, `notEmpty` and `equal`. Guard optional values with `notEmpty()` first.

## Built-in rules (on `rules.for(...)`)

| Group | Rules |
|-------|-------|
| Presence | `notNull`, `null`, `notEmpty` |
| String | `maxLength`, `minLength`, `length`, `emailAddress`, `matches`, `contains`, `startsWith`, `endsWith` |
| Comparison | `equal`, `notEqual`, `greaterThan`, `greaterThanOrEqualTo`, `lessThan`, `lessThanOrEqualTo`, `inclusiveBetween`, `exclusiveBetween` |
| Collection | `minCount`, `maxCount`, `countBetween` |
| Enum | `isDefinedEnum`, `isOneOf`, `hasOnlyDefinedFlags` |
| Custom | `must(pred)`, `must(pred, code, message)`, `satisfies(rule)`, `setValidator(v)` |

`rules.forEach(path, configure)` validates each element; `rules.self()` validates the model itself; `rules.addFailure(code, description)` adds an error directly.

## Async validation

```typescript
const r = await Validator.validateAsync(
  user,
  async (rules, _model, signal) => {
    await rules.for('email').mustAsync(async (e) => await isFree(e, signal), 'Email.Taken', 'Already used');
  },
  { signal },
);
```

Await every async rule (`mustAsync`, `forEachAsync`, `setValidatorAsync`, `satisfiesAsync`) inside the callback. `validate()` throws `TypeError` if `configure` returns a promise or leaves an async rule un-awaited.

## Railway step

```typescript
import { Result } from 'tsentials/result';

const checked = Validator.validateWith(Result.success(user), (rules) => {
  rules.for('name').notEmpty();
});
// failure input passes through unchanged; also: Validator.validateWithAsync
```

---

## Patterns and pitfalls

- Import from `tsentials/validation` — never from the root `tsentials` entry.
- **AbortSignal convention:** the caller's abort makes the promise reject with `signal.reason`; it never becomes a validation error. An exception thrown by an async rule predicate or by `configure` rejects too (never a failure); use `mustAsync` predicates that return `false` for validation failures.
- Subclasses implement `configure(rules)` as a **sync** method; use `validateAsync` with an `AsyncConfigure` for async rules.
- Errors use `description`, not `message`: `r.errors[0]?.description`.
- A message argument may be a string or an `AppError`.
