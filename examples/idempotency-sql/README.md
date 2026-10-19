# Idempotency on PostgreSQL

`PostgresIdempotencyStore` implements the tsentials `IdempotencyStore` on PostgreSQL with `pg`.
`contract.test.mjs` runs `describeIdempotencyStoreContract` against a real database.

```bash
docker run --rm -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17-alpine
npm install
npm test
```

`DATABASE_URL` overrides `postgres://postgres:postgres@localhost:5432/postgres`. The table is in
`schema.sql`; the test creates it. Time comes from the store's `clock` option, so the suite needs no
real waits.

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
