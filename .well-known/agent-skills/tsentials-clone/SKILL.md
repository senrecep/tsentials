---
name: tsentials-clone
description: Use when objects need deep-copy semantics — implement Cloneable<T> on domain objects with custom clone logic, use deepClone() for plain data objects via structuredClone, and cloneArray() to call .clone() on every element in a Cloneable collection.
---

# tsentials/clone

Typed deep-copy utilities for domain objects. Two strategies: `Cloneable<T>` for custom clone logic on class-based models, and `deepClone()` for plain data via `structuredClone`.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { deepClone, cloneArray } from 'tsentials/clone';
import type { Cloneable } from 'tsentials/clone';
```

---

## Implement Cloneable\<T\>

For class-based domain objects that need custom clone logic (e.g., resetting mutable state, excluding fields):

```typescript
import type { Cloneable } from 'tsentials/clone';

class Product implements Cloneable<Product> {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly tags: Tag[],
  ) {}

  clone(): Product {
    return new Product(
      this.id,
      this.name,
      this.tags.map(t => t.clone()), // deep-copy child collections too
    );
  }
}

class Tag implements Cloneable<Tag> {
  constructor(public readonly value: string) {}

  clone(): Tag {
    return new Tag(this.value);
  }
}
```

---

## deepClone — plain data objects

Uses the native `structuredClone()` API. Does **not** call `.clone()` — works on any value that `structuredClone` supports (plain objects, arrays, Date, Map, Set, ArrayBuffer, etc.).

```typescript
import { deepClone } from 'tsentials/clone';

const original = { user: { id: 1, name: 'Alice' }, tags: ['admin'] };
const copy = deepClone(original); // uses structuredClone()

// Mutations on copy do not affect original
copy.tags.push('editor');
console.log(original.tags); // ['admin']
```

---

## cloneArray — collection of Cloneable items

Calls `.clone()` on each element in the array. Items must implement `Cloneable<T>`.

```typescript
import { cloneArray } from 'tsentials/clone';

const products: Product[] = await repo.findAll();
const working = cloneArray(products); // calls .clone() on every element

applyDiscounts(working);             // mutations don't affect originals
await repo.updateAll(working);
```

---

## When to Use Which

| Function | Mechanism | Use Case |
|----------|-----------|----------|
| `deepClone(value)` | `structuredClone()` | Plain data objects, DTOs, JSON-like structures |
| `cloneArray(items)` | `item.clone()` on each | Arrays of class instances implementing `Cloneable<T>` |
| `obj.clone()` | Custom logic | Single class instance with `Cloneable<T>` |

---

## Typical Use Case

Snapshot objects before in-memory transformations, without mutating the originals:

```typescript
// Plain data — use deepClone
const snapshot = deepClone(await fetchPriceList());
applySeasonalDiscounts(snapshot);

// Domain objects — use cloneArray
const entities = await repo.findAll();
const working = cloneArray(entities);
applyBusinessRules(working);

// Compare
const changed = working.filter((p, i) => p.price !== entities[i]?.price);
```

---

## Complete API Reference

| Export | Type | Description |
|--------|------|-------------|
| `Cloneable<T>` | Interface | Contract: `clone(): T` |
| `deepClone<T>(value)` | Function | Deep-copies via `structuredClone()` |
| `cloneArray<T extends Cloneable<T>>(items)` | Function | Calls `.clone()` on each element |

---

## Best Practices

- `deepClone()` uses `structuredClone()` — it does **not** call `.clone()` on the object
- `cloneArray()` is the one that calls `.clone()` on each item — items must implement `Cloneable<T>`
- Always deep-copy nested collections inside `clone()` — a shallow copy defeats the purpose
- Implement `Cloneable<T>` on mutable domain objects that are passed around by reference
- For simple value objects or DTOs, prefer `deepClone()` over implementing `Cloneable<T>`
- `structuredClone` does not support functions, DOM nodes, or class prototypes — use `Cloneable<T>` for those
