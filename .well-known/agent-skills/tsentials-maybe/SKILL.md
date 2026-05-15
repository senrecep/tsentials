---
name: tsentials-maybe
description: Use when representing optional values explicitly — Maybe<T> as a null-safe container with hasValue discriminant, Maybe.from()/some()/none()/fromTry() for creation, map/bind/filter/tap/tapNone chaining, match/switch for consumption, conditional mapIf/bindIf, fallback or/orElse, extraction getOrDefault/getOrElse/getOrUndefined/getOrThrow/deconstruct, flatten/toArray utilities, async support with mapAsync/bindAsync/filterAsync/tapAsync/matchAsync/orAsync, and collection utilities tryFirst/tryLast/tryFind/choose/asMaybe.
---

# tsentials/maybe

`Maybe<T>` makes optionality explicit. No null reference errors — the absence of a value is a first-class concept.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { Maybe, tryFirst, tryLast, tryFind, choose, asMaybe } from 'tsentials/maybe';
```

---

## Type Definition

```typescript
type Maybe<T> =
  | { readonly hasValue: true; readonly value: T }
  | { readonly hasValue: false };
```

The discriminant is `hasValue: boolean` — there is no `kind` property.

---

## Creating Maybe

```typescript
// From a nullable value — null/undefined → None, value → Some
const name: Maybe<string> = Maybe.from(user.nickname);

// Explicit constructors
const some: Maybe<string> = Maybe.some('Alice');
const none: Maybe<string> = Maybe.none();

// From a factory function — thrown errors become None, null/undefined become None
const parsed: Maybe<Config> = Maybe.fromTry(() => JSON.parse(raw));
```

---

## Type Guards

```typescript
if (Maybe.isSome(maybe)) {
  console.log(maybe.value); // T — narrowed by type guard
}

if (Maybe.isNone(maybe)) {
  console.log('No value');
}
```

---

## Checking Value

```typescript
// Pattern match — preferred over hasValue checks
const display = Maybe.match(
  maybe,
  name => `Hello, ${name}`,  // some
  () => 'Hello, stranger',    // none
);

// Void-only pattern match — side effects without returning a value
Maybe.switch(maybe,
  user => console.log(`Found ${user.name}`),
  () => console.log('User not found'),
);
```

---

## Transforming

```typescript
// map: transform the inner value if present
const upper: Maybe<string> = Maybe.map(
  Maybe.from(user.email),
  e => e.toLowerCase(),
);

// filter: discard value if predicate fails
const nonEmpty: Maybe<string> = Maybe.filter(upper, s => s.length > 0);

// bind: flatMap — when the transform itself returns Maybe<T>
const address: Maybe<Address> = Maybe.bind(
  Maybe.from(user),
  u => Maybe.from(u.address),
);

// flatten: unwrap nested Maybe<Maybe<T>> → Maybe<T>
const flat: Maybe<string> = Maybe.flatten(nestedMaybe);

// toArray: Some → [value], None → []
const arr: string[] = Maybe.toArray(maybe);
```

---

## Side Effects

```typescript
// tap: run side effect when Some, returns the same Maybe
Maybe.tap(maybe, value => console.log('Got:', value));

// tapNone: run side effect when None, returns the same Maybe
Maybe.tapNone(maybe, () => console.log('Value was missing'));
```

---

## Conditional Pipeline

```typescript
// mapIf: transform only if condition is true, otherwise pass through
// Condition can be a boolean or a predicate (value) => boolean
const formatted = Maybe.mapIf(maybe, s => s.length > 0, s => s.trim());
const toggled = Maybe.mapIf(maybe, shouldFormat, s => s.toUpperCase());

// bindIf: flatMap only if condition is true, otherwise pass through
const enriched = Maybe.bindIf(maybe, shouldEnrich, id => lookupById(id));
```

---

## Consuming / Extraction

```typescript
// getOrDefault — provide a default value directly
const email = Maybe.getOrDefault(Maybe.from(user.email), 'no-email@fallback.com');

