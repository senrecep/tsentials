---
name: tsentials-time
description: Use when you need testable time — DateTimeProvider interface with utcNow()/utcNowDate()/utcNowMs() so production code uses the SystemDateTimeProvider const object while tests use createFakeDateTimeProvider to freeze, advance, or set the clock without touching Date.now().
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
  utcNow(): Date;       // Current UTC time as a Date object
  utcNowDate(): Date;   // Current UTC date (year, month, day only — time zeroed)
  utcNowMs(): number;   // Current timestamp in milliseconds (Date.now() equivalent)
}
```

There is no `now()`, `nowMs()`, or `today()` method.

---

## Production: SystemDateTimeProvider

`SystemDateTimeProvider` is a **const object** — not a class. Do not use `new`.

```typescript
import { SystemDateTimeProvider } from 'tsentials/time';

// Use directly — it's already an instance
const now: Date = SystemDateTimeProvider.utcNow();
const todayDate: Date = SystemDateTimeProvider.utcNowDate();
const ms: number = SystemDateTimeProvider.utcNowMs();

// Or pass by reference as a DateTimeProvider
const timeProvider: DateTimeProvider = SystemDateTimeProvider;
```

---

## Use in Services

```typescript
class OrderService {
  constructor(private readonly time: DateTimeProvider) {}

  createOrder(cart: Cart): Order {
    return {
      id: crypto.randomUUID(),
      createdAt: this.time.utcNow(),
      expiresAt: new Date(this.time.utcNowMs() + 7 * 24 * 60 * 60 * 1000), // +7 days
    };
  }
}

// Production — pass the const object directly
const service = new OrderService(SystemDateTimeProvider);
```

---

## Testing: createFakeDateTimeProvider

Returns a `DateTimeProvider` with two extra methods: `advance(ms)` and `setTime(date)`.

```typescript
import { createFakeDateTimeProvider } from 'tsentials/time';

// Freeze the clock at a specific date
const fakeTime = createFakeDateTimeProvider(new Date('2025-01-15T10:00:00Z'));
const service = new OrderService(fakeTime);

const order = service.createOrder(cart);
expect(order.createdAt).toEqual(new Date('2025-01-15T10:00:00Z'));

// Advance the clock
fakeTime.advance(2 * 60 * 60 * 1000); // +2 hours
expect(fakeTime.utcNowMs()).toBe(new Date('2025-01-15T12:00:00Z').getTime());
expect(fakeTime.utcNow()).toEqual(new Date('2025-01-15T12:00:00Z'));

// Set to a completely different time
fakeTime.setTime(new Date('2025-06-01T00:00:00Z'));
expect(fakeTime.utcNow()).toEqual(new Date('2025-06-01T00:00:00Z'));

// utcNowDate() returns date-only (time zeroed)
fakeTime.setTime(new Date('2025-03-15T14:30:00Z'));
expect(fakeTime.utcNowDate()).toEqual(new Date('2025-03-15T00:00:00Z'));
```

---

## Complete API Reference

| Object/Function | Type | Description |
|-----------------|------|-------------|
| `SystemDateTimeProvider` | `DateTimeProvider` (const object) | Production implementation, delegates to system clock |
| `createFakeDateTimeProvider(fixed)` | `(Date) => DateTimeProvider & { advance, setTime }` | Test double with fixed time |

| DateTimeProvider Method | Signature | Description |
|-------------------------|-----------|-------------|
| `utcNow()` | `() => Date` | Current UTC time |
| `utcNowDate()` | `() => Date` | Current UTC date (time zeroed) |
| `utcNowMs()` | `() => number` | Current timestamp in ms |

| Fake-only Method | Signature | Description |
|------------------|-----------|-------------|
| `advance(ms)` | `(number) => void` | Move clock forward by ms |
| `setTime(date)` | `(Date) => void` | Set clock to exact time |

---

## Best Practices

- Inject `DateTimeProvider` — never call `new Date()` or `Date.now()` directly in domain/service code
- `SystemDateTimeProvider` is a const object — use directly, do not instantiate with `new`
- `createFakeDateTimeProvider()` is for tests — freeze time to make assertions deterministic
- `fakeTime.advance(ms)` simulates elapsed time without `setTimeout` or `sleep` in tests
- Use `utcNow()` for timestamps, `utcNowDate()` for date-only comparisons, `utcNowMs()` for numeric timestamps
