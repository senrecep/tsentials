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
