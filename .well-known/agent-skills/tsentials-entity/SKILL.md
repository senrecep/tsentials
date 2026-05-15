---
name: tsentials-entity
description: Use when building DDD domain models — createEntityBase() mixin factory for aggregate roots with audit fields and domain events, createSoftDeletable() for soft deletion lifecycle, and DomainEvent marker interface for event-driven design. Uses composition (private field delegation), not class inheritance.
---

# tsentials/entity

DDD building blocks for aggregate roots. Built-in audit tracking, soft deletion, and domain event support via the **composition / mixin factory** pattern — no base class inheritance.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { createEntityBase, createSoftDeletable } from 'tsentials/entity';
import type { EntityBase, SoftDeletable, DomainEvent, DomainEventTiming } from 'tsentials/entity';
import type { CreationAudit, ModificationAudit, FullAudit } from 'tsentials/entity';
```

---

## createEntityBase()

Factory function that returns an `EntityBase` object with domain event tracking and audit fields. **No generics, no constructor params.** Use via composition — store as a private field and delegate.

```typescript
class Order {
  private readonly _base = createEntityBase();

  // Delegate EntityBase members
  get domainEvents()  { return this._base.domainEvents; }
  get createdAt()     { return this._base.createdAt; }
  get createdBy()     { return this._base.createdBy; }
  get updatedAt()     { return this._base.updatedAt; }
  get updatedBy()     { return this._base.updatedBy; }

  raise(event: DomainEvent)                  { this._base.raise(event); }
  clearDomainEvents()                        { return this._base.clearDomainEvents(); }
  setCreatedInfo(at: Date, by: string)       { this._base.setCreatedInfo(at, by); }
  setUpdatedInfo(at: Date, by: string)       { this._base.setUpdatedInfo(at, by); }
}
```

### EntityBase Interface

```typescript
interface EntityBase extends FullAudit {
  readonly domainEvents: readonly DomainEvent[];
  raise(event: DomainEvent): void;
  clearDomainEvents(): DomainEvent[];
  setCreatedInfo(createdAt: Date, createdBy: string): void;
  setUpdatedInfo(updatedAt: Date, updatedBy: string): void;
}
```

### Audit Interfaces

```typescript
interface CreationAudit {
  readonly createdAt: Date;
  readonly createdBy: string;
}

interface ModificationAudit {
  readonly updatedAt?: Date | undefined;
  readonly updatedBy?: string | undefined;
}

interface FullAudit extends CreationAudit, ModificationAudit {}
```

---

## createSoftDeletable()

Factory function that returns a `SoftDeletable` object. **Takes no parameters.** Use via composition alongside `createEntityBase()`.

```typescript
class Product {
  private readonly _base = createEntityBase();
  private readonly _soft = createSoftDeletable();

  // EntityBase delegation
  get domainEvents()  { return this._base.domainEvents; }
  get createdAt()     { return this._base.createdAt; }
  raise(event: DomainEvent) { this._base.raise(event); }
  clearDomainEvents()       { return this._base.clearDomainEvents(); }
  setCreatedInfo(at: Date, by: string) { this._base.setCreatedInfo(at, by); }
  setUpdatedInfo(at: Date, by: string) { this._base.setUpdatedInfo(at, by); }

  // SoftDeletable delegation
  get isDeleted()     { return this._soft.isDeleted; }
  get isHardDeleted() { return this._soft.isHardDeleted; }
  get deletedAt()     { return this._soft.deletedAt; }
  get deletedBy()     { return this._soft.deletedBy; }

  markAsDeleted(at: Date, by: string) { this._soft.markAsDeleted(at, by); }
  markAsHardDeleted()                 { this._soft.markAsHardDeleted(); }
  restore()                           { this._soft.restore(); }
}

const product = new Product();

// Soft delete — requires date and user
product.markAsDeleted(new Date(), 'admin@example.com');
console.log(product.isDeleted);     // true
console.log(product.deletedAt);     // Date
console.log(product.deletedBy);     // 'admin@example.com'

// Hard delete
product.markAsHardDeleted();
console.log(product.isHardDeleted); // true

// Restore
product.restore();
console.log(product.isDeleted);     // false
console.log(product.isHardDeleted); // false
```

### SoftDeletable Interface

```typescript
interface SoftDeletable {
  readonly deletedAt?: Date | undefined;
  readonly deletedBy?: string | undefined;
  readonly isDeleted: boolean;
  readonly isHardDeleted: boolean;
  markAsDeleted(deletedAt: Date, deletedBy: string): void;
  markAsHardDeleted(): void;
  restore(): void;
}
```

---

## DomainEvent

Marker interface — only requires `occurredOn: Date`. Add domain-specific fields in your own event types.

```typescript
interface DomainEvent {
  readonly occurredOn: Date;
}

type DomainEventTiming = 'pre-save' | 'post-save';
```

Define domain events by extending the marker interface:

```typescript
interface OrderCreated extends DomainEvent {
  readonly orderId: string;
  readonly total: number;
}

// Raise inside entity methods
class Order {
  private readonly _base = createEntityBase();

  constructor(public readonly id: string, public readonly total: number) {
    this._base.raise({ occurredOn: new Date(), orderId: this.id, total } as DomainEvent);
  }

  get domainEvents() { return this._base.domainEvents; }
  raise(event: DomainEvent) { this._base.raise(event); }
  clearDomainEvents() { return this._base.clearDomainEvents(); }
}
```

---

## Collecting and Dispatching Events

```typescript
const order = new Order('ord-1', 99.99);

// Read events (e.g., before saving to DB)
const events = order.domainEvents;

// Dispatch events, then clear
for (const event of events) {
  await eventBus.publish(event);
}
order.clearDomainEvents(); // returns the cleared events array
```

---

## Complete API Reference

| Factory | Returns | Parameters |
|---------|---------|------------|
| `createEntityBase()` | `EntityBase` | None |
| `createSoftDeletable()` | `SoftDeletable` | None |

| EntityBase Method | Signature |
|-------------------|-----------|
| `domainEvents` | `readonly DomainEvent[]` (getter) |
| `createdAt` | `Date` (getter) |
| `createdBy` | `string` (getter) |
| `updatedAt` | `Date \| undefined` (getter) |
| `updatedBy` | `string \| undefined` (getter) |
| `raise` | `(event: DomainEvent) => void` |
| `clearDomainEvents` | `() => DomainEvent[]` |
| `setCreatedInfo` | `(createdAt: Date, createdBy: string) => void` |
| `setUpdatedInfo` | `(updatedAt: Date, updatedBy: string) => void` |

| SoftDeletable Method | Signature |
|----------------------|-----------|
| `isDeleted` | `boolean` (getter) |
| `isHardDeleted` | `boolean` (getter) |
| `deletedAt` | `Date \| undefined` (getter) |
| `deletedBy` | `string \| undefined` (getter) |
| `markAsDeleted` | `(deletedAt: Date, deletedBy: string) => void` |
| `markAsHardDeleted` | `() => void` |
| `restore` | `() => void` |

---

## Best Practices

- Use **composition**, not inheritance: `private readonly _base = createEntityBase()`
- Call `raise(event)` only inside entity methods — keep events encapsulated in the aggregate
- `domainEvents` is a **getter property**, not a method — do not call `getDomainEvents()`
- Always call `clearDomainEvents()` after dispatching events
- `DomainEvent` requires `occurredOn: Date` — there is no `type` property on the base interface
- `createSoftDeletable()` takes **no parameters** — it is independent of `createEntityBase()`
- `markAsDeleted(at, by)` requires both a date and a user string — it is not a zero-arg call
