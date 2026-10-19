# Idempotency guide

`tsentials/idempotency` runs an operation once per idempotency key. Later calls with the same key get the stored outcome and the operation does not run again. The module has no runtime dependencies: hashing uses the global Web Crypto API, and stores plug in through a small interface.

```ts
import { createIdempotency, InMemoryIdempotencyStore } from 'tsentials/idempotency';
```

- [Where to use it](#where-to-use-it)
- [One entry point: `createIdempotency`](#one-entry-point-createidempotency)
- [Functions: `idempotent`](#functions-idempotent)
- [Mediator: `idempotencyBehavior`](#mediator-idempotencybehavior)
- [HTTP handlers: `withIdempotency`](#http-handlers-withidempotency)
- [Keys and scopes](#keys-and-scopes)
- [Client side: sending keys and retrying](#client-side-sending-keys-and-retrying)
- [Lease, retention and the retry budget](#lease-retention-and-the-retry-budget)
- [Stores](#stores)
- [Money and credits: a transactional SQL store](#money-and-credits-a-transactional-sql-store)
- [Webhooks](#webhooks)
- [Rolling out: off, observe, enforce](#rolling-out-off-observe-enforce)
- [Error codes and events](#error-codes-and-events)

## Where to use it

| You have | Use |
|----------|-----|
| A function that returns `Result<T>` (a job, a message consumer, a command) | `idempotent(fn, options)` |
| A mediator request | `idempotencyBehavior(options)` |
| A Fetch API handler `(Request) => Response` (Hono, Next.js route handlers, Bun, Deno, Workers) | `withIdempotency(handler, options)` |
| An HTTP client that retries a POST or PATCH | `withIdempotencyKey`, `RequestBuilder.idempotencyKey()`, `idempotentRetryClassifier` (from `tsentials/http`) |

Every wrapper uses the same engine:

1. Resolve the key and the scope. No key → run without idempotency.
2. `reserve` the record `(namespace, scope, key)` with the request fingerprint for `leaseMs`.
3. Reserved → run the operation, then store its outcome for `retentionMs` (or release the key so a retry runs again).
4. Completed with the same fingerprint → replay the stored outcome. Another fingerprint → `Idempotency.KeyReused`. Still running → `Idempotency.InFlight`.

## One entry point: `createIdempotency`

Set the store, mode, durations and observers once. Every wrapper made from the instance inherits them. Precedence: call > route or request type > profile > these defaults.

```ts
const idem = createIdempotency({
  store: new RedisIdempotencyStore(redis),
  mode: () => flags.idempotencyMode,          // read on every call: 'off' | 'observe' | 'enforce'
  onDecision: (e) => metrics.increment('idempotency', { decision: e.decision, source: e.source }),
  logger,
  profiles: {
    payments: { leaseMs: 120_000, serverErrorRetentionMs: 86_400_000 },
  },
});

const capture = idem.idempotent(capturePayment, { namespace: 'capture', key, scope, profile: 'payments' });
const behavior = idem.idempotencyBehavior({ forRequest: { CapturePayment: { profile: 'payments' } } });
const route = idem.withIdempotency(createOrder, { scope: (req) => scopeOf(req) });
```

| Setting | Default | Meaning |
|---------|---------|---------|
| `store` | required | Where records live |
| `mode` | `'enforce'` | `off`, `observe` or `enforce`, or a function read on every call |
| `leaseMs` | 60 000 (1 min) | How long a reservation blocks other calls with the same key. At most `min(retentionMs, 15 min)` |
| `retentionMs` | 86 400 000 (24 h) | How long a completed outcome is replayed |
| `serverErrorRetentionMs` | 600 000 (10 min) | How long a 5xx response or an `Unexpected` failure is replayed. At most `retentionMs` |
| `retryAfterMs` | 1 000 | `Retry-After` of an in-flight rejection; `null` omits it |
| `onDecision` | none | Called for every decision; exceptions are ignored |
| `logger` | none | Receives the fixed-name events and store errors |

Out-of-range values, a missing store and an unknown profile throw at setup, not on the first request.

## Functions: `idempotent`

```ts
import { idempotencyKeys, idempotencyScopes, idempotent } from 'tsentials/idempotency';

const capture = idempotent(capturePayment, {
  store,
  namespace: 'capture-payment',
  key: (cmd: CaptureCommand) => idempotencyKeys.for('capture', cmd.orderId),
  scope: (cmd) => idempotencyScopes.tenant(cmd.tenantId),
});

await capture(cmd); // runs capturePayment
await capture(cmd); // the same Result, capturePayment does not run again
```

- A running call with the same key → Conflict `Idempotency.InFlight` (retryable).
- The same key with other arguments → Validation `Idempotency.KeyReused`. The fingerprint is the arguments by default; `fingerprint: (cmd) => cmd.amount` narrows it.
- A key without a scope → Validation `Idempotency.ScopeRequired`. `unscopedKeyBehavior: 'skip'` runs without idempotency instead, and `'global'` uses one shared scope.
- Successes are kept for `retentionMs`. Failures whose first error is `Unexpected` are kept for `serverErrorRetentionMs`, other failures for `retentionMs`. `storeFailures: false` releases every failure so a retry runs again.
- A function that throws or is aborted keeps the key in flight until the lease ends, and the error propagates. A store that throws rejects the call in `enforce` mode and is logged in `observe` mode.

## Mediator: `idempotencyBehavior`

```ts
import { createMediator, lockBehavior, transactionBehavior, validationBehavior } from 'tsentials/mediator';
import { idempotencyBehavior } from 'tsentials/idempotency';

const mediator = createMediator<Requests>({
  behaviors: [
    validationBehavior(validators),
    idempotencyBehavior({ store, forRequest: { CapturePayment: { profile: 'payments' } } }),
    lockBehavior(locks),
    transactionBehavior(runner),
  ],
});

await mediator.send('CapturePayment', { orderId, idempotencyKey, idempotencyScope: idempotencyScopes.tenant(tenantId) });
```

- Place it after validation and before lock and transaction behaviors.
- By default it reads `idempotencyKey`, `idempotencyScope`, `idempotencyRetentionMs` and `idempotencyLeaseMs` from the request. These fields are trusted input: set them in server code (the scope from the authenticated principal), never copy them from a client payload. A `settings(request, context)` function can read them from somewhere else.
- The namespace is the request name. A missing scope gives `Idempotency.ScopeRequired`, because the key comes from code and a missing scope is a bug.
- A failure of a request with `transactional: true` is released, since its work rolled back; other failures are stored.

## HTTP handlers: `withIdempotency`

```ts
import { withIdempotency, idempotencyScopes } from 'tsentials/idempotency';

export const POST = withIdempotency(
  async (request: Request) => Response.json(await createOrder(await request.json()), { status: 201 }),
  {
    store,
    scope: (request) => idempotencyScopes.user(userIdOf(request)),
    requireKey: true,
  },
);
```

The wrapper guards `POST` and `PATCH` (`methods` changes this) and reads the `Idempotency-Key` header. Other methods pass through.

| Situation | Response |
|-----------|----------|
| No key and `requireKey: true` | 400 `Idempotency.KeyMissing` |
| Malformed key (not 1–255 printable ASCII without `"` and `\`, or a list) | 400 `Idempotency.KeyInvalid` |
| Key without scope, `unscopedKeyBehavior: 'reject'` | 400 `Idempotency.ScopeRequired` |
| Key without scope, `unscopedKeyBehavior: 'skip'` (default) | Handler runs; event `Idempotency.UnscopedKeySkipped` |
| Same key still running | 409 `Idempotency.InFlight` with `Retry-After` |
| Same key, other method, path, query or body | 422 `Idempotency.KeyReused` |
| Same key, same request, completed | The stored status, whitelisted headers and body, plus `Idempotency-Replayed: true` |

Errors are `application/problem+json` bodies `{ title, status, detail, code }`. The `code` is the contract, so clients classify on it.

What is stored:

| Handler outcome | Stored? |
|-----------------|---------|
| 503 or 504 (`neverStoreStatuses`) | No, the key stays in flight until the lease ends |
| 4xx (`shouldStore` default) | No, the key is released so the client can fix the request and retry |
| `Content-Encoding` other than identity, or `text/event-stream` | No, released |
| Body larger than `maxResponseBodyBytes` (1 MiB) | No, released; logs `Idempotency.ResponseTooLarge` |
| 5xx | Yes, for `serverErrorRetentionMs` |
| Anything else | Yes, for `retentionMs` |
| The handler throws | No, the key stays in flight until the lease ends |

`idempotencyStorePolicies.successOnly` stores only 2xx. Replayed headers are `content-type`, `content-language`, `location`, `etag` and `cache-control` by default (`replayedHeaders`); `set-cookie` is never replayed.

Notes:

- The request body is buffered to compute the fingerprint, because Web Crypto has no streaming digest. Enforce a request body size limit before this wrapper.
- Put rate limiting, timeouts and load shedding outside the wrapper, so their responses are not stored.
- Do not wrap streaming routes.

## Keys and scopes

A record is identified by `(namespace, scope, key)`. The same key under another namespace or scope is another record.

**Keys from data.** Derive keys from the business identity, so a retry produces the same key:

```ts
await idempotencyKeys.for('capture', orderId);               // '7:capture|8:order-42'
await idempotencyKeys.for('refund', orderId, refundId);
await idempotencyKeys.fromMessage(messageId, 'billing');     // a UUID; another consumer gets another key
```

`idempotencyKeys` hashes with Web Crypto and is async. `createIdempotencyKeys({ sha256, sha1 })` gives a synchronous variant with injected hash functions, for example from `node:crypto`. A key is valid when `isValidIdempotencyKey(key)` holds; `normalizeIdempotencyKey(raw)` trims a header value and unquotes a structured-field string.

**Scopes.** A scope says whose key it is, so the same key sent by two users gives two records:

```ts
idempotencyScopes.user(userId)                // 'user:<id>'
idempotencyScopes.tenant(tenantId)            // 'tenant:<id>'
idempotencyScopes.userAndTenant(userId, tenantId)
idempotencyScopes.client(clientId)            // an API client or OAuth client
idempotencyScopes.custom('stripe-account', id)
idempotencyScopes.global                      // shared by everyone; use it on purpose only
```

Every builder returns `undefined` for a missing id, which counts as "no scope". Take the scope from the authenticated principal, never from the request body.

**Storage key.** Stores that need one string use `idempotencyStorageKey(recordKey)`: `idem:v1:` followed by the length-prefixed parts `{utf8ByteLength}:{value}` joined with `|`, for example `idem:v1:6:orders|8:tenant:1|3:abc`. Parts that contain `|` or `:` cannot collide.

## Client side: sending keys and retrying

A key belongs to one logical operation. Its lifecycle on the client:

1. Create the key when the user starts the operation (a click on "Pay"), not per HTTP attempt.
2. Send the same key on every retry of that operation. If the operation must survive a page reload or a process restart, persist the key with the pending operation.
3. Start a new key for a new operation, even when the payload is the same.
4. On 422 `Idempotency.KeyReused` stop: the key was used for another request. Never retry it with a new payload.
5. On 409 `Idempotency.InFlight` retry after `Retry-After`; the first attempt is still running.
6. Drop the key once the operation succeeded or failed for good.

```ts
import { fetchResult, idempotentRetryClassifier, withIdempotencyKey, RequestBuilder } from 'tsentials/http';
import { ResiliencePolicy } from 'tsentials/resilience';

const init = withIdempotencyKey({ method: 'POST', body: JSON.stringify(order) }); // one key, reused by every retry
const policy = ResiliencePolicy.create()
  .withRetry({ maxAttempts: 3, shouldRetry: idempotentRetryClassifier('POST', true) })
  .withTimeout(10_000);

const created = await policy.execute((signal) => fetchResult.send<Order>('/orders', { ...init, signal }));

// The builder generates the key once, so every send() of this builder carries it.
const builder = RequestBuilder.post('/orders').json(order).idempotencyKey();
await policy.execute((signal) => builder.signal(signal).send<Order>());
```

`idempotentRetryClassifier(method, hasKey)` never retries a POST or PATCH without a key, never retries a replayed response, retries network errors and timeouts, retries 409 `Idempotency.InFlight`, 408, 429, 503 and 504, and nothing else. `withRetry` waits at least the server's `Retry-After` (capped by `maxRetryAfterMs`). A failed response's first error carries the metadata `httpStatus`, `retryAfterMs`, `idempotencyReplayed` and `problemCode` (`HttpErrorMetadataKeys`).

## Lease, retention and the retry budget

**Rule: `leaseMs` must be at least the client's total retry and timeout budget, and longer than the slowest run of the operation.**

The lease is how long a reservation blocks other calls. When it ends while the first call is still running, the next retry takes the key over and the operation runs twice; the first call's `complete` then fails (event `Idempotency.ReservationLost`). So:

- Budget = attempts × per-attempt timeout + the retry delays. A client with 3 retries, a 10 s timeout and up to 5 s of backoff needs a lease of at least `4 × 10 s + 3 × 5 s = 55 s`.
- A handler that can run for 2 minutes needs a lease above 2 minutes, whatever the client does.
- The lease is capped at 15 minutes. A longer operation should accept the request, return 202 and finish in the background under its own idempotency key.

A crash or a 503/504 keeps the key in flight until the lease ends. A long lease therefore also blocks a client that retries after a crash; pick the shortest lease that satisfies the rule.

`retentionMs` is how long a client may retry and still get the stored outcome; it must cover the longest time a client keeps a pending operation (24 h by default). `serverErrorRetentionMs` keeps a 5xx outcome only briefly, so a client is not locked out of its key for a day after an outage.

## Stores

A store implements `IdempotencyStore`: an atomic `reserve`, plus `complete` and `release` that act only when the stored token still matches (compare-and-set).

| Store | Use for |
|-------|---------|
| `InMemoryIdempotencyStore` | Tests and single-process apps. Atomic within one process |
| `RedisIdempotencyStore` | Several processes. Each operation is one Lua script on one key, so it also runs on Redis Cluster |
| Your own (SQL, DynamoDB, …) | Run `describeIdempotencyStoreContract` against it |

**Redis.** Bring your own client through `RedisLike`, which only needs `eval`:

```ts
import { RedisIdempotencyStore, type RedisLike } from 'tsentials/idempotency';

// ioredis
const redis: RedisLike = { eval: (s, keys, args) => client.eval(s, keys.length, ...keys, ...args) };
// node-redis
const redis: RedisLike = { eval: (s, keys, args) => client.eval(s, { keys, arguments: args }) };

const store = new RedisIdempotencyStore(redis, { prefix: 'idem:v1:' });
```

A record is a hash with the fields `t` (token), `f` (fingerprint) and `p` (payload, set once completed). Its TTL is the lease or the retention, so Redis cleans up by itself. The scripts are exported as `RedisIdempotencyScripts`. [`examples/idempotency-redis`](../examples/idempotency-redis) runs the contract suite against a real Redis.

**Key-value stores without compare-and-set are not suitable.** Cloudflare KV, for example, is eventually consistent and has no atomic insert: two requests can both "reserve" the same key, so the operation runs twice. Do not use such a store for idempotency or as a lock; use Redis, a SQL database or Durable Objects instead.

**Your own store.** The contract suite works with any runner that has `describe` and `it`:

```ts
import { describe, it } from 'vitest';
import { describeIdempotencyStoreContract } from 'tsentials/idempotency';

describeIdempotencyStoreContract('MyStore', (clock) => new MyStore({ clock }), { describe, it });

// A store that measures time itself (Redis PX) waits in real time:
describeIdempotencyStoreContract('MyRedisStore', () => new MyRedisStore(), { describe, it }, {
  leaseMs: 100,
  retentionMs: 300,
  advance: (ms) => new Promise((resolve) => setTimeout(resolve, ms + 50)),
});
```

## Money and credits: a transactional SQL store

For payments, credits and stock, the idempotency record must commit or roll back together with the business change. Otherwise a crash between the two either loses the record (the operation runs again) or keeps a record of work that never happened.

tsentials ships no SQL store, because drivers differ (pg, mysql2, better-sqlite3, Drizzle, Prisma). The recipe is a table in your database and a store created with your transaction's client. [`examples/idempotency-sql`](../examples/idempotency-sql) has a complete PostgreSQL store that passes the contract suite.

The table: one row per record, unique on `(namespace, scope, key)`. `expires_at` is epoch milliseconds: the lease end while `payload` is `NULL`, the retention end once the payload is stored.

```sql
CREATE TABLE idempotency_records (
  namespace   text   NOT NULL,
  scope       text   NOT NULL,
  key         text   NOT NULL,
  token       text   NOT NULL,
  fingerprint text   NOT NULL,
  payload     text   NULL,
  expires_at  bigint NOT NULL,
  PRIMARY KEY (namespace, scope, key)
);
CREATE INDEX idempotency_records_expires_at_idx ON idempotency_records (expires_at);
-- Periodic cleanup; the store already ignores and replaces expired rows:
-- DELETE FROM idempotency_records WHERE expires_at <= $1;
```

Each store operation is one atomic statement:

```sql
-- reserve: insert, or take over an expired record. No row returned → read the live record
-- (other fingerprint → mismatch, payload → completed, otherwise in flight).
INSERT INTO idempotency_records AS r (namespace, scope, key, token, fingerprint, payload, expires_at)
VALUES ($1, $2, $3, $4, $5, NULL, $6)
ON CONFLICT (namespace, scope, key) DO UPDATE
  SET token = excluded.token, fingerprint = excluded.fingerprint, payload = NULL, expires_at = excluded.expires_at
  WHERE r.expires_at <= $7
RETURNING token;

-- complete: store the payload only while our reservation holds (or after it was swept).
INSERT INTO idempotency_records AS r (namespace, scope, key, token, fingerprint, payload, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (namespace, scope, key) DO UPDATE
  SET fingerprint = excluded.fingerprint, payload = excluded.payload, expires_at = excluded.expires_at
  WHERE r.token = $4 AND r.payload IS NULL
RETURNING 1;

-- release: delete our in-flight reservation, never a completed record.
DELETE FROM idempotency_records
WHERE namespace = $1 AND scope = $2 AND key = $3 AND token = $4 AND payload IS NULL;
```

Use it inside the transaction of the business work:

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const charge = idempotent((cmd: ChargeCommand) => chargeAccount(client, cmd), {
    store: new PostgresIdempotencyStore(client), // examples/idempotency-sql/store.mjs
    namespace: 'charge',
    key: (cmd) => idempotencyKeys.for('charge', cmd.orderId),
    scope: (cmd) => idempotencyScopes.tenant(cmd.tenantId),
    storeFailures: false,
  });
  const result = await charge(cmd);
  await client.query(result.ok ? 'COMMIT' : 'ROLLBACK');
  return result;
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

The record and the business change commit together. A rollback removes the reservation too, so a retry runs the work again. Under the default `READ COMMITTED` isolation a parallel call with the same key waits for the first transaction, then sees its committed record.

## Webhooks

Webhook providers deliver at least once, so the same event can arrive several times and in parallel. Use the provider's event id as the key:

- Key: `idempotencyKeys.fromMessage(event.id, 'stripe-webhook')`. The consumer name keeps two consumers of the same event apart.
- Scope: the provider account the event belongs to.
- Fingerprint: a constant. The event id already identifies the payload, and a provider may re-serialize the body between deliveries.
- Flow: verify the signature → claim the key → do the work → commit. Verify first, so unsigned requests never touch the store.
- A duplicate gets 2xx, so the provider stops retrying. An error rolls back the transaction (the claim included) and returns 5xx, so the provider retries.

```ts
import { idempotencyKeys, idempotencyScopes, idempotent } from 'tsentials/idempotency';

export async function stripeWebhook(request: Request): Promise<Response> {
  const raw = await request.text();
  const event = verifyStripeSignature(raw, request.headers.get('stripe-signature'));
  if (event === undefined) return new Response('Invalid signature', { status: 400 });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const handle = idempotent((e: StripeEvent) => applyEvent(client, e), {
      store: new PostgresIdempotencyStore(client), // examples/idempotency-sql/store.mjs
      namespace: 'stripe-webhook',
      key: (e) => idempotencyKeys.fromMessage(e.id, 'stripe-webhook'),
      scope: (e) => idempotencyScopes.custom('stripe-account', e.account ?? 'platform'),
      fingerprint: () => 'stripe-event',
      storeFailures: false,
    });
    const result = await handle(event);
    if (!result.ok) {
      await client.query('ROLLBACK');
      return new Response(null, { status: 500 });
    }
    await client.query('COMMIT');
    return new Response(null, { status: 200 }); // first delivery and duplicates alike
  } catch (error) {
    await client.query('ROLLBACK');
    throw error; // the framework answers 5xx
  } finally {
    client.release();
  }
}
```

A parallel duplicate waits on the row lock of the first delivery's uncommitted insert. After the first commits, it sees the completed record and gets the stored result. If the first rolls back, the duplicate claims the key and does the work.

## Rolling out: off, observe, enforce

Turning idempotency on in front of live traffic changes answers: retries that used to run again now get replays or 409/422. Roll out in steps:

1. **`off`**: the wrappers do nothing; the store is not called. Use it as the kill switch.
2. **`observe`**: keys are reserved and outcomes stored, but every call runs and gets its normal answer. Conflicts are reported through `onDecision` and the logger with fixed event names:
   - `Idempotency.Observe.WouldReplay`
   - `Idempotency.Observe.WouldRejectKeyReused`
   - `Idempotency.Observe.WouldRejectInFlight`
   - `Idempotency.Observe.WouldRejectScopeRequired`
3. Watch these events. `WouldRejectKeyReused` usually means a client reuses keys across operations; `WouldRejectScopeRequired` means the scope resolver misses some callers. Fix the clients and resolvers first.
4. **`enforce`**: replays and rejections take effect. Records written in `observe` are used, so a key completed during `observe` is replayed right away.

`mode` accepts a function that is read on every call, so a feature flag can switch modes without a restart:

```ts
const idem = createIdempotency({ store, mode: () => flags.get('idempotency-mode') });
```

Events report a `keyHash` (16 hex characters of the key's SHA-256), never the key itself.

## Error codes and events

| Code | Type | HTTP | Retry? |
|------|------|------|--------|
| `Idempotency.InFlight` | Conflict | 409 + `Retry-After` | Yes, after `Retry-After` |
| `Idempotency.KeyReused` | Validation | 422 | Never |
| `Idempotency.KeyMissing` | Validation | 400 | After adding a key |
| `Idempotency.KeyInvalid` | Validation | 400 | After fixing the key |
| `Idempotency.ScopeRequired` | Validation | 400 | No, a server-side bug |

`IdempotencyEventNames` also has `Idempotency.Decision` (decisions without a fixed name, such as `reserved` and `stored`), `Idempotency.UnscopedKeySkipped`, `Idempotency.StoreFailed`, `Idempotency.CompleteFailed`, `Idempotency.ReservationLost`, `Idempotency.ResponseTooLarge` and `Idempotency.StoredResponseUnreadable`.
