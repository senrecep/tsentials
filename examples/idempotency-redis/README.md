# Idempotency on Redis

Runs `describeIdempotencyStoreContract` against a real Redis with `RedisIdempotencyStore` and ioredis,
including the `extend` scenarios: the extend script calls `PEXPIRE` only while the hash holds the
caller's token and no payload, so an expired (deleted) key is never revived.

```bash
docker run --rm -p 6379:6379 redis:7-alpine
npm install
npm test
```

`REDIS_URL` overrides `redis://localhost:6379`. For node-redis, adapt the client like this:

```ts
const redis: RedisLike = { eval: (s, keys, args) => client.eval(s, { keys, arguments: args }) };
```
