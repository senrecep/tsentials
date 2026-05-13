import type { DomainEvent, DomainEventTiming } from '../../src/entity/domain-event.js';

describe('DomainEvent interface', () => {
  it('accepts a minimal event with occurredOn', () => {
    const event: DomainEvent = { occurredOn: new Date('2024-01-01T00:00:00Z') };
    expect(event.occurredOn).toEqual(new Date('2024-01-01T00:00:00Z'));
  });

  it('accepts extended event with additional properties', () => {
    interface UserCreatedEvent extends DomainEvent {
      readonly userId: string;
      readonly email: string;
    }
    const event: UserCreatedEvent = {
      occurredOn: new Date('2024-06-15T10:30:00Z'),
      userId: 'user-123',
      email: 'test@example.com',
    };
    expect(event.userId).toBe('user-123');
    expect(event.email).toBe('test@example.com');
    expect(event.occurredOn).toBeInstanceOf(Date);
  });

  it('accepts different Date instances', () => {
    const now = new Date();
    const event: DomainEvent = { occurredOn: now };
    expect(event.occurredOn.getTime()).toBe(now.getTime());
  });

  it('works with UTC dates', () => {
    const utc = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
    const event: DomainEvent = { occurredOn: utc };
    expect(event.occurredOn.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('DomainEventTiming type', () => {
  it('accepts pre-save', () => {
    const timing: DomainEventTiming = 'pre-save';
    expect(timing).toBe('pre-save');
  });

  it('accepts post-save', () => {
    const timing: DomainEventTiming = 'post-save';
    expect(timing).toBe('post-save');
  });

  it('is assignable from literal values', () => {
    const values: DomainEventTiming[] = ['pre-save', 'post-save'];
    expect(values).toContain('pre-save');
    expect(values).toContain('post-save');
  });
});
