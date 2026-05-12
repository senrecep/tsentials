---
name: tsentials-time
description: Use when you need testable time — DateTimeProvider interface so production code uses SystemDateTimeProvider while tests use createFakeDateTimeProvider to freeze or advance the clock without touching Date.now().
---

# tsentials/time

Testable time abstraction. Never call `Date.now()` or `new Date()` directly in domain or service code.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { SystemDateTimeProvider, createFakeDateTimeProvider } from 'tsentials/time';
import type { DateTimeProvider } from 'tsentials/time';
```

---

## DateTimeProvider Interface

```typescript
interface DateTimeProvider {
  now(): Date;
  nowMs(): number;     // Date.now() equivalent
  today(): string;     // ISO date string: "2025-01-15"
  utcNow(): Date;      // UTC Date
}
```

---

## Production: SystemDateTimeProvider

```typescript
import { SystemDateTimeProvider } from 'tsentials/time';

// Use as a singleton or inject via DI
const timeProvider: DateTimeProvider = new SystemDateTimeProvider();
```

---

## Use in Services

```typescript
class OrderService {
  constructor(private readonly time: DateTimeProvider) {}

  createOrder(cart: Cart): Order {
    return {
      id: crypto.randomUUID(),
      createdAt: this.time.now(),
      expiresAt: new Date(this.time.nowMs() + 7 * 24 * 60 * 60 * 1000), // +7 days
    };
  }
}

// Production
const service = new OrderService(new SystemDateTimeProvider());
```

---

## Testing: createFakeDateTimeProvider

```typescript
import { createFakeDateTimeProvider } from 'tsentials/time';

// Freeze the clock at a specific date
const fakeTime = createFakeDateTimeProvider(new Date('2025-01-15T10:00:00Z'));
const service = new OrderService(fakeTime);

const order = service.createOrder(cart);
expect(order.createdAt).toEqual(new Date('2025-01-15T10:00:00Z'));

// Advance the clock
fakeTime.advance(2 * 60 * 60 * 1000); // +2 hours
expect(fakeTime.nowMs()).toBe(new Date('2025-01-15T12:00:00Z').getTime());
```

---

## Best Practices

- Inject `DateTimeProvider` — never call `new Date()` or `Date.now()` directly in domain/service code
- `SystemDateTimeProvider` is the production implementation — instantiate once, pass by reference
- `createFakeDateTimeProvider()` is for tests — freeze time to make assertions deterministic
- `fakeTime.advance(ms)` simulates elapsed time without `setTimeout` or `sleep` in tests
