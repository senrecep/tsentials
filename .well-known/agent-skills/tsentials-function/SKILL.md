# tsentials/function — Skill

Use when building pipelines or composing functions left-to-right.

## API

```typescript
import { pipe, flow, identity, constant, flip } from 'tsentials/function';

// pipe — start with a value, thread through functions
pipe(5, n => n * 2, n => n + 1, String); // "11"

// flow — compose functions into a reusable pipeline
const fn = flow((n: number) => n * 2, String);
fn(5); // "10"

// identity — returns argument unchanged
identity(42); // 42

// constant — create a function that always returns the same value
const alwaysTrue = constant(true);

// flip — reverse argument order
const subtract = (a: number, b: number) => a - b;
flip(subtract)(3, 10); // 7
```

## Patterns

- Use `pipe` for ad-hoc data transformation pipelines.
- Use `flow` when you need a reusable composed function.
- Combine with `Result.map`, `Maybe.map`, etc. for railway-oriented pipelines.
