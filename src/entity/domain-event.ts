/**
 * Marker interface for domain events.
 */
export interface DomainEvent {
  readonly occurredOn: Date;
}

/**
 * Timing of when the domain event should be dispatched relative to persistence.
 */
export type DomainEventTiming = 'pre-save' | 'post-save';
