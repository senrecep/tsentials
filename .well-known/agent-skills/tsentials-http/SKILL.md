---
name: tsentials-http
description: Use when making HTTP calls that should return Result<T> instead of throwing exceptions — fetchResult wraps the Fetch API with error handling, RequestBuilder for fluent header/query-param request construction.
---

# tsentials/http

Fetch API wrapper that returns `Result<T>` instead of throwing on 4xx/5xx responses. Never catch `fetch` exceptions again.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { fetchResult, RequestBuilder } from 'tsentials/http';
```

---

## fetchResult — direct fetch wrapper

```typescript
import { fetchResult } from 'tsentials/http';

// GET
const result = await fetchResult<User>('https://api.example.com/users/1');

// POST
const created = await fetchResult<Order>('https://api.example.com/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(newOrder),
});

// 2xx → Result.success(T), 4xx/5xx → Result.failure(AppError)
if (result.ok) {
  console.log(result.value); // User
} else {
  console.log(result.errors[0]?.description);
}
```

---

## RequestBuilder — fluent request construction

For requests with multiple headers, query parameters, or both:

```typescript
import { RequestBuilder } from 'tsentials/http';

// GET with headers and query params
const result = await RequestBuilder.get('https://api.example.com/users')
  .header('Authorization', `Bearer ${token}`)
  .header('X-Correlation-Id', correlationId)
  .query('page', '1')
  .query('limit', '20')
  .fetchResult<User[]>();

// POST with body
const posted = await RequestBuilder.post('https://api.example.com/orders')
  .header('Authorization', `Bearer ${token}`)
  .json(newOrder)
  .fetchResult<Order>();

// PUT
const updated = await RequestBuilder.put(`https://api.example.com/users/${id}`)
  .header('Authorization', `Bearer ${token}`)
  .json(userDto)
  .fetchResult<User>();

// DELETE
const deleted = await RequestBuilder.delete(`https://api.example.com/users/${id}`)
  .header('Authorization', `Bearer ${token}`)
  .fetchResult<void>();
```

---

## Chaining with ResultAsync

```typescript
import { fromAsync } from 'tsentials/result';

const profile = await fromAsync(
  RequestBuilder.get('https://api.example.com/users/me')
    .header('Authorization', `Bearer ${token}`)
    .fetchResult<User>(),
)
  .ensure(user => user.isActive, Err.validation('User.Inactive', 'Account is not active.'))
  .map(user => user.profile)
  .match(
    profile => profile,
    () => null,
  );
```

---

## Error Mapping

HTTP errors are automatically mapped to `AppError` with descriptive codes:

| HTTP Status | ErrorType |
|------------|-----------|
| 400 | Validation |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | NotFound |
| 409 | Conflict |
| 5xx | Unexpected |
| Network error | Unexpected |

---

## Best Practices

- Prefer `RequestBuilder` over raw `fetchResult` for multi-header or multi-param requests
- Combine with `fromAsync()` to chain downstream calls without nested try/catch
- Always type the generic parameter `fetchResult<T>()` so TypeScript knows the response shape
- Works in both Node.js ≥ 18 (built-in `fetch`) and browser environments
