# Idempotency on PostgreSQL

`PostgresIdempotencyStore` implements the tsentials `IdempotencyStore` on PostgreSQL with `pg`.
`contract.test.mjs` runs `describeIdempotencyStoreContract` against a real database.

```bash
docker run --rm -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17-alpine
npm install
npm test
```

`DATABASE_URL` overrides `postgres://postgres:postgres@localhost:5432/postgres`. The table is in
`schema.sql`; the test creates it. The store reads time from the database, so the suite uses short
leases and waits in real time (a few seconds in total).

## Database time

Every lease and retention comparison uses the database clock, `(extract(epoch from clock_timestamp()) * 1000)::bigint`.
Application servers with skewed clocks therefore agree on when a lease ends. `clock_timestamp()` is
used instead of `now()` because `now()` is frozen for the whole transaction: a store that shares a
long business transaction would compare against stale time. `leaseMs` and `retentionMs` stay query
parameters.

When the store shares a transaction's client, its queries run one at a time on that connection, so
a heartbeat `extend` can wait behind a slow business query. For long handlers prefer a separate
pool or client for the store (see Observe mode for the trade-off).

## Use in a transaction

Create the store with the transaction's client and the idempotency record commits or rolls back
together with your business work. With a pool, each call autocommits.

```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const store = new PostgresIdempotencyStore(client);
  // run idempotent(...) with this store, plus the business work on `client`
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

## Lease extension

`extend` is one `UPDATE` that moves `expires_at` only while the row is live, in flight and holds
the caller's token, so an expired lease is never revived and a completed record is never touched.
The engine calls it every `leaseMs / 3` while the handler runs. On a transaction's client the
heartbeat statements run inside that transaction; there the uncommitted row already blocks other
reserves until commit, and a failed statement that aborts the transaction also makes the next
`extend` fail, which aborts the handler with `ReservationLost` in `enforce`.

## Observe mode

In `observe` every call runs. Create the store with the pool, not the transaction's client: each
`reserve` and `complete` autocommits in its own short statement, so a duplicate does not wait on a
business transaction. This is not atomic with the business work: a rollback after the handler
leaves a completed record, and `enforce` replays completed records. So give observe its own
namespace, and read the mode once per call so the store, the namespace and the mode agree.

```js
const mode = flags.get('idempotency-mode'); // read once per call
const options = {
  store: mode === 'enforce'
    ? new PostgresIdempotencyStore(client) // inside BEGIN ... COMMIT with the business work
    : new PostgresIdempotencyStore(pool),  // observe: own short statements
  namespace: mode === 'enforce' ? 'orders' : 'orders.observe',
  mode: () => mode,
};
```
