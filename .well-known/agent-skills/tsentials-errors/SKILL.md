---
name: tsentials-errors
description: Use when creating structured error values — Err factory methods (failure/validation/notFound/conflict/unauthorized/forbidden/unexpected/fromException/combine/equals), AppError with code/description/type/metadata, ErrorType enum, and ErrorMetadata namespace.
---

# tsentials/errors

Errors are values, not exceptions. `AppError` is a frozen plain object with a code, description, type, and optional metadata.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { Err, ErrorMetadata } from 'tsentials/errors';
import type { AppError, ErrorType } from 'tsentials/errors';
```

> **Important:** Import `Err` from `'tsentials/errors'` — NOT from `'tsentials/result'`.

---

## Creating Errors

All parameters have defaults — pass only what you need.

```typescript
Err.failure('General.Failure',          'A failure has occurred.')
Err.validation('Field.Required',        'Name is required.')
Err.notFound('User.NotFound',           'User does not exist.')
Err.unexpected('DB.ConnectionFailed',   'Cannot connect to database.')
Err.conflict('Email.AlreadyTaken',      'This email is already in use.')
Err.unauthorized('Auth.InvalidToken',   'Token is expired.')
Err.forbidden('Permissions.Denied',     'Insufficient permissions.')

// With metadata — must use ErrorMetadata.fromRecord(), NOT a plain object
Err.validation('Age.Invalid', 'Must be 18+', ErrorMetadata.fromRecord({ field: 'age', value: 15 }))

// Convert a caught exception to AppError
try {
  JSON.parse(raw);
} catch (e) {
  const err = Err.fromException(e);                                    // ErrorType.Unexpected by default
  const err2 = Err.fromException(e, ErrorType.Validation, 'Json.Invalid'); // override type and code
}

// Combine multiple AppErrors into an array
const errs: AppError[] = Err.combine(Err.validation('A', 'a'), Err.notFound('B', 'b'));

// Structural equality (compares code + description + type)
Err.equals(errA, errB); // boolean
```

---

## AppError Properties

```typescript
const error: AppError = Err.notFound('User.NotFound', 'User not found.');

error.code         // 'User.NotFound'
error.description  // 'User not found.' — NOT .message
error.type         // ErrorType.NotFound
error.metadata     // ErrorMetadata | undefined  (ReadonlyMap<string, unknown>)
```

> **Critical:** The property is `.description`, not `.message`. AppError intentionally avoids the native Error `.message` field.

---

## Err Factory Reference

| Method | ErrorType | Default code |
|--------|-----------|--------------|
| `Err.failure(code?, desc?, metadata?)` | `Failure` | `'General.Failure'` |
| `Err.unexpected(code?, desc?, metadata?)` | `Unexpected` | `'General.Unexpected'` |
| `Err.validation(code?, desc?, metadata?)` | `Validation` | `'General.Validation'` |
| `Err.conflict(code?, desc?, metadata?)` | `Conflict` | `'General.Conflict'` |
| `Err.notFound(code?, desc?, metadata?)` | `NotFound` | `'General.NotFound'` |
| `Err.unauthorized(code?, desc?, metadata?)` | `Unauthorized` | `'General.Unauthorized'` |
| `Err.forbidden(code?, desc?, metadata?)` | `Forbidden` | `'General.Forbidden'` |
| `Err.fromException(error, type?, code?, metadata?)` | `Unexpected` (default) | `error.constructor.name` |
| `Err.combine(...errors)` | — | returns `AppError[]` |
| `Err.equals(a, b)` | — | returns `boolean` |

---

## ErrorType Enum

```typescript
import type { ErrorType } from 'tsentials/errors';

ErrorType.Failure       // general failure
ErrorType.Validation    // 400-class, user input errors
ErrorType.NotFound      // 404
ErrorType.Conflict      // 409
ErrorType.Unauthorized  // 401
ErrorType.Forbidden     // 403
ErrorType.Unexpected    // 500, programming/infrastructure errors
ErrorType.Unknown       // unclassified
```

> **Note:** There is no `ErrorType.Custom`. Use the typed factory that matches your semantic intent.

---

## ErrorMetadata

`ErrorMetadata` is `ReadonlyMap<string, unknown>` — NOT a plain object. Use the namespace helpers to create and manipulate it.

```typescript
import { ErrorMetadata } from 'tsentials/errors';

// Create
ErrorMetadata.empty()                          // empty map
ErrorMetadata.fromRecord({ field: 'email', value: 'bad@' })  // from plain object
ErrorMetadata.fromException(caughtError)       // extracts exceptionType, exceptionMessage, exceptionStack

// Combine (additional overrides base on key conflict)
ErrorMetadata.combine(base, additional?)

// Convert back to plain object
ErrorMetadata.toRecord(metadata)               // Record<string, unknown>
```

```typescript
// Full example: error with metadata
const meta = ErrorMetadata.fromRecord({ field: 'age', provided: 15, minimum: 18 });
const err = Err.validation('User.InvalidAge', 'Must be 18 or older.', meta);

// Read metadata
if (err.metadata) {
  const record = ErrorMetadata.toRecord(err.metadata);
  console.log(record.field); // 'age'
}
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

// Accessing errors from a failed Result
const result = divide(10, 0);
if (!result.ok) {
  result.errors.forEach(e => console.log(`[${e.type}] ${e.code}: ${e.description}`));
}

// Wrapping a try/catch with fromException
async function fetchData(url: string): Promise<Result<Data>> {
  try {
    const res = await fetch(url);
    return Result.success(await res.json() as Data);
  } catch (e) {
    return Result.failure(Err.fromException(e, ErrorType.Unexpected, 'Http.FetchFailed'));
  }
}
```

---

## Best Practices

- Group errors in const objects per domain — rules read like domain language
- Use `.description` — the field is `description`, not `message`
- Import `Err` from `'tsentials/errors'`, not `'tsentials/result'`
- Use `ErrorMetadata.fromRecord({...})` to attach metadata — never pass a plain object directly
- Prefer factory functions (parameterized) over static values when the message includes runtime data
- Use `Err.unexpected()` for programming/infrastructure errors and `Err.validation()` for user input errors
- Use `Err.failure()` for domain-level failures that are expected outcomes (not bugs, not user input)
- Use `Err.fromException()` to convert caught exceptions into typed `AppError` values
