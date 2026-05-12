---
name: tsentials-maybe
description: Use when representing optional values explicitly — Maybe<T> as a null-safe container, Maybe.from() for creation, map/filter/bind chaining, match for consumption, async support with mapAsync, and collection utilities tryFirst/tryFind/choose.
---

# tsentials/maybe

`Maybe<T>` makes optionality explicit. No null reference errors — the absence of a value is a first-class concept.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { Maybe, tryFirst, tryFind, choose } from 'tsentials/maybe';
```

---

## Creating Maybe

```typescript
// From a nullable value — null/undefined → None, value → Some
const name: Maybe<string> = Maybe.from(user.nickname);

// Explicit constructors
const some: Maybe<string> = Maybe.some('Alice');
const none: Maybe<string> = Maybe.none();
```

`Maybe.from(null)` and `Maybe.from(undefined)` both produce `None`.

---

## Checking Value

```typescript
if (maybe.kind === 'some') {
  console.log(maybe.value); // T — safe only when kind === 'some'
}

// Pattern match — preferred over kind checks
const display = Maybe.match(
  maybe,
  name => `Hello, ${name}`,  // some
  () => 'Hello, stranger',    // none
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
```

---

## Consuming

```typescript
// getOrElse — provide a fallback factory
const email = Maybe.getOrElse(Maybe.from(user.email), () => 'no-email@fallback.com');

// getOrDefault — provide a default value directly
const email2 = Maybe.getOrDefault(Maybe.from(user.email), 'no-email@fallback.com');

// match — handle both cases and return a value
const label = Maybe.match(maybe, v => `Found: ${v}`, () => 'Not found');
```

---

## Async

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
```

---

## Collection Utilities

```typescript
import { tryFirst, tryFind, choose } from 'tsentials/maybe';

// tryFirst — first element or None
const first: Maybe<User> = tryFirst(users);

// tryFind — first matching element or None
const admin: Maybe<User> = tryFind(users, u => u.role === 'admin');

// choose — filter out Nones, unwrap Somes
const values: number[] = choose([Maybe.some(1), Maybe.none(), Maybe.some(3)]);
// => [1, 3]
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

// Fallback for missing email
const display = Maybe.getOrElse(
  Maybe.filter(Maybe.from(users[1]?.email), (e): e is string => e !== null),
  () => 'no-email@fallback.com',
);
```

---

## Best Practices

- Use `Maybe.from()` for all nullable-to-Maybe conversions
- Prefer `Maybe.match()` over `kind === 'some'` checks to avoid branching
- Use `Maybe.bind()` when the transform can itself be absent (returns `Maybe<T>`)
- Use `choose()` to extract present values from a `Maybe<T>[]` array
- Do not use `.toMaybe()` — that method does not exist