// getOrElse — provide a fallback factory (lazy, only invoked when None)
const email2 = Maybe.getOrElse(Maybe.from(user.email), () => 'no-email@fallback.com');

// getOrUndefined — native TypeScript idiom: T | undefined
const email3: string | undefined = Maybe.getOrUndefined(Maybe.from(user.email));

// getOrThrow — throws Error if None
const email4 = Maybe.getOrThrow(Maybe.from(user.email), 'Email is required');

// getOrThrowFactory — throws custom error if None
const email5 = Maybe.getOrThrowFactory(maybe, () => new DomainError('User.NoEmail'));

// match — handle both cases and return a value
const label = Maybe.match(maybe, v => `Found: ${v}`, () => 'Not found');

// deconstruct — [hasValue, value | undefined] tuple
const [hasVal, val] = Maybe.deconstruct(maybe);

// tryGet — same as deconstruct, atomic extraction
const [ok, value] = Maybe.tryGet(maybe);
```

---

## Fallback Chain

```typescript
// or: return the Maybe if Some, otherwise return the fallback Maybe
const result = Maybe.or(primary, fallbackMaybe);

// orElse: lazy fallback — factory only invoked when None
const result2 = Maybe.orElse(primary, () => computeFallback());
```

---

## Async Pipeline

```typescript
// mapAsync: transform with an async function
const fetched: Maybe<User> = await Maybe.mapAsync(
  Maybe.some(userId),
  async id => fetchUser(id),
);

// bindAsync: flatMap with an async function that returns Maybe<T>
const detail: Maybe<Profile> = await Maybe.bindAsync(
  Maybe.some(userId),
  async id => {
    const user = await fetchUser(id);
    return Maybe.from(user?.profile);
  },
);

// filterAsync: async predicate — becomes None if predicate returns false
const valid: Maybe<User> = await Maybe.filterAsync(
  Maybe.some(user),
  async u => await checkIsActive(u.id),
);

// tapAsync: async side effect without altering the Maybe
await Maybe.tapAsync(maybe, async value => await logAccess(value));

// matchAsync: async pattern match
const result = await Maybe.matchAsync(
  maybe,
  async user => await enrichUser(user),
  async () => await getDefaultUser(),
);

// orAsync: async fallback — factory only invoked when None
const result2 = await Maybe.orAsync(maybe, async () => await fetchFallback());
```

---

## Collection Utilities

```typescript
import { tryFirst, tryLast, tryFind, choose, asMaybe } from 'tsentials/maybe';

// tryFirst — first element or None
const first: Maybe<User> = tryFirst(users);

// tryLast — last element or None
const last: Maybe<User> = tryLast(users);

// tryFind — first matching element or None
const admin: Maybe<User> = tryFind(users, u => u.role === 'admin');

// choose — filter out Nones, unwrap Somes
const values: number[] = choose([Maybe.some(1), Maybe.none(), Maybe.some(3)]);
// => [1, 3]

// asMaybe — shorthand for Maybe.from()
const m: Maybe<string> = asMaybe(nullableValue);
```

---

## Full Example

```typescript
const users = [
  { name: 'Alice', role: 'admin', email: 'alice@example.com' },
  { name: 'Bob',   role: 'user',  email: null },
];

// Find first admin
const adminName = Maybe.match(
  tryFind(users, u => u.role === 'admin'),
  u => u.name,
  () => 'No admin',
);

// Collect all non-null emails
const emails = choose(users.map(u => Maybe.from(u.email)));

// Safe parsing with fromTry
const config = Maybe.fromTry(() => JSON.parse(rawInput));

