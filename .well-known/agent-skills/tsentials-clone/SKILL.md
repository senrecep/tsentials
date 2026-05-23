---
name: tsentials-clone
description: Use when objects need deep-copy semantics — implement Cloneable<T> on domain objects with custom clone logic, use deepClone() for any value (plain objects, Date, Map, Set, TypedArrays, Error, circular refs — never throws, React Native / Hermes compatible), and cloneArray() to call .clone() on every element in a Cloneable collection.
---

# tsentials/clone

Typed deep-copy utilities. Two strategies: `Cloneable<T>` for custom clone logic on class-based models, and `deepClone()` for any value — hybrid native/recursive implementation, never throws, works in React Native.

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

## deepClone — any value

Hybrid implementation: tries native `structuredClone()` first; if unavailable (React Native / Hermes) or if the value contains unsupported types (functions, symbols), falls back to a robust recursive clone. **Never throws.**

### Supported types

| Type | Behavior |
|------|---------|
| Primitives (string, number, boolean, null, undefined, bigint) | Returned as-is (immutable) |
| Plain object | Deep copy — `__proto__` preserved |
| Array (including sparse) | Deep copy — holes preserved |
| Date | `new Date(timestamp)` |
| RegExp | `new RegExp(source, flags)` |
| Map | Contents cloned recursively |
| Set | Contents cloned recursively |
| ArrayBuffer | `buffer.slice(0)` |
| DataView | Buffer + byteOffset + byteLength |
| TypedArray (Uint8Array, Float64Array, BigInt64Array, …) | Buffer cloned separately |
| Error and subclasses | message, name, cause, custom props (code, statusCode, …) |
| Boolean / Number / String wrapper objects | `Object(valueOf())` |
| Circular reference | Tracked via WeakMap — preserved correctly |
| SharedArrayBuffer | Same reference returned (shared memory semantics) |

### Graceful degradation

| Type | Behavior | Why |
|------|---------|-----|
| Function | Same reference returned | Closures cannot be copied; reference sharing is safe |
| Symbol (value) | `undefined` | Every `Symbol()` has unique identity — a copy would fail `===` anyway |
| Symbol (key) | Skipped | Not enumerable via Object.keys; copying would break semantics |
| WeakMap | Empty WeakMap instance | Non-iterable — contents cannot be read (JS spec) |
| WeakSet | Empty WeakSet instance | Same reason |

### Examples

```typescript
import { deepClone } from 'tsentials/clone';

// Plain objects and mutations
const original = { user: { id: 1, name: 'Alice' }, tags: ['admin'] };
const copy = deepClone(original);
copy.tags.push('editor');
console.log(original.tags); // ['admin']

// Circular references
const obj: { a: number; self?: unknown } = { a: 1 };
obj.self = obj;
const cloned = deepClone(obj);
cloned.self === cloned; // true — circular ref preserved

// Date, Map, Set
deepClone({ createdAt: new Date(), tags: new Set(['a', 'b']) });

// TypedArrays — buffer is cloned separately
const buf = new Uint8Array([1, 2, 3]);
const bufClone = deepClone(buf);

// Error with custom properties
const err = Object.assign(new Error('fail'), { code: 'ERR_X', statusCode: 500 });
const errClone = deepClone(err);
errClone.code;       // 'ERR_X'
errClone.statusCode; // 500

// Graceful degradation — never throws
deepClone({ fn: () => 42 });      // { fn: () => 42 } — same reference
deepClone({ sym: Symbol('x') });  // { sym: undefined }
deepClone(new WeakMap());          // WeakMap {} (empty)
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
| `deepClone(value)` | native `structuredClone` → recursive fallback | Any value; all environments including React Native |
| `cloneArray(items)` | `item.clone()` on each | Arrays of class instances implementing `Cloneable<T>` |
| `obj.clone()` | Custom logic | Single class instance with custom clone behavior |

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
| `Cloneable<T>` | Interface | Contract: `clone(): T` — custom clone logic |
| `deepClone<T>(value)` | Function | Hybrid deep-clone: structuredClone → recursive fallback; never throws |
| `cloneArray<T extends Cloneable<T>>(items)` | Function | Calls `.clone()` on each element |

---

## Best Practices

- `deepClone()` never throws — unsupported types degrade gracefully instead of erroring
- In environments without `structuredClone` (React Native / Hermes), the recursive fallback activates automatically
- Circular reference support works in both native and fallback modes
- `Function` values are returned by reference (closures cannot be copied)
- `WeakMap` / `WeakSet` cannot be cloned — use `Map` / `Set` if you need copyable contents
- Error subclass custom properties (`code`, `statusCode`, etc.) are cloned automatically
- `cloneArray()` calls `.clone()` on each item — items must implement `Cloneable<T>`
- Always deep-copy nested collections inside `clone()` — a shallow copy defeats the purpose
- For simple value objects or DTOs, prefer `deepClone()` over implementing `Cloneable<T>`
