// Start Redis first: docker run --rm -p 6379:6379 redis:7-alpine
// Then: npm install && npm test   (REDIS_URL overrides redis://localhost:6379)
import { after, describe, it } from 'node:test';
import Redis from 'ioredis';
import { describeIdempotencyStoreContract, RedisIdempotencyStore } from 'tsentials/idempotency';

const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
after(() => client.quit());

/** @type {import('tsentials/idempotency').RedisLike} */
const redis = { eval: (script, keys, args) => client.eval(script, keys.length, ...keys, ...args) };

// Redis measures lease and retention itself, so the suite waits in real time.
describeIdempotencyStoreContract(
  'RedisIdempotencyStore (ioredis)',
  () => new RedisIdempotencyStore(redis),
  { describe, it },
  {
    leaseMs: 100,
    retentionMs: 300,
    advance: (ms) => new Promise((resolve) => setTimeout(resolve, ms + 50)),
  },
);
