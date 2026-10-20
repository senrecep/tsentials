// Start Postgres first: docker run --rm -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17-alpine
// Then: npm install && npm test   (DATABASE_URL overrides postgres://postgres:postgres@localhost:5432/postgres)
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { describeIdempotencyStoreContract } from 'tsentials/idempotency';
import { PostgresIdempotencyStore } from './store.mjs';

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
});

before(async () => {
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
});
after(() => pool.end());

// The store uses the database clock, so the suite waits in real time with short leases.
describeIdempotencyStoreContract(
  'PostgresIdempotencyStore (pg)',
  () => new PostgresIdempotencyStore(pool),
  { describe, it },
  {
    leaseMs: 100,
    retentionMs: 300,
    advance: (ms) => new Promise((resolve) => setTimeout(resolve, ms + 50)),
  },
);
