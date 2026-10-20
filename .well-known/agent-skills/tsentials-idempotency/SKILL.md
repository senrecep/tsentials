---
name: tsentials-idempotency
description: Use when an operation must run once per idempotency key — idempotent() for functions returning Result<T>, idempotencyBehavior() for mediator requests, withIdempotency() for Fetch API handlers, createIdempotency() for shared settings, InMemory/Redis stores, key and scope helpers, and the off/observe/enforce rollout modes.
---

# tsentials/idempotency

Runs an operation once per `(namespace, scope, key)`. A later call with the same key gets the stored outcome; the operation does not run again. No runtime dependencies (hashing uses the global Web Crypto API). **Subpath-only:** not exported from the root `tsentials` entry.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import {
  createIdempotency, idempotent, idempotencyBehavior, withIdempotency,
  idempotencyKeys, idempotencyScopes, createIdempotencyKeys,
  InMemoryIdempotencyStore, RedisIdempotencyStore, describeIdempotencyStoreContract,
  IdempotencyErrorCodes, IdempotencyEventNames, idempotencyStorePolicies,
} from 'tsentials/idempotency';
import type { IdempotencyStore, RedisLike, IdempotencyMode } from 'tsentials/idempotency';
// client side
import { withIdempotencyKey, idempotentRetryClassifier, RequestBuilder } from 'tsentials/http';
```

---

## Shared settings

```typescript
const idem = createIdempotency({
  store: new RedisIdempotencyStore(redis),
  mode: () => flags.idempotencyMode,          // 'off' | 'observe' | 'enforce', read on every call
  onDecision: (e) => metrics.increment('idempotency', { decision: e.decision }),
  profiles: { payments: { leaseMs: 120_000 } },
});
// idem.idempotent / idem.idempotencyBehavior / idem.withIdempotency inherit these settings.
// Precedence: call > route or request type > profile > defaults. Bad values throw at setup.
```

| Setting | Default |
|---------|---------|
| `leaseMs` | 60 000 (max `min(retentionMs, 15 min)`) |
| `retentionMs` | 86 400 000 (24 h) |
| `serverErrorRetentionMs` | 600 000 (5xx / `Unexpected` failures) |
| `retryAfterMs` | 1 000 (`null` omits `Retry-After`) |

## Functions

```typescript
const capture = idempotent(capturePayment, {
  store,
  namespace: 'capture-payment',
  key: (cmd: CaptureCommand) => idempotencyKeys.for('capture', cmd.orderId),   // may be async
  scope: (cmd) => idempotencyScopes.tenant(cmd.tenantId),
  fingerprint: (cmd) => cmd.amount,          // default: all arguments
});
await capture(cmd); // runs; the second call with the same key returns the stored Result
```

`storeFailures: false` releases every failure so a retry runs again. `unscopedKeyBehavior`: `'reject'` (default here), `'skip'`, `'global'`.

## Mediator

```typescript
createMediator<Requests>({
  behaviors: [validationBehavior(validators), idempotencyBehavior({ store }), lockBehavior(locks), transactionBehavior(runner)],
});
await mediator.send('CapturePayment', { orderId, idempotencyKey, idempotencyScope: idempotencyScopes.tenant(tenantId) });
```

Fingerprint defaults to the whole request: if it has per-retry fields (`requestedAt`, trace id), return an explicit `fingerprint` of the business fields from `settings`, or retries get 422 `KeyReused`. Fingerprints are not canonicalized (key order, whitespace, number formatting matter): clients resend the identical request.
Reads `idempotencyKey`, `idempotencyScope`, `idempotencyRetentionMs`, `idempotencyLeaseMs` from the request (or `settings(request, ctx)`). Namespace = request name. A failure of a `transactional: true` request is released.

## Fetch API handlers

```typescript
export const POST = withIdempotency(createOrder, {
  store,
  scope: (request) => idempotencyScopes.user(userIdOf(request)),
  requireKey: true,
});
```

| Situation | Response |
|-----------|----------|
| No key, `requireKey: true` | 400 `Idempotency.KeyMissing` |
| Malformed key | 400 `Idempotency.KeyInvalid` |
| Key without scope, `unscopedKeyBehavior: 'reject'` (default) | 400 `Idempotency.ScopeRequired` (`'skip'` runs the handler) |
| Same key running | 409 `Idempotency.InFlight` + `Retry-After` |
| Same key, other method/path/query/body | 422 `Idempotency.KeyReused` |
| Same key, completed with a 2xx that could not be stored | 409 `Idempotency.ResultUnavailable`, no `Retry-After`, never retried |
| Reservation lost while the handler ran, then the handler threw that abort (`enforce`) | 503 `Idempotency.ReservationLost` with `Retry-After`; the key is released |
| Same key, completed | stored status, whitelisted headers, body + `Idempotency-Replayed: true` |

Errors are `application/problem+json` with a `code`. Guards POST and PATCH by default. 4xx is released, not stored. Compressed or streaming bodies and bodies over 1 MiB are not stored: a 2xx stores a marker for `retentionMs` (a retry gets 409 `Idempotency.ResultUnavailable`), a 4xx is released, any other status keeps the key in flight until the lease ends, as do 503/504 and a thrown handler; other 5xx is stored for `serverErrorRetentionMs`. Replayed headers: `content-type`, `content-language`, `location`, `etag`, `cache-control`, `retry-after`.

## Keys and scopes

```typescript
await idempotencyKeys.for('refund', orderId, refundId);      // deterministic, from business identity
await idempotencyKeys.fromMessage(messageId, 'billing');     // for('message', consumer, id): one key per (message, consumer)
idempotencyScopes.user(id) / .tenant(id) / .userAndTenant(u, t) / .client(id) / .custom('kind', id) / .global
```

Scope builders return `undefined` for a missing id. A scope is an `IdempotencyScope` that only these builders create; a raw string (`'global'`, `'user:42'`) is a compile error and throws (enforce) or runs without idempotency (observe). `String(scope)` is the storage form; `toJSON()` / `idempotencyScopes.fromJSON(json)` carry it through JSON; the mediator's default reader calls `fromJSON` only with `reviveScopeJson: true` (behavior-wide or per request type), and a custom `settings` must call it itself. `custom(kind, id)` rejects `user`/`tenant`/`client`/`global` in any case, kinds with `:` or `/`, and all-digit kinds; ids and kinds with a lone surrogate throw. A resolver may return `null` for no scope. Storage key: `idem:v3:{len}:{namespace}|{len}:{scope}|{len}:{key}` (`idempotencyStorageKey`).

## Stores

- `InMemoryIdempotencyStore`: tests and one process.
- `RedisIdempotencyStore(redis, { prefix })`: `RedisLike` needs only `eval(script, keys, args)`. ioredis: `client.eval(s, keys.length, ...keys, ...args)`; node-redis: `client.eval(s, { keys, arguments: args })`.
- Own store: compare keys byte for byte (binary no-pad collation: a PAD SPACE one merges `a` and `a `; or key the row by the SHA-256 of `idempotencyStorageKey`, the only option on SQL Server, which pads under every collation); implement `IdempotencyStore` (`reserve`, `complete`, `release` with token compare-and-set, optional `extend` that never revives an expired lease) and run `describeIdempotencyStoreContract(name, (clock) => store, { describe, it })`.
- SQL in the same transaction as the business change: see `docs/IDEMPOTENCY.md` and `examples/idempotency-sql`.

## Client side

```typescript
const builder = RequestBuilder.post('/orders').json(order).idempotencyKey(); // one key for every send()
await ResiliencePolicy.create()
  .withRetry({ shouldRetry: idempotentRetryClassifier('POST', true) })
  .execute((signal) => builder.signal(signal).send<Order>());
