import type { FullAudit } from './audit.js';
import type { DomainEvent } from './domain-event.js';

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
 * EntityBase with a strongly-typed identifier.
 * Mirrors C# Essential's EntityBase<TId> design.
 */
export interface EntityBaseWithId<TId> extends EntityBase {
  readonly id: TId;
  setId(id: TId): void;
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
      return [..._domainEvents];
    },
    get createdAt(): Date {
      return _createdAt;
    },
    get createdBy(): string {
      return _createdBy;
    },
    get updatedAt(): Date | undefined {
      return _updatedAt;
    },
    get updatedBy(): string | undefined {
      return _updatedBy;
    },

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

/**
 * Mixin factory that adds domain event tracking, audit capabilities,
 * and a strongly-typed identifier.
 *
 * @example
 * class User implements EntityBaseWithId<string> {
 *   private readonly _base = createEntityBaseWithId<string>();
 *   get id() { return this._base.id; }
 *   // ...delegate other methods
 * }
 */
export function createEntityBaseWithId<TId>(id?: TId): EntityBaseWithId<TId> {
  const base = createEntityBase();
  let _id: TId | undefined = id;

  return {
    ...base,
    get id(): TId {
      if (_id === undefined) {
        throw new Error('Entity ID has not been set.');
      }
      return _id;
    },
    setId(idValue: TId): void {
      _id = idValue;
    },
  };
}
