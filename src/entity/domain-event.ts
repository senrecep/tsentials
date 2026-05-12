/**
 * Marker interface for domain events.
 * Adapted from CSharpEssentials.Entity.IDomainEvent (marker interface).
 */
export interface DomainEvent {
  readonly occurredOn: Date;
}

/**
 * Timing of when the domain event should be dispatched relative to persistence.
 * Adapted from CSharpEssentials.Entity.DomainEventTiming attribute.
 */
export type DomainEventTiming = 'pre-save' | 'post-save';
