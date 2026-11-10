---
name: tsentials-uuid
description: Use when generating time-ordered ids: uuidv7() for RFC 9562 UUIDv7 strings and monotonicUuidv7() for ids that keep strict order within one millisecond, using Web Crypto and no dependencies.
---

# tsentials/uuid skill

Use when you need ids that sort by creation time, such as database primary keys or event ids.

## API

```typescript
import { uuidv7, monotonicUuidv7 } from 'tsentials/uuid';

uuidv7();          // '019a6f3c-8d2e-7b41-9f3a-1c2d3e4f5a6b'
monotonicUuidv7(); // sorts after every earlier monotonicUuidv7() in this process
```

Both return a lowercase, hyphenated string with version `7` and the RFC variant (`8`, `9`, `a` or `b`).

## Patterns

- The first 48 bits are `Date.now()` in big-endian order: `parseInt(id.replace(/-/g, '').slice(0, 12), 16)` gives the creation time in milliseconds.
- `uuidv7()` fills the other 74 bits from `crypto.getRandomValues`. Two ids in the same millisecond have no defined order.
- `monotonicUuidv7()` puts an 18-bit counter in `rand_a` (12 bits) and the 6 bits after the variant, like the CSharpEssentials `Guider` version 7 monotonic generator. The counter restarts at 0 on each new millisecond. When it overflows, or the clock goes back, the timestamp moves one millisecond ahead, so ids never repeat or go out of order.
- The order holds within one process (one module instance). Ids from several processes are only ordered by millisecond.
- Do not use either as a secret or bearer token: the timestamp is readable and the counter is guessable. Use `crypto.randomUUID()` for those.
