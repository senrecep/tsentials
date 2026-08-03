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
| Plain object | Deep copy of own enumerable keys — result is always a plain `Object.prototype` object; class instances lose their custom prototype/methods (see note below) |
| Array (including sparse) | Deep copy — holes preserved |
| Date | `new Date(timestamp)` |
| RegExp | `new RegExp(source, flags)` |
| Map | Contents cloned recursively |
| Set | Contents cloned recursively |
| ArrayBuffer | `buffer.slice(0)` |
| DataView | Buffer + byteOffset + byteLength |
| TypedArray (Uint8Array, Float64Array, BigInt64Array, …) | Buffer cloned separately |
| Error (built-in: `Error`, `TypeError`, `RangeError`, …) | message, name, cause preserved; subclass identity kept |
| Boolean / Number / String wrapper objects | `Object(valueOf())` |
| Circular reference | Tracked via WeakMap — preserved correctly |
| SharedArrayBuffer | **Native `structuredClone` (default in Node ≥ 17 / modern browsers):** returns a *new* `SharedArrayBuffer` instance backed by the same shared memory — not the same reference. **Recursive fallback only** (no native `structuredClone`): returns the exact same reference |

> **Important caveat — custom Error subclasses and custom properties:** `deepClone` tries native `structuredClone` first, and it does **not** throw for `Error` objects — so the recursive fallback (which is the part of this library that copies custom properties and preserves user-defined subclasses) is *not* reached for a standalone `Error` in Node.js or a browser. Under native `structuredClone`, a **user-defined** `Error` subclass becomes a plain `Error` (its class identity and any custom `name` are lost), and **any custom enumerable properties** (`code`, `statusCode`, etc.) are silently dropped. Only in environments without native `structuredClone` (e.g. some React Native/Hermes builds) does the recursive fallback run and actually preserve subclass identity and custom properties. Verified empirically — see the corrected example below.
>
> **Custom prototypes:** for the same reason, cloning a class instance (not a plain object literal) with `deepClone` produces a plain object — it does **not** remain `instanceof YourClass` and loses its methods. Use `Cloneable<T>` (see below) for class instances that must retain their type/methods.

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

// Error — under native structuredClone (default in Node/browsers), only
// message/name/cause survive; custom own properties are dropped
const err = Object.assign(new Error('fail'), { code: 'ERR_X', statusCode: 500 });
const errClone = deepClone(err);
errClone.message;        // 'fail'
errClone instanceof Error; // true
errClone.code;            // undefined — custom properties are NOT preserved here

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
- Error custom properties (`code`, `statusCode`, etc.) and custom Error subclasses are **not** preserved under native `structuredClone` (the default in Node.js/browsers) — they only survive via the recursive fallback (no native `structuredClone` available). Do not rely on custom Error properties surviving `deepClone()` in Node
- Class instances lose their custom prototype/methods through `deepClone()` — they come back as plain objects; use `Cloneable<T>` instead if type/methods must be retained
- `cloneArray()` calls `.clone()` on each item — items must implement `Cloneable<T>`
- Always deep-copy nested collections inside `clone()` — a shallow copy defeats the purpose
- For simple value objects or DTOs, prefer `deepClone()` over implementing `Cloneable<T>`
