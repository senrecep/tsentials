---
name: tsentials-mediator
description: Use when you need typed in-process request/response dispatch with cross-cutting behaviors — createMediator<RequestMap>() with register/send, handlers returning Result<T>, pipeline behaviors for exception handling, validation, logging, caching, locking and transactions, and AbortSignal propagation.
---

# tsentials/mediator

Typed in-process mediator without a DI container. Handlers return `Result`; behaviors wrap them as a pipeline. **Subpath-only:** not exported from the root `tsentials` entry.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import {
  createMediator, pipeline,
  exceptionHandlingBehavior, validationBehavior, loggingBehavior,
  cachingBehavior, lockBehavior, transactionBehavior, InProcessResourceLock,
} from 'tsentials/mediator';
import type { Behavior, GenericBehavior, RequestHandler, RequestContext } from 'tsentials/mediator';
```

---

## Register and send

```typescript
import { Result } from 'tsentials/result';
import { Err } from 'tsentials/errors';

type Requests = {
  GetUser: { request: { id: number }; response: User };
};

const mediator = createMediator<Requests>({ behaviors: [exceptionHandlingBehavior()] })
  .register(
    'GetUser',
    ({ id }, ctx) =>
      id > 0 ? Result.success(loadUser(id)) : Result.failure(Err.notFound('User.NotFound', 'No user')),
    validationBehavior<{ id: number }>([
      (req) => (req.id > 0 ? Result.ok() : Result.failure(Err.validation('Id.Invalid', 'bad'))),
    ]),
  );

const result = await mediator.send('GetUser', { id: 1 }, { signal });  // Promise<Result<User>>
mediator.has('GetUser');                                               // true
```

- The `RequestMap` type maps request names to `{ request; response }`; `send` and `register` are fully typed from it.
- Handlers may be sync or async and receive `(request, { requestName, signal })`.
- `register` returns the mediator (chainable). Pipeline order, outermost first: mediator-wide behaviors, then the per-handler behaviors passed to `register`, then the handler.

## Behaviors

| Behavior | Purpose |
|----------|---------|
| `exceptionHandlingBehavior()` | thrown handler error becomes `Err.fromException(e)` (type `Failure`) |
| `validationBehavior(validators, { defaultMode, observers })` | run validators before the handler; modes `'enforce' \| 'logOnly' \| 'off'` (from `request.validationMode`); a `Rule<T>` is a valid validator |
| `loggingBehavior({ logger })` | log request/response via a `MediatorLogger` |
| `cachingBehavior({ cache })` | cache results by `request.cacheKey` (`CacheStore` get/set of strings) |
| `lockBehavior(new InProcessResourceLock())` | serialize requests with the same `request.lockKey` |
| `transactionBehavior(runner)` | run requests with `transactional: true` in a `TransactionRunner`; commits unless the result fails |

Custom behavior (a function; call `next()` to continue):

```typescript
const timing: GenericBehavior = async (request, next, ctx) => {
  const start = Date.now();
  const result = await next();
  console.log(ctx.requestName, Date.now() - start);
  return result;
};
```

`pipeline(handler, ...behaviors)` composes a handler with behaviors without a mediator.

---

## Patterns and pitfalls

- Import from `tsentials/mediator` — never from the root `tsentials` entry.
- `send` **rejects** when no handler is registered for the name; `register` throws `TypeError` on a duplicate name.
- **AbortSignal convention:** pass `{ signal }` to `send`; the caller's abort rejects with `signal.reason`. `exceptionHandlingBehavior()` never turns an abort-like error into a failure result.
- Put `exceptionHandlingBehavior()` outermost in the global behaviors so it also covers other behaviors.
- Place `lockBehavior` before `transactionBehavior` for process-wide locks, after it for transaction-scoped locks.
- A failed lock acquisition throws `LockTimeoutError` (not a failure result).
- Handlers return `Result<T>`; do not return bare values.
