---
name: tsentials-entity
description: Use when building DDD domain models — createEntityBase() mixin factory for aggregate roots with audit fields and domain events, createSoftDeletable() for soft deletion lifecycle, and DomainEvent for event-driven design.
---

# tsentials/entity

DDD base classes for aggregate roots. Built-in audit tracking, soft deletion, and domain event support via the mixin factory pattern.

## Installation

```bash
npm install tsentials
```

## Import

```typescript
import { createEntityBase, createSoftDeletable } from 'tsentials/entity';
import type { DomainEvent } from 'tsentials/entity';
```

---

## createEntityBase\<TId\>

Creates a base class with `id`, `createdAt`, `updatedAt`, and domain event support.

```typescript
const EntityBase = createEntityBase<string>();

class Order extends EntityBase {
  public readonly total: number;

  constructor(total: number) {
    super({ id: crypto.randomUUID() });
    this.total = total;
    this.addDomainEvent({ type: 'OrderCreated', orderId: this.id, total });
  }
}

const order = new Order(99.99);

// Provided members:
// order.id              — TId
// order.createdAt       — Date
// order.updatedAt       — Date | undefined
// order.domainEvents    — readonly DomainEvent[]
// order.clearDomainEvents() — clears the event list
```

---

## createSoftDeletable — soft deletion lifecycle

Wraps any `EntityBase` with soft-delete support:

```typescript
const EntityBase = createEntityBase<string>();
const SoftDeletableBase = createSoftDeletable(EntityBase);

class Product extends SoftDeletableBase {
  public readonly name: string;

  constructor(name: string) {
    super({ id: crypto.randomUUID() });
    this.name = name;
  }
}

const product = new Product('Widget');

// Soft delete
product.softDelete();
console.log(product.isDeleted);   // true
console.log(product.deletedAt);   // Date

// Restore
product.restore();
console.log(product.isDeleted);   // false

// Additional members:
// product.isDeleted     — boolean
// product.deletedAt     — Date | undefined
```

---

## DomainEvent

Define domain events as plain objects (no base class required):

```typescript
import type { DomainEvent } from 'tsentials/entity';

// Simple event
const event: DomainEvent = {
  type: 'OrderCreated',
  orderId: order.id,
  total: order.total,
};

// Raise inside entity constructor or methods
class Invoice extends EntityBase {
  constructor(public readonly amount: number) {
    super({ id: crypto.randomUUID() });
    this.addDomainEvent({ type: 'InvoiceCreated', invoiceId: this.id, amount });
  }

  void() {
    this.addDomainEvent({ type: 'InvoiceVoided', invoiceId: this.id });
  }
}
```

---

## Collecting and Dispatching Events

```typescript
const order = new Order(99.99);

// Read events (e.g., before saving to DB)
const events = order.domainEvents;

// Dispatch events, then clear
for (const event of events) {
  await eventBus.publish(event);
}
order.clearDomainEvents();
```

---

## Mixin Factory Pattern

`createEntityBase()` uses the mixin pattern — this means you can compose base classes without deep inheritance chains:

```typescript
// Numeric ID
const EntityBase = createEntityBase<number>();

// UUID string ID
const EntityBase = createEntityBase<string>();

// Stack mixins
const SoftDeletableBase = createSoftDeletable(createEntityBase<string>());
```

---

## Best Practices

- Call `addDomainEvent()` only inside entity methods — keep events encapsulated in the aggregate
- `domainEvents` is a **property**, not a method — do not call `getDomainEvents()`
- Always call `clearDomainEvents()` after dispatching events
- Use `createSoftDeletable()` mixin instead of adding `isDeleted` manually to every entity
- Prefer `crypto.randomUUID()` (Node ≥ 18) for string IDs
