---
name: tsentials-resilience
description: Use when an operation returning Result<T> needs retry, circuit breaker, timeout or fallback — immutable ResiliencePolicy built with withRetry/withCircuitBreaker/withTimeout/withFallback and run via execute(signal => ...), plus retryIfFailed for one-off retries; failures never throw, only the caller's abort rejects.
---

# tsentials/resilience

Composable, immutable resilience pipeline for operations that return `Result<T>`. **Subpath-only:** not exported from the root `tsentials` entry.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { ResiliencePolicy, retryIfFailed, isRetryable, ResilienceErrorCode } from 'tsentials/resilience';
import type { RetryOptions, CircuitBreakerOptions, RetryIfFailedOptions } from 'tsentials/resilience';
```

---

## ResiliencePolicy

```typescript
import { fetchResult } from 'tsentials/http';

const policy = ResiliencePolicy.create()
  .withRetry({ maxAttempts: 3, delay: 200 })   // defaults: 3 retries, 1000 ms, exponential backoff
  .withCircuitBreaker()                        // defaults: minimumThroughput 10, 60 s window, 30 s break, ratio 0.5
  .withTimeout(5_000);                         // per attempt

const user = await policy.execute(
  (signal) => fetchResult.get<User>('/users/42', { signal }),
  { signal },
);
// user: Result<User>
```

- Each `with…` call returns a **new** policy; the strategy is appended **inside** the previous ones (first added = outermost). `withFallback` is always outermost.
- `execute(action, { signal })` — the action receives an `AbortSignal` (aborted by the caller and by the timeout); pass it to the underlying I/O. `executeValue(fn)` wraps a plain value as success.
- Result is awaitable directly (`ResultAsync`) and never rejects except with the caller's abort reason.

### Options

| Method | Options |
|--------|---------|
| `withRetry({ maxAttempts, delay, exponentialBackoff, backoff, shouldRetry, maxRetryAfterMs })` | `backoff`: `'constant' \| 'linear' \| 'exponential'`; `shouldRetry(error)` replaces the retryable check (a throw stops retrying); a failure with `retryAfterMs` metadata waits at least that long, capped at `maxRetryAfterMs` (default 30 s) |
| `withTimeout(ms \| { timeout })` | default 30 000 ms, min 10 ms |
| `withCircuitBreaker({ minimumThroughput, samplingDuration, breakDuration, failureRatio })` | durations >= 500 ms |
| `withFallback(signal => value)` / `withFallbackResult(action)` | value or Result used when everything else failed |

Invalid option values throw `RangeError`.

### Fallback

```typescript
import { Result } from 'tsentials/result';
import { Err } from 'tsentials/errors';

const cached = await ResiliencePolicy.create<string>()
  .withTimeout(10_000)
  .withFallback(() => 'cached')
  .execute(async () => Result.failure<string>(Err.failure('X', 'down')));
// Result.success('cached')
```

## Error codes

| Code | When |
|------|------|
| `Resilience.Timeout` | the timeout strategy cancelled an attempt (type `Failure`) |
| `Resilience.CircuitBroken` | the circuit is open and rejected the call (type `Failure`) |

Compare against `ResilienceErrorCode.Timeout` / `.CircuitBroken`.

## retryIfFailed

```typescript
const order = await retryIfFailed((signal) => loadOrder(id, signal), { maxAttempts: 2, delay: 100 });

await retryIfFailed(op, { shouldRetry: (e) => e.type === 'Conflict', signal });
```

## What is retryable

A failure is retryable unless its **first** error is `Validation`, `NotFound`, `Unauthorized` or `Forbidden`. Thrown values are retryable too (except the caller's abort). `isRetryable(result)` exposes this rule.

---

## Patterns and pitfalls

- Import from `tsentials/resilience` — never from the root `tsentials` entry.
- `maxAttempts` counts **retries**: the action runs at most `maxAttempts + 1` times.
- **AbortSignal convention:** the caller's abort rejects with `signal.reason` and is never retried; any other error (including a timeout) becomes a failure.
- Order matters: `.withRetry().withTimeout()` times out each attempt; `.withTimeout().withRetry()` times out the whole retry sequence.
- Do not call `new ResiliencePolicy()`; use `ResiliencePolicy.create(options?)`.
