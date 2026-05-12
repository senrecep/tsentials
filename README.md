# tsentials

[![npm version](https://img.shields.io/npm/v/tsentials?style=flat-square&color=blue)](https://www.npmjs.com/package/tsentials)
[![npm downloads](https://img.shields.io/npm/dm/tsentials?style=flat-square)](https://www.npmjs.com/package/tsentials)
[![bundle size](https://img.shields.io/bundlephobia/minzip/tsentials?style=flat-square&label=gzip)](https://bundlephobia.com/package/tsentials)
[![CI](https://img.shields.io/github/actions/workflow/status/senrecep/tsentials/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/senrecep/tsentials/actions)
[![license](https://img.shields.io/github/license/senrecep/tsentials?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

Railway-oriented programming for TypeScript — `Result<T>`, `Maybe<T>`, Rule Engine, and DDD base classes with full async pipeline support.

## Table of Contents

- [Install](#install)
- [Modules](#modules)
- [Result\<T\>](#resultt)
- [Maybe\<T\>](#maybet)
- [Rule Engine](#rule-engine)
- [AppError & Err factory](#apperror--err-factory)
- [Entity Base (DDD)](#entity-base-ddd)
- [HTTP (fetchResult)](#http-fetchresult)
- [Design notes](#design-notes)
- [AI Skills](#ai-skills)

## Install

```bash
npm install tsentials
```

**Requirements:** Node.js ≥ 18, TypeScript ≥ 5.0

## Modules

| Import | Contents |
|--------|----------|
| `tsentials/result` | `Result<T>`, `ResultAsync<T>`, `ResultChain<T>`, `fromAsync` |
| `tsentials/maybe` | `Maybe<T>`, collection utilities |
| `tsentials/errors` | `AppError`, `ErrorType`, `Err` factory |
| `tsentials/rules` | `Rule<T>`, `RuleEngine` |
| `tsentials/entity` | `createEntityBase`, `createSoftDeletable`, `DomainEvent` |
| `tsentials/http` | `fetchResult`, `RequestBuilder` |
| `tsentials/time` | `DateTimeProvider`, `SystemDateTimeProvider`, `createFakeDateTimeProvider` |
| `tsentials/clone` | `Cloneable<T>`, `deepClone`, `cloneArray` |
| `tsentials/union` | `Union<T>` |

---

## Result\<T\>

Discriminated union `{ ok: true; value: T } | { ok: false; errors: AppError[] }`. No exceptions — errors are values.

```typescript
import { Result } from 'tsentials/result';
import { Err } from 'tsentials/errors';

function divide(a: number, b: number): Result<number> {
  if (b === 0) return Result.failure(Err.validation('Math.DivideByZero', 'Cannot divide by zero'));
  return Result.success(a / b);
}

const result = divide(10, 2);
if (result.ok) console.log(result.value); // 5
```

### Pipeline (sync)

```typescript
import { ResultChain } from 'tsentials/result';

const price = ResultChain.of(Result.success(100))
  .map(n => n * 1.2)
  .ensure(n => n < 200, Err.validation('Price.TooHigh', 'Price exceeds limit'))
  .map(n => `$${n.toFixed(2)}`)
  .match(
    s => s,
    () => '$0.00',
  );
// => "$120.00"
```

### Async pipeline — ResultAsync\<T\>

`ResultAsync<T>` implements `PromiseLike<Result<T>>` — the entire chain builds synchronously, resolves once at the end with a single `await`.

```typescript
import { fromAsync } from 'tsentials/result';
import { Err } from 'tsentials/errors';

const profile = await fromAsync(fetchUser(userId))
  .andThen(user => validateUser(user))
  .ensure(user => user.isActive, Err.validation('User.Inactive', 'Not active'))
  .map(user => user.profile)
  .tap(p => console.log('fetched', p.name))
  .match(
    profile => profile,
    () => null,
  );
```

### Static utilities

```typescript
Result.combine(r1, r2, r3)          // Result<[T1, T2, T3]> — all-or-nothing
Result.trySync(() => JSON.parse(s)) // catches throws → Result<T>
Result.unwrapOr(result, fallback)
Result.flatten(Result.success(Result.success(42))) // Result<number>
```

---

## Maybe\<T\>

```typescript
import { Maybe } from 'tsentials/maybe';

const name = Maybe.from(user.nickname)         // Some | None
const trimmed = Maybe.map(name, s => s.trim());
const filtered = Maybe.filter(trimmed, s => s.length > 0);
const display = Maybe.getOrElse(filtered, () => user.email);
```

### Functional style

```typescript
const result = Maybe.match(
  Maybe.bind(Maybe.from(config.timeout), ms => ms > 0 ? Maybe.some(ms) : Maybe.none()),
  ms => `timeout: ${ms}ms`,
  () => 'timeout: default',
);
```

### Async

```typescript
const m = await Maybe.mapAsync(Maybe.some(userId), async id => fetchUser(id));
```

### Collection utilities

```typescript
import { tryFirst, tryFind, choose } from 'tsentials/maybe';

const first = tryFirst(items);                               // Maybe<T>
const found = tryFind(items, x => x.id === targetId);       // Maybe<T>
const values = choose([Maybe.some(1), Maybe.none(), Maybe.some(3)]); // [1, 3]
```

---

## Rule Engine

```typescript
import { RuleEngine } from 'tsentials/rules';
import type { Rule } from 'tsentials/rules';

const isAdult: Rule<User> = ctx =>
  ctx.age >= 18 ? Result.ok() : Result.failure(Err.validation('User.Underage', 'Must be 18+'));

const hasVerifiedEmail: Rule<User> = ctx =>
  ctx.emailVerified ? Result.ok() : Result.failure(Err.validation('User.EmailUnverified', 'Verify email first'));

const canRegister = RuleEngine.and(isAdult, hasVerifiedEmail);

const result = await RuleEngine.evaluate(canRegister, user);
```

---

## AppError & Err factory

```typescript
import { Err } from 'tsentials/errors';

Err.validation('Field.Required', 'Name is required')
Err.notFound('User.NotFound', 'User does not exist')
Err.unexpected('DB.ConnectionFailed', 'Cannot connect to database')
Err.conflict('Email.AlreadyTaken', 'This email is already in use')
Err.unauthorized('Auth.InvalidToken', 'Token is expired')
Err.forbidden('Permissions.Denied', 'Insufficient permissions')
Err.custom(ErrorType.Validation, 'Custom.Code', 'message', { field: 'email' })
```

---

## Entity Base (DDD)

```typescript
import { createEntityBase, createSoftDeletable } from 'tsentials/entity';

const EntityBase = createEntityBase<string>();
const SoftDeletableBase = createSoftDeletable(EntityBase);

class Order extends SoftDeletableBase {
  constructor(public readonly total: number) {
    super({ id: crypto.randomUUID() });
  }
}

const order = new Order(99.99);
order.softDelete();
console.log(order.isDeleted); // true
```

---

## HTTP (fetchResult)

```typescript
import { fetchResult, RequestBuilder } from 'tsentials/http';

const result = await RequestBuilder.get('https://api.example.com/users')
  .header('Authorization', `Bearer ${token}`)
  .query('page', '1')
  .fetchResult<User[]>();
```

---

## Design notes

- **`Result<T>`** — discriminated union, no class, zero runtime overhead
- **`ResultAsync<T>`** — implements `PromiseLike<Result<T>>` for direct `await`; monadic bind named `andThen` to avoid thenable collision
- **`ResultChain<T>`** — fluent sync wrapper; monadic bind named `bind` (not `then`) for the same reason
- **`Maybe<T>`** — pure functional namespace, all operations are static functions
- **`Rule<T>`** — just `(ctx: T) => VoidResult`, no interface hierarchy
- **Entity base** — mixin factory pattern (`createEntityBase()`), not abstract class inheritance
- **`sideEffects: false`** — all subpath imports are fully tree-shakeable

## AI Skills

Install skills for Claude Code, Cursor, Codex, and 50+ other AI agents:

```bash
npx skills add senrecep/tsentials
```

Each module has a dedicated skill with accurate API examples, correct import paths, and common pitfalls.

## License

MIT © [Recep Şen](https://github.com/senrecep)
