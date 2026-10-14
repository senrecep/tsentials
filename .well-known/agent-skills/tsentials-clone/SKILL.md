---
name: tsentials-clone
description: Use when objects need deep-copy semantics — implement Cloneable<T> on domain objects with custom clone logic, use deepClone() for any value (plain objects, Date, Map, Set, TypedArrays, Error subclasses, URL, circular and shared refs — identical on every runtime, React Native / Hermes compatible), and cloneArray() to call .clone() on every element in a Cloneable collection.
---

# tsentials/clone

Typed deep-copy utilities. Two strategies: `Cloneable<T>` for custom clone logic on class-based models, and `deepClone()` for any value — a self-contained recursive implementation (never calls native `structuredClone`), identical on every runtime including React Native.

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

Self-contained recursive implementation. It never delegates to the native `structuredClone`, so the result is identical on Node, browsers and React Native / Hermes. It does not throw on functions or symbols; it throws `RangeError` only on extremely deep nesting (recursive traversal).

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
| Error and subclasses (incl. `AggregateError`) | Prototype, `name`, `stack`, `cause` and custom own properties (`code`, `statusCode`, ...) preserved; constructor is not called |
| Boolean / Number / String / BigInt wrapper objects | `Object(valueOf())` |
| URL, URLSearchParams | Cloned |
| Circular and shared references | Tracked via WeakMap — preserved correctly |
| ArrayBuffer views over one buffer | Keep sharing one cloned buffer |
| Array extra properties | Non-index own enumerable properties (e.g. regex match `index`) copied |
| SharedArrayBuffer, Blob, File, Promise | Same reference returned |

Dispatch uses brand checks (`Array.isArray`, `ArrayBuffer.isView`, internal-slot getters), so an object spoofing `Symbol.toStringTag` (e.g. `'Map'`) or built from `Object.create(Map.prototype)` is cloned as a plain object, and built-ins from another realm are still recognised. A `__proto__` own key (e.g. from `JSON.parse`) is dropped.

> **Custom prototypes:** cloning a class instance (not a plain object literal) with `deepClone` produces a plain object — it does **not** remain `instanceof YourClass` and loses its methods. Use `Cloneable<T>` (see below) for class instances that must retain their type/methods. Error subclasses are the exception: they keep their prototype.

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

// Error — subclass, name, custom properties and cause are preserved
const err = Object.assign(new Error('fail'), { code: 'ERR_X', statusCode: 500 });
const errClone = deepClone(err);
errClone.message;        // 'fail'
errClone instanceof Error; // true
errClone.code;            // 'ERR_X'

// Graceful degradation — no throw on unsupported values
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
| `deepClone(value)` | own recursive implementation | Any value; all environments including React Native |
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
| `deepClone<T>(value)` | Function | Deep-clone with the built-in recursive implementation (never uses native `structuredClone`) |
| `cloneArray<T extends Cloneable<T>>(items)` | Function | Calls `.clone()` on each element |

---

## Best Practices

- `deepClone()` does not throw on unsupported types — they degrade gracefully (functions by reference, symbols to `undefined`); only extremely deep nesting throws `RangeError`
- Behaviour is identical on every runtime, including React Native / Hermes
- Circular and shared reference support is always active
- `Function` values are returned by reference (closures cannot be copied)
- `WeakMap` / `WeakSet` cannot be cloned — use `Map` / `Set` if you need copyable contents
- Error custom properties and subclasses are preserved
- Class instances lose their custom prototype/methods through `deepClone()` — they come back as plain objects; use `Cloneable<T>` instead if type/methods must be retained
- `cloneArray()` calls `.clone()` on each item — items must implement `Cloneable<T>`
- Always deep-copy nested collections inside `clone()` — a shallow copy defeats the purpose
- For simple value objects or DTOs, prefer `deepClone()` over implementing `Cloneable<T>`
