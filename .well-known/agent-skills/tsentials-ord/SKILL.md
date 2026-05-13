# tsentials/ord — Skill

Use when you need type-safe sorting, min/max, or range clamping.

## API

```typescript
import { Ord, sortBy, min, max, clamp, between } from 'tsentials/ord';

// Primitive ordering
Ord.number.compare(1, 2);   // -1
Ord.string.compare('b', 'a'); // 1
Ord.date.compare(d1, d2);     // chronological

// Reverse ordering
const desc = Ord.reverse(Ord.number);

// Project before comparing
interface User { readonly age: number; }
const byAge = Ord.contramap(Ord.number, (u: User) => u.age);

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
- Use `Ord.struct` for lexicographic tuple-like ordering.
- Use `clamp` to ensure values stay within bounds.