```

---

## Patterns and pitfalls

- Import from `tsentials/idempotency`, never from the root `tsentials` entry.
- **Lease rule:** `leaseMs` must cover the slowest handler run plus the client's whole retry and timeout budget; with a store that has `extend`, the heartbeat covers the run (for at most 15 minutes from the reservation), so `leaseMs` must still cover the client's retry and timeout budget, but not the run. `leaseMs` also bounds how long a crashed run blocks the key. Otherwise a retry takes the key over and the operation runs twice (`Idempotency.ReservationLost`).
- **Lease extension:** with a store that has the optional `extend` (InMemory, Redis, the SQL example), the lease is extended every `leaseMs / 3` while the handler runs. If `extend` returns `false`, or no `extend` succeeds before the lease deadline (a throwing `extend` is retried), `Idempotency.ReservationLost` is logged once (15 minutes after the reservation `Idempotency.LeaseLimitReached` instead) and, in `enforce`, the handler's signal aborts with reason name `ReservationLost` (`IdempotencyReservationLostError`); if the handler then throws that abort (its reason or an abort-like error), the key is released and the call answers `Idempotency.ReservationLost` (Unexpected, HTTP 503 + `Retry-After`). Any other error is rethrown; a failure returned after the loss is released, a success is stored (token-fenced). The signal reaches the handler through mediator `ctx.signal`, `idempotent({ bindSignal: (signal, cmd) => [{ ...cmd, signal }] })`, and `withIdempotency({ bindRequest: (req, signal) => new Request(req, { signal }) })` (opt-in; without it the handler gets the original request). `observe` only logs.
- Take the scope from the authenticated principal, never from the request body. Mediator `idempotencyKey`/`idempotencyScope` fields are trusted input.
- One key per logical operation: create it when the user starts the operation, reuse it on every retry, never reuse it for another payload (422 `KeyReused` is final).
- **Cloudflare KV (and any store without atomic insert) is not safe** as an idempotency store or lock.
- Webhooks: key `idempotencyKeys.fromMessage(event.id, 'stripe-webhook')`, scope = provider account, constant fingerprint; verify signature → claim → work → commit; duplicates get 2xx, errors roll back and return 5xx.
- Roll out `observe` before `enforce`: observe answers like `off` and does not prevent duplicates; with the SQL store, observe uses the pool (own short statements) and its own namespace (`<ns>.observe`), not the business transaction, and the mode is read once per call. It reports `Idempotency.Observe.Would…` events. A resolver or call setup that throws in `observe` (invalid mediator key, out-of-range request duration, throwing `settings` / `releaseFailures` / `signal`) runs the call without idempotency (`Idempotency.Observe.ResolutionFailed`).
- `withIdempotency` buffers the request body to fingerprint it; limit body size before it. Do not wrap streaming routes.
- Events carry `keyHash` (16 hex), never the raw key.
