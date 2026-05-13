# tsentials/array — Skill

Use when working with arrays that must have at least one element.

## API

```typescript
import { NonEmptyArray, asNonEmptyArray, head, last, prepend, append } from 'tsentials/array';

// Type-safe non-empty array — Array<T> & { readonly 0: T }
const items: NonEmptyArray<string> = ['a', 'b'];

head(items); // 'a' — no Maybe, no null check
last(items);  // 'b'
tail(items);  // ['b']
init(items);  // ['a']

// Safe conversion from plain array
asNonEmptyArray([]);      // None
asNonEmptyArray([1, 2]);  // Some([1, 2])

// Preserve non-empty guarantee through transforms
NonEmptyArray.map(items, s => s.toUpperCase());
NonEmptyArray.sort(items, (a, b) => a.localeCompare(b));
```

## Patterns

- Use `NonEmptyArray<T>` as a function parameter when an empty array would be invalid.
- Use `asNonEmptyArray` to safely narrow a plain array at runtime.
- `head` and `last` return `T` directly, not `T | undefined`.
