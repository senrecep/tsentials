---
name: tsentials-http
description: Use when making HTTP calls that should return Result<T> instead of throwing — fetchResult const object with get/post/put/patch/delete methods, RequestBuilder for fluent header/query-param/body construction with .send<T>(), httpStatusToError for status-to-AppError mapping, extractErrorDescription for ProblemDetails parsing, server-side conditional request helpers (computeETag, formatETag, notModified for 304, checkIfMatch for 412/428), and server-side problem+json responses from AppErrors or a Result (toProblemDetails, toProblemResponse, resultToResponse).
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
import { computeETag, formatETag, notModified, checkIfMatch } from 'tsentials/http';
import { toProblemDetails, toProblemResponse, resultToResponse } from 'tsentials/http';
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

A 2xx JSON response with an empty or `null` body is a NotFound failure (code `NotFound`), except for `fetchResult.delete`, which succeeds with `undefined`. 204/205 and non-JSON responses are void successes. A body that is not read (204/205, a non-JSON 2xx or error response) is cancelled so the connection is released.

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

// DELETE — send<T>() expects a value: an empty/null JSON body is a NotFound failure
// (use fetchResult.delete for a DELETE that may answer with an empty body)
const deleted = await RequestBuilder.delete(`https://api.example.com/users/${id}`)
  .header('Authorization', `Bearer ${token}`)
  .send<DeleteReceipt>();

// Raw (non-JSON) body on POST/PUT/PATCH — .body() bypasses JSON serialization entirely
const uploaded = await RequestBuilder.post('https://api.example.com/upload')
  .header('Content-Type', 'text/plain')
  .body(rawText)
  .send<UploadResult>();
```

`.json(value)` stringifies `value` and sets `Content-Type: application/json`. `.body(raw)` sends `raw` (a `BodyInit` — string, `Blob`, `FormData`, `ArrayBuffer`, ...) untouched, with no assumption that it's JSON — `send<T>()` never runs `JSON.parse`/`JSON.stringify` on a `.body()` payload, so it can't throw on non-JSON content. Calling `.json()` after `.body()` (or vice versa) simply replaces whichever was set last.

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
| `.header(name, value)` | Add a request header; the same name again adds another value (`Content-Type` is replaced) |
| `.query(name, value)` | Append a query string parameter |
| `.json(body)` | Set body as JSON + Content-Type header |
| `.body(body: BodyInit)` | Set raw body |
| `.idempotencyKey(key?, { idempotencyKeyGenerator }?)` | Set `Idempotency-Key` (a UUID, or your generator's result, created once when omitted and validated like an explicit key; every `send()` reuses it) |
| `.send<T>()` | Send request, returns `Promise<Result<T>>` |

---

## Cancellation and timeout

`fetchResult` and `RequestBuilder` accept an `AbortSignal` and a request timeout.

```typescript
const ctrl = new AbortController();

await fetchResult.get<User>('/users/42', { signal: ctrl.signal, timeout: 5_000 });

await RequestBuilder.get('/users')
  .query({ limit: 10, q: undefined })   // record form; null/undefined values are skipped
  .timeout(5_000)
  .signal(ctrl.signal)
  .send<User[]>();
```

- **AbortSignal convention:** the caller's abort rejects the promise with `signal.reason`; it never becomes a `Result`. Network, HTTP and body-parse errors become failures.
- A 2xx JSON body that cannot be parsed is a `Validation` failure (code `SyntaxError`, with `httpStatus` metadata), so a retry does not repeat it. A JSON request body that cannot be serialized (cyclic object, BigInt) is a `Validation` failure (code `TypeError`) and no request is sent. `RequestBuilder.json()` never throws: it serializes the value once, in `send()`.
- Default timeout is 30 s (`timeout` in ms; `0` or `Infinity` disables it). On expiry the result is a failure with code `Http.Timeout` (`Unexpected`).

---

## Idempotency keys and retries

```typescript
import { withIdempotencyKey, idempotentRetryClassifier, HttpErrorMetadataKeys } from 'tsentials/http';

const init = withIdempotencyKey({ method: 'POST', body });   // one key for every retry of this operation
await ResiliencePolicy.create()
  .withRetry({ shouldRetry: idempotentRetryClassifier('POST', true) })
  .execute((signal) => fetchResult.send<Order>('/orders', { ...init, signal }));
```

- `idempotentRetryClassifier(method, hasKey)` treats GET, HEAD, PUT, DELETE and OPTIONS as safe and every other method as unsafe. It never retries an unsafe method without a key or a replayed response. It retries network errors, timeouts, 408, 429, 503 and 504, any other 5xx for a safe method only, and 409 `Idempotency.InFlight` only when `hasKey` is `true`.
- A failed response's first error carries `HttpErrorMetadataKeys` metadata: `httpStatus`, `retryAfterMs` (from `Retry-After`, see `parseRetryAfter`), `idempotencyReplayed`, `problemCode`.
- Server side: `tsentials/idempotency` (`withIdempotency`).

---

## Conditional requests (ETag, 304, If-Match)

```typescript
import { computeETag, formatETag, notModified, checkIfMatch } from 'tsentials/http';

