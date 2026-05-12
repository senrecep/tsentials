---
name: tsentials-errors
description: Use when creating structured error values — Err factory methods (validation/notFound/conflict/unauthorized/forbidden/unexpected/custom), AppError with code/description/type/metadata, and ErrorType enum for classification.
---

# tsentials/errors

Errors are values, not exceptions. `AppError` is a plain object with a code, description, type, and optional metadata.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { Err } from 'tsentials/errors';
import type { AppError, ErrorType, ErrorMetadata } from 'tsentials/errors';
```

> **Important:** Import `Err` from `'tsentials/errors'` — NOT from `'tsentials/result'`.

---

## Creating Errors

```typescript
// ErrorType: Validation | NotFound | Conflict | Unauthorized | Forbidden | Unexpected | Custom
Err.validation('Field.Required',     'Name is required.')
Err.notFound('User.NotFound',        'User does not exist.')
Err.unexpected('DB.ConnectionFailed','Cannot connect to database.')
Err.conflict('Email.AlreadyTaken',   'This email is already in use.')
Err.unauthorized('Auth.InvalidToken','Token is expired.')
Err.forbidden('Permissions.Denied',  'Insufficient permissions.')

// With metadata
Err.validation('Age.Invalid', 'Must be 18+', { field: 'age', value: 15 })

// Custom type
Err.custom(ErrorType.Validation, 'Custom.Code', 'message', { field: 'email' })
```

---

## AppError Properties

```typescript
const error: AppError = Err.notFound('User.NotFound', 'User not found.');

error.code         // 'User.NotFound'
error.description  // 'User not found.' — NOT .message
error.type         // ErrorType.NotFound
error.metadata     // ErrorMetadata | undefined
```

> **Important:** The property is `.description`, not `.message`.

---

## ErrorType Enum

```typescript
import { ErrorType } from 'tsentials/errors';

ErrorType.Validation    // 400-class
ErrorType.NotFound      // 404
ErrorType.Conflict      // 409
ErrorType.Unauthorized  // 401
ErrorType.Forbidden     // 403
ErrorType.Unexpected    // 500
ErrorType.Custom        // user-defined
```

---

## Domain-Specific Error Hierarchies

Group errors in plain objects per domain for IDE autocomplete and type-safe codes:

```typescript
import { Err } from 'tsentials/errors';
import type { AppError } from 'tsentials/errors';

const UserErrors = {
  notFound: (id: string): AppError =>
    Err.notFound('User.NotFound', `User '${id}' was not found.`),

  alreadyExists: Err.conflict('User.AlreadyExists', 'A user with that email already exists.'),

  invalidAge: (age: number): AppError =>
    Err.validation('User.InvalidAge', `Age ${age} is invalid; must be 18 or older.`),

  unauthorized: Err.unauthorized('User.Unauthorized', 'You are not authorized.'),
} as const;

// Usage with Result<T>
function findUser(id: string): Result<User> {
  const user = repo.find(id);
  return user ? Result.success(user) : Result.failure(UserErrors.notFound(id));
}
```

---

## Using with Result\<T\>

```typescript
import { Result } from 'tsentials/result';
import { Err } from 'tsentials/errors';

function divide(a: number, b: number): Result<number> {
  if (b === 0) return Result.failure(Err.validation('Math.DivideByZero', 'Cannot divide by zero.'));
  return Result.success(a / b);
}

// Accessing errors
const result = divide(10, 0);
if (!result.ok) {
  result.errors.forEach(e => console.log(`[${e.type}] ${e.code}: ${e.description}`));
}
```

---

## Best Practices

- Group errors in const objects per domain — rules read like domain language
- Use `.description` — the field is `description`, not `message`
- Import `Err` from `'tsentials/errors'`, not `'tsentials/result'`
- Prefer factory functions (parameterized) over static values when the message includes runtime data
- Use `Err.unexpected()` for programming errors and `Err.validation()` for user input errors
