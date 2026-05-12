---
name: tsentials-clone
description: Use when objects need deep-copy semantics — implement Cloneable<T> on domain objects, use deepClone() for a single object, and cloneArray() to produce independent deep copies of every element in a collection.
---

# tsentials/clone

Typed deep-copy contract for domain objects. `Cloneable<T>` is explicit and type-safe — unlike spread operators which only shallow-copy.

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

## deepClone — single object

```typescript
import { deepClone } from 'tsentials/clone';

const original = new Product('p1', 'Widget', [new Tag('sale')]);
const copy = deepClone(original); // calls original.clone()

// Mutations on copy do not affect original
```

---

## cloneArray — collection deep copy

```typescript
import { cloneArray } from 'tsentials/clone';

const products: Product[] = await repo.findAll();
const working = cloneArray(products); // independent deep copies of every element

applyDiscounts(working);             // mutations don't affect originals
await repo.updateAll(working);
```

---

## Typical Use Case

Snapshot objects before in-memory transformations, without mutating the originals:

```typescript
const snapshot = await fetchProducts(categoryId);

const discounted = cloneArray(snapshot);
applySeasonalDiscounts(discounted);

// snapshot remains unchanged for comparison
const changed = discounted.filter((p, i) => p.price !== snapshot[i]?.price);
```

---

## Best Practices

- Always deep-copy nested collections inside `clone()` — a shallow copy defeats the purpose
- Implement `Cloneable<T>` on mutable domain objects that are passed around by reference
- Consider using `readonly` properties with object spread for simple value objects instead of `Cloneable<T>`
- `Cloneable<T>` is most valuable for class-based domain models with nested mutable state
