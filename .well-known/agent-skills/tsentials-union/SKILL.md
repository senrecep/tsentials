---
name: tsentials-union
description: Use when a value can be one of several distinct tagged types — Union<T> as a compile-time-safe discriminated union with Union.match() for exhaustive pattern matching, Union.is() for type guards, and Union.of() for construction.
---

# tsentials/union

`Union<T>` is a tag-based discriminated union with exhaustive pattern matching. Replaces `object`-typed returns and unsafe casting.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { Union } from 'tsentials/union';
```

---

## Defining a Union

```typescript
type PaymentResult = Union<{
  success: { transactionId: string };
  pending: { estimatedMs: number };
  failed:  { error: AppError };
}>;
```

---

## Creating Values

Assign a fresh literal with `as`, not `:` — annotating the *variable* with `: PaymentResult` narrows it down to whichever member the literal matches, which breaks `Union.match` exhaustiveness the moment you use that variable:

```typescript
const result = { tag: 'success', value: { transactionId: 'txn_123' } } as PaymentResult;
const pending = { tag: 'pending', value: { estimatedMs: 3000 } } as PaymentResult;
const failed = { tag: 'failed', value: { error: Err.unexpected('Pay.Failed', 'Payment failed.') } } as PaymentResult;
```

`Union.of(tag, value)` also constructs a value, but its type parameter can't be inferred from a `Union<T>` alias — you must spell out the full record shape `T` explicitly:

```typescript
const created = Union.of<{
  success: { transactionId: string };
  pending: { estimatedMs: number };
  failed: { error: AppError };
}, 'success'>('success', { transactionId: 'txn_123' });
```

The `as` form above is shorter and equally type-safe — prefer it unless you specifically need `Union.of`.

---

## Exhaustive Pattern Match

```typescript
const message = Union.match(result, {
  success: ({ transactionId }) => `Paid! Ref: ${transactionId}`,
  pending: ({ estimatedMs }) => `Pending for ${estimatedMs / 1000}s`,
  failed:  ({ error })       => `Failed: ${error.description}`,
});
// TypeScript errors if any case is missing
```

---

## Type Guard

```typescript
if (Union.is(result, 'success')) {
  console.log(result.value.transactionId); // narrowed to { transactionId: string }
}
```

---

## Extracting Value

```typescript
// Union.get — throws if tag doesn't match
const { transactionId } = Union.get(result, 'success');
```

---

## Typical Usage — service return type

```typescript
type CreateOrderResult = Union<{
  created:    { orderId: string; total: number };
  outOfStock: { productId: string };
  limitExceeded: { limit: number; requested: number };
}>;

function createOrder(request: CreateOrderRequest): CreateOrderResult {
  if (!hasStock(request)) return { tag: 'outOfStock', value: { productId: request.productId } };
  if (exceedsLimit(request)) return { tag: 'limitExceeded', value: { limit: 10, requested: request.qty } };
  return { tag: 'created', value: { orderId: crypto.randomUUID(), total: request.total } };
}

// At API boundary
const response = Union.match(createOrder(request), {
  created:      ({ orderId, total }) => ({ status: 201, body: { orderId, total } }),
  outOfStock:   ({ productId })      => ({ status: 409, body: { error: `${productId} out of stock` } }),
  limitExceeded: ({ limit })          => ({ status: 400, body: { error: `Limit is ${limit}` } }),
});
```

---

## Union\<T\> vs Result\<T\>

| Use | When |
|-----|------|
| `Result<T>` | Binary success/failure — one value OR one-or-more errors |
| `Union<T>` | Multiple distinct outcome types — each branch carries different typed data |

---

## Best Practices

- Use `Union<T>` over `Result<T>` when failure branches carry distinct, typed payloads
- Always use `Union.match()` — it enforces exhaustiveness at compile time
- `Union.is()` + accessing `.value` is the escape hatch when `match()` is too verbose
- Avoid `any`-typed union members — defeats type safety
- For simple nullable values, prefer `Maybe<T>` over `Union<{ some: T; none: {} }>`
