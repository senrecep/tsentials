# tsentials/eq — Skill

Use when you need composable, type-safe equality checks.

## API

```typescript
import { Eq } from 'tsentials/eq';

// Primitive instances
Eq.number.equals(1, 1);   // true
Eq.string.equals('a', 'b'); // false
Eq.boolean.equals(true, true); // true
Eq.date.equals(new Date('2024-01-01'), new Date('2024-01-01')); // true

// Strict reference equality (any type)
Eq.strict.equals(obj1, obj2); // uses ===

// Derive Eq for custom types
interface User { readonly id: number; readonly name: string; }

const eqUser = Eq.struct<User>({ id: Eq.number, name: Eq.string });
eqUser.equals({ id: 1, name: 'A' }, { id: 1, name: 'A' }); // true

// Project before comparing
const eqByName = Eq.contramap(Eq.string, (u: User) => u.name);

// Array equality
const eqNumArray = Eq.getArrayEq(Eq.number);
eqNumArray.equals([1, 2], [1, 2]); // true
```

## Patterns

- Use `Eq.struct` for deep structural equality on plain objects.
- Use `Eq.contramap` to compare complex objects by a single field.
- Use `Eq.getArrayEq` for element-wise array comparison.
