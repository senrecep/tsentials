# tsentials/ord — Skill

Use when you need type-safe sorting, min/max, or range clamping.

## API

```typescript
import { Ord, sortBy, min, max, clamp, between } from 'tsentials/ord';
import type { Ordering } from 'tsentials/ord'; // -1 | 0 | 1

// Primitive ordering
Ord.number.compare(1, 2);   // -1
Ord.string.compare('b', 'a'); // 1
Ord.boolean.compare(false, true); // -1 (false < true)
Ord.date.compare(d1, d2);     // chronological

// Reverse ordering
const desc = Ord.reverse(Ord.number);

// Project before comparing
interface User { readonly name: string; readonly age: number; }
const byAge = Ord.contramap(Ord.number, (u: User) => u.age);

// Struct ordering (multi-field, lexicographic)
const byNameThenAge = Ord.struct<User>({ name: Ord.string, age: Ord.number });

// Sort an array
sortBy([3, 1, 4], Ord.number); // [1, 3, 4]

// Min / max
min(Ord.number, 1, 2); // 1
max(Ord.number, 1, 2); // 2

// Range checks
clamp(Ord.number, 0, 10, 15); // 10
between(Ord.number, 0, 10, 5); // true
```

## Patterns

- Use `Ord.contramap` to sort arrays of objects by a specific field.
- Use `Ord.struct` for lexicographic multi-field ordering (compares fields in order, short-circuits on first difference).
- Use `clamp` to ensure values stay within bounds.
