# tsentials/these — Skill

Use when a computation can produce both a value and errors (partial success).

## API

```typescript
import { These } from 'tsentials/these';

// Constructors
These.left(err);           // failure only
These.right(42);           // success only
These.both(err, 42);       // partial success

// Pipeline
These.map(these, n => n * 2);
These.mapLeft(these, e => wrap(e));
These.flatMap(these, n => validate(n));

// Match
These.match(these, onLeft, onRight, onBoth);

// Convert to/from Result
These.toResult(these);       // Both → failure
These.toResultLenient(these); // Both → success (discards errors)
These.fromResult(result);

// Partition an array
These.partition([These.right(1), These.left(err)]);
```

## Patterns

- Use `These` for validation where you want to collect all warnings, not just the first failure.
- Use `toResult` when you need a strict success/failure at the boundary.
