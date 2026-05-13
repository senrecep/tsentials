# tsentials/record — Skill

Use when transforming plain objects functionally.

## API

```typescript
import { Record } from 'tsentials/record';

const users = { a: { name: 'Alice' }, b: { name: 'Bob' } };

// Query
Record.keys(users);    // ['a', 'b']
Record.values(users);  // [{ name: 'Alice' }, { name: 'Bob' }]
Record.has(users, 'a'); // true

// Transform
Record.map(users, u => u.name);           // { a: 'Alice', b: 'Bob' }
Record.filter(users, u => u.name !== 'Bob');
Record.filterMap(users, u => u.name.length > 3 ? u.name : null);

// Modify
Record.upsert(users, 'c', { name: 'Charlie' });
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
