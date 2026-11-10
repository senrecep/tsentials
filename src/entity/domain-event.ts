/**
 * Marker interface for domain events.
 */
export interface DomainEvent {
  readonly occurredOn: Date;
  /**
   * When the event should be dispatched relative to persistence. Absent means `'post-save'`,
   * the default of CSharpEssentials' `DomainEventTimingAttribute`.
   */
  readonly timing?: DomainEventTiming;
}

/**
 * Timing of when the domain event should be dispatched relative to persistence.
 */
export type DomainEventTiming = 'pre-save' | 'post-save';
