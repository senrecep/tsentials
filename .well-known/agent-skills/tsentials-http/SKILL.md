---
name: tsentials-http
description: Use when making HTTP calls that should return Result<T> instead of throwing — fetchResult const object with get/post/put/patch/delete methods, RequestBuilder for fluent header/query-param/body construction with .send<T>(), httpStatusToError for status-to-AppError mapping, extractErrorDescription for ProblemDetails parsing.
---

# tsentials/http

Fetch API wrapper that returns `Result<T>` instead of throwing on 4xx/5xx responses. Never catch `fetch` exceptions again.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { fetchResult, RequestBuilder, httpStatusToError, extractErrorDescription } from 'tsentials/http';
```

---

## fetchResult — direct fetch wrapper

`fetchResult` is a **const object** with HTTP method functions — not a generic function. Each method returns `Promise<Result<T>>`.

```typescript
import { fetchResult } from 'tsentials/http';

// GET
const result = await fetchResult.get<User>('https://api.example.com/users/1');

// POST with JSON body
const created = await fetchResult.post<Order>('https://api.example.com/orders', newOrder);

// PUT with JSON body
const updated = await fetchResult.put<User>('https://api.example.com/users/1', userDto);

// PATCH with JSON body
const patched = await fetchResult.patch<User>('https://api.example.com/users/1', partial);

// DELETE
const deleted = await fetchResult.delete('https://api.example.com/users/1');

// 2xx → Result.success(T), 4xx/5xx → Result.failure(AppError)
if (result.ok) {
  console.log(result.value); // User
} else {
  console.log(result.errors[0]?.description);
}
```

### fetchResult Method Signatures

```typescript
fetchResult.get<T>(url: string | URL, init?: RequestInit): Promise<Result<T>>
fetchResult.post<T>(url: string | URL, body: unknown, init?: RequestInit): Promise<Result<T>>
fetchResult.put<T>(url: string | URL, body: unknown, init?: RequestInit): Promise<Result<T>>
fetchResult.patch<T>(url: string | URL, body: unknown, init?: RequestInit): Promise<Result<T>>
fetchResult.delete<T = void>(url: string | URL, init?: RequestInit): Promise<Result<T>>
```

POST, PUT, and PATCH automatically set `Content-Type: application/json` and stringify the body.

---

## RequestBuilder — fluent request construction

For requests with multiple headers, query parameters, or custom bodies. The terminal method is `.send<T>()`.

```typescript
import { RequestBuilder } from 'tsentials/http';

// GET with headers and query params
const result = await RequestBuilder.get('https://api.example.com/users')
  .header('Authorization', `Bearer ${token}`)
  .header('X-Correlation-Id', correlationId)
  .query('page', '1')
  .query('limit', '20')
  .send<User[]>();

// POST with JSON body
const posted = await RequestBuilder.post('https://api.example.com/orders')
  .header('Authorization', `Bearer ${token}`)
  .json(newOrder)
  .send<Order>();

// PUT
const updated = await RequestBuilder.put(`https://api.example.com/users/${id}`)
  .header('Authorization', `Bearer ${token}`)
  .json(userDto)
  .send<User>();

// PATCH
const patched = await RequestBuilder.patch(`https://api.example.com/users/${id}`)
  .header('Authorization', `Bearer ${token}`)
  .json(partial)
  .send<User>();

// DELETE
const deleted = await RequestBuilder.delete(`https://api.example.com/users/${id}`)
  .header('Authorization', `Bearer ${token}`)
  .send<void>();

// Raw body (non-JSON)
const uploaded = await RequestBuilder.post('https://api.example.com/upload')
  .header('Content-Type', 'text/plain')
  .body(rawText)
  .send<UploadResult>();
```

### RequestBuilder API

| Static Factory | Returns |
|----------------|---------|
| `RequestBuilder.get(url)` | `RequestBuilder` |
| `RequestBuilder.post(url)` | `RequestBuilder` |
| `RequestBuilder.put(url)` | `RequestBuilder` |
| `RequestBuilder.patch(url)` | `RequestBuilder` |
| `RequestBuilder.delete(url)` | `RequestBuilder` |

| Builder Method | Description |
|----------------|-------------|
| `.header(name, value)` | Add a request header |
| `.query(name, value)` | Append a query string parameter |
| `.json(body)` | Set body as JSON + Content-Type header |
| `.body(body: BodyInit)` | Set raw body |
| `.send<T>()` | Send request, returns `Promise<Result<T>>` |

---

## Chaining with ResultAsync

```typescript
import { fromAsync } from 'tsentials/result';
import { Err } from 'tsentials/errors';

const profile = await fromAsync(
  RequestBuilder.get('https://api.example.com/users/me')
    .header('Authorization', `Bearer ${token}`)
    .send<User>(),
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

HTTP errors are automatically mapped to `AppError` with descriptive codes via `httpStatusToError()`:

| HTTP Status | ErrorType | Notes |
|-------------|-----------|-------|
| 400 | Validation | Bad Request |
| 401 | Unauthorized | |
| 403 | Forbidden | |
| 404 | NotFound | |
| 409 | Conflict | |
| 410 | NotFound | Gone — mapped to NotFound |
| 422 | Validation | Unprocessable Entity — mapped to Validation |
| 429 | Conflict | Too Many Requests — mapped to Conflict |
| 5xx | Unexpected | All server errors |
| Other | Failure | Unmapped status codes |
| Network error | Unexpected | TypeError from fetch |

The error code format is `Http.{status}` (e.g., `Http.404`, `Http.500`).

---

## httpStatusToError / extractErrorDescription

Exported utility functions for custom HTTP handling:

```typescript
import { httpStatusToError, extractErrorDescription } from 'tsentials/http';

// Manual status-to-error mapping
const error = httpStatusToError(404, 'User not found');
// AppError { code: 'Http.404', description: 'User not found', type: 'NotFound' }

// Extract error description from a ProblemDetails (RFC 9457) response
const description = await extractErrorDescription(response);
// Reads `detail` or `title` from application/problem+json or application/json body
```

---

## Best Practices

- `fetchResult` is a const object — use `fetchResult.get<T>(url)`, not `fetchResult<T>(url)`
- `RequestBuilder` terminal method is `.send<T>()` — not `.fetchResult<T>()`
- Prefer `RequestBuilder` over raw `fetchResult` for multi-header or multi-param requests
- Combine with `fromAsync()` to chain downstream calls without nested try/catch
- Always type the generic parameter `send<T>()` / `get<T>()` so TypeScript knows the response shape
- Works in both Node.js >= 18 (built-in `fetch`) and browser environments
- POST/PUT/PATCH on `fetchResult` take `body` as the second argument (auto-serialized to JSON)