// Fallback chain
const display = Maybe.getOrElse(
  Maybe.or(Maybe.from(user.nickname), Maybe.from(user.email)),
  () => 'anonymous',
);
```

---

## Complete API Reference

| Category | Method | Signature |
|----------|--------|-----------|
| **Factory** | `some` | `<T>(value: T) => Maybe<T>` |
| | `none` | `<T>() => Maybe<T>` |
| | `from` | `<T>(value: T \| null \| undefined) => Maybe<T>` |
| | `fromTry` | `<T>(fn: () => T \| null \| undefined) => Maybe<T>` |
| **Type Guard** | `isSome` | `<T>(m: Maybe<T>) => m is { hasValue: true; value: T }` |
| | `isNone` | `<T>(m: Maybe<T>) => m is { hasValue: false }` |
| **Transform** | `map` | `<T, U>(m, fn) => Maybe<U>` |
| | `bind` | `<T, U>(m, fn: (v: T) => Maybe<U>) => Maybe<U>` |
| | `filter` | `<T>(m, pred) => Maybe<T>` |
| | `flatten` | `<T>(m: Maybe<Maybe<T>>) => Maybe<T>` |
| | `toArray` | `<T>(m) => T[]` |
| **Side Effect** | `tap` | `<T>(m, fn: (v: T) => void) => Maybe<T>` |
| | `tapNone` | `<T>(m, fn: () => void) => Maybe<T>` |
| **Conditional** | `mapIf` | `<T>(m, cond: boolean \| ((v: T) => boolean), fn) => Maybe<T>` |
| | `bindIf` | `<T>(m, cond: boolean \| ((v: T) => boolean), fn) => Maybe<T>` |
| **Match** | `match` | `<T, U>(m, onSome, onNone) => U` |
| | `switch` | `<T>(m, onSome, onNone) => void` |
| **Extraction** | `getOrDefault` | `<T>(m, default: T) => T` |
| | `getOrElse` | `<T>(m, fn: () => T) => T` |
| | `getOrUndefined` | `<T>(m) => T \| undefined` |
| | `getOrThrow` | `<T>(m, message?) => T` |
| | `getOrThrowFactory` | `<T>(m, factory: () => Error) => T` |
| | `deconstruct` | `<T>(m) => [boolean, T \| undefined]` |
| | `tryGet` | `<T>(m) => [boolean, T \| undefined]` |
| **Fallback** | `or` | `<T>(m, fallback: Maybe<T>) => Maybe<T>` |
| | `orElse` | `<T>(m, fn: () => Maybe<T>) => Maybe<T>` |
| **Async** | `mapAsync` | `<T, U>(m, fn) => Promise<Maybe<U>>` |
| | `bindAsync` | `<T, U>(m, fn) => Promise<Maybe<U>>` |
| | `filterAsync` | `<T>(m, pred) => Promise<Maybe<T>>` |
| | `tapAsync` | `<T>(m, fn) => Promise<Maybe<T>>` |
| | `matchAsync` | `<T, U>(m, onSome, onNone) => Promise<U>` |
| | `orAsync` | `<T>(m, fn) => Promise<Maybe<T>>` |
| **Collection** | `tryFirst` | `<T>(arr) => Maybe<T>` |
| | `tryLast` | `<T>(arr) => Maybe<T>` |
| | `tryFind` | `<T>(arr, pred) => Maybe<T>` |
| | `choose` | `<T>(maybes: Maybe<T>[]) => T[]` |
| | `asMaybe` | `<T>(value: T \| null \| undefined) => Maybe<T>` |

---

## Best Practices

- Use `Maybe.from()` for all nullable-to-Maybe conversions
- Prefer `Maybe.match()` over `hasValue` checks to avoid branching
- Use `Maybe.isSome()` / `Maybe.isNone()` type guards when you need narrowing in if-blocks
- Use `Maybe.bind()` when the transform can itself be absent (returns `Maybe<T>`)
- Use `Maybe.fromTry()` to safely wrap expressions that may throw
- Use `choose()` to extract present values from a `Maybe<T>[]` array
- The discriminant is `hasValue: boolean` — there is no `kind` property
