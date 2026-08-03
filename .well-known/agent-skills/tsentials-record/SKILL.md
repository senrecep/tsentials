# tsentials/record — Skill

Use when transforming plain objects functionally.

## API

```typescript
import { Record } from 'tsentials/record';

const users = { a: { name: 'Alice' }, b: { name: 'Bob' } };

// Query
Record.keys(users);     // ['a', 'b']
Record.values(users);   // [{ name: 'Alice' }, { name: 'Bob' }]
Record.entries(users);   // [['a', { name: 'Alice' }], ['b', { name: 'Bob' }]]
Record.has(users, 'a');  // true
Record.size(users);      // 2
Record.isEmpty(users);   // false

// Transform
Record.map(users, u => u.name);           // { a: 'Alice', b: 'Bob' }
Record.mapWithKey(users, (k, v) => [k.toUpperCase(), v]); // remap keys + values
Record.filter(users, u => u.name !== 'Bob');
Record.filterMap(users, u => u.name.length > 3 ? u.name : null);

// Modify
Record.upsert(users, 'b', { name: 'Bobby' }); // { a: {...}, b: { name: 'Bobby' } }
Record.remove(users, 'b');
Record.pick(users, 'a');
Record.omit(users, 'b');

// Aggregate
Record.reduce(users, 0, (acc, u) => acc + u.name.length);
Record.partition(users, u => u.name.startsWith('A'));
```

## Patterns

- Use `Record.map` instead of `Object.entries(...).reduce(...)`.
- Use `pick` / `omit` for whitelist/blacklist field selection.
- `upsert`'s `key` must belong to the record's existing key union — `Record.upsert(users, 'c', ...)` above would not compile since `users` only has keys `'a' | 'b'`. Widen the record's type first if you need to add a genuinely new key.
