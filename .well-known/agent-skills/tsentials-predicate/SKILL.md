# tsentials/predicate — Skill

Use when you need composable, reusable boolean conditions.

## API

```typescript
import { Predicate } from 'tsentials/predicate';
import type { Refinement } from 'tsentials/predicate';

// Create predicates
const isAdult = Predicate.from((u: User) => u.age >= 18);
const isActive = Predicate.from((u: User) => u.isActive);

// Combine with logic operators
Predicate.and(isAdult, isActive);
Predicate.or(isAdult, isGuest);
Predicate.not(isAdult);

// Combine many
Predicate.all(isAdult, isActive, hasBalance);
Predicate.any(isAdmin, isModerator);

// Refinement (type guard)
const isString = Predicate.refinement((x: unknown): x is string => typeof x === 'string');
const isNumber = Predicate.refinement((x: unknown): x is number => typeof x === 'number');

// Combine refinements (narrows to intersection)
const isStringAndNumber = Predicate.andRefinement(isString, isNumber); // Refinement<unknown, string & number>

// Convert predicate to a Rule-compatible function
Predicate.toRule(isAdult, validationError); // (value) => error | undefined
```

## Patterns

- Use `Predicate.and` / `Predicate.or` instead of inline `&&` / `||` for reusable conditions.
- Convert a `Predicate` to a `Rule` with `Predicate.toRule`.
