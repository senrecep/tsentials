import type { DomainEvent } from './domain-event.js';
import type { FullAudit } from './audit.js';

/**
 * Base interface for all auditable domain entities with domain event support.
 *
 * Design decision: Uses composition (mixin factory) instead of class inheritance.
 * This keeps the entity model ORM-agnostic and more flexible for TypeScript's
 * structural type system.
 */
export interface EntityBase extends FullAudit {
  readonly domainEvents: readonly DomainEvent[];
  raise(event: DomainEvent): void;
  clearDomainEvents(): DomainEvent[];
  setCreatedInfo(createdAt: Date, createdBy: string): void;
  setUpdatedInfo(updatedAt: Date, updatedBy: string): void;
}

/**
 * Mixin factory that adds domain event tracking and audit capabilities
 * to any object.
 *
 * @example
 * class UserAggregate implements EntityBase {
 *   private readonly _base = createEntityBase();
 *   get domainEvents() { return this._base.domainEvents; }
 *   raise(event: DomainEvent) { this._base.raise(event); }
 *   // ...delegate other EntityBase methods
 * }
 */
export function createEntityBase(): EntityBase {
  const _domainEvents: DomainEvent[] = [];
  let _createdAt: Date = new Date(0);
  let _createdBy = '';
  let _updatedAt: Date | undefined;
  let _updatedBy: string | undefined;

  return {
    get domainEvents(): readonly DomainEvent[] {
      return Object.freeze([..._domainEvents]);
    },
    get createdAt(): Date { return _createdAt; },
    get createdBy(): string { return _createdBy; },
    get updatedAt(): Date | undefined { return _updatedAt; },
    get updatedBy(): string | undefined { return _updatedBy; },

    raise(event: DomainEvent): void {
      _domainEvents.push(event);
    },

    clearDomainEvents(): DomainEvent[] {
      return _domainEvents.splice(0);
    },

    setCreatedInfo(createdAt: Date, createdBy: string): void {
      _createdAt = createdAt;
      _createdBy = createdBy;
    },

    setUpdatedInfo(updatedAt: Date, updatedBy: string): void {
      _updatedAt = updatedAt;
      _updatedBy = updatedBy;
    },
  };
}