// GET: answer 304 when the client's copy is current
async function getItem(request: Request): Promise<Response> {
  const item = await load();
  const etag = formatETag(item.version);                 // '"7"'; computeETag(body) hashes content
  const headers = { 'cache-control': 'max-age=60' };
  return notModified(request, { etag, lastModified: item.updatedAt }, headers)
    ?? Response.json(item, { headers: { ...headers, etag } });
}

// PUT/PATCH/DELETE: optimistic concurrency
async function updateItem(request: Request): Promise<Response> {
  const item = await load();                             // null when it does not exist
  const rejected = checkIfMatch(request, item && { etag: formatETag(item.version) }, { required: true });
  if (rejected) return rejected;                         // 400, 412 or 428 problem+json
  // ... write, passing the version as a concurrency token
}
```

- `formatETag(value, { weak })` quotes an opaque value (`RangeError` for spaces, quotes, non-ASCII). `computeETag(stringOrBytes, { weak })` is the base64url SHA-256 (Web Crypto). Both strong by default.
- `notModified(request, { etag, lastModified }, headers?)` only answers `GET`/`HEAD`. `If-None-Match` uses weak comparison and `*` matches; without it, `If-Modified-Since` is compared with second precision. The 304 has no body and carries `ETag`, `Last-Modified` and `headers`. Returns `undefined` when the full response should be sent.
- `checkIfMatch(request, current, { required })` only evaluates `POST`, `PUT`, `PATCH`, `DELETE`. `current` is `null`/`undefined` when the resource does not exist. Strong comparison, so weak tags never match; `*` passes for any existing resource. Responses: 428 `Http.PreconditionRequired` (missing header with `required`), 400 `Http.InvalidIfMatch` (malformed, or `*` mixed with tags), 412 `Http.PreconditionFailed` (mismatch or missing resource). Codes are in `ConditionalErrorCodes`.
- `parseETagList(header)` returns `'*'`, the tags as written, `[]` for a missing header, or `undefined` when malformed. `compareETags(a, b, 'strong' | 'weak')` follows RFC 9110 section 8.8.3.2.
- The `If-Match` check is not atomic with the write. `If-Unmodified-Since` and `If-None-Match` on unsafe methods are not evaluated.

## Problem responses (server side)

```typescript
import { resultToResponse, toProblemDetails, toProblemResponse } from 'tsentials/http';

return resultToResponse(await createUser(input));        // 200 JSON, 204 for Result.ok(), or problem+json
return toProblemResponse([Err.notFound('User.NotFound', 'User 7 was not found.')], {
  extensions: { traceId },
  headers: { 'cache-control': 'no-store' },
});
const body = toProblemDetails(errors);                    // the plain object
```

- The body matches CSharpEssentials.AspNetCore: `{ type, title, status, detail, ...extensions, errorCodes, errors? }`. The primary error is the one with the highest `errorTypeToHttpStatus` status (the first on a tie) and gives `status`, `title` (from its `ErrorType`, such as `Not Found` or `Validation Error`) and `detail`.
- `type` is the RFC 9110 section link (`rfc9110TypeUri`), left out for statuses without one. `errorCodes` lists every code once, in order. `errors` lists the `Validation` errors as `{ code, description }` and is left out when there are none.
- Options: `status` and `title` replace the defaults (an overridden status without `title` has no title), `typeUri` replaces the link resolver, `extensions` adds members, `headers` adds response headers.
- The body reads back with `problemDetailsToErrors` (and so with `fetchResult` on the client): codes, order and types are kept; a non-validation error that is not primary takes the primary error's description and the type of the status.
- `toProblemDetails([])` throws a `TypeError`.

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
| Malformed 2xx JSON body | Validation | Code `SyntaxError` |
| Unserializable JSON request body | Validation | Code `TypeError`, nothing sent |

The error code format is `Http.{status}` (e.g., `Http.404`, `Http.500`).

A ProblemDetails body overrides the code (`problemDetailsToErrors`):

- `errors` extension: one `AppError` per entry (list `[{ code, description, type? }]` or dictionary `{ key: string[] }`); entries without a valid `type` are `Validation`.
- `errorCodes` extension (CSharpEssentials.AspNetCore writes it on every problem): the server's domain codes are kept, in that order. A code with entries in `errors` yields those entries; a code without one yields an error with that code, the status type and `detail` (then `title`) as the description.

```typescript
// 404 body: {"title":"Not Found","status":404,"detail":"No user with id 42.","errorCodes":["User.NotFound"]}
// AppError { code: 'User.NotFound', description: 'No user with id 42.', type: 'NotFound' }
```

Only when the body has neither does the code fall back to `Http.{status}`.

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
- Works in both Node.js >= 22 (built-in `fetch`) and browser environments
- POST/PUT/PATCH on `fetchResult` take `body` as the second argument (auto-serialized to JSON)
