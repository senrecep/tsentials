import type { DomainEvent } from '../../src/entity/domain-event.js';
import { createEntityBase } from '../../src/entity/entity-base.js';
import { createSoftDeletable } from '../../src/entity/soft-deletable.js';

interface UserCreatedEvent extends DomainEvent {
  readonly userId: string;
}

describe('createEntityBase', () => {
  it('initializes with empty domain events', () => {
    const entity = createEntityBase();
    expect(entity.domainEvents).toHaveLength(0);
  });

  it('initializes createdAt to epoch (Date(0))', () => {
    const entity = createEntityBase();
    expect(entity.createdAt).toEqual(new Date(0));
  });

  it('initializes createdBy to empty string', () => {
    const entity = createEntityBase();
    expect(entity.createdBy).toBe('');
  });

  it('initializes updatedAt to undefined', () => {
    const entity = createEntityBase();
    expect(entity.updatedAt).toBeUndefined();
  });

  it('initializes updatedBy to undefined', () => {
    const entity = createEntityBase();
    expect(entity.updatedBy).toBeUndefined();
  });

  it('raises domain events', () => {
    const entity = createEntityBase();
    const event: UserCreatedEvent = { occurredOn: new Date(), userId: 'u1' };
    entity.raise(event);
    expect(entity.domainEvents).toHaveLength(1);
    expect(entity.domainEvents[0]).toBe(event);
  });

  it('raises multiple domain events', () => {
    const entity = createEntityBase();
    const event1: DomainEvent = { occurredOn: new Date() };
    const event2: DomainEvent = { occurredOn: new Date() };
    entity.raise(event1);
    entity.raise(event2);
    expect(entity.domainEvents).toHaveLength(2);
    expect(entity.domainEvents[0]).toBe(event1);
    expect(entity.domainEvents[1]).toBe(event2);
  });

  it('clears domain events and returns them', () => {
    const entity = createEntityBase();
    const event: DomainEvent = { occurredOn: new Date() };
    entity.raise(event);
    const cleared = entity.clearDomainEvents();
    expect(cleared).toHaveLength(1);
    expect(entity.domainEvents).toHaveLength(0);
  });

  it('clearDomainEvents returns empty array when no events', () => {
    const entity = createEntityBase();
    const cleared = entity.clearDomainEvents();
    expect(cleared).toHaveLength(0);
  });

  it('sets creation audit info', () => {
    const entity = createEntityBase();
    const now = new Date('2024-01-15T10:00:00Z');
    entity.setCreatedInfo(now, 'admin');
    expect(entity.createdAt).toEqual(now);
    expect(entity.createdBy).toBe('admin');
  });

  it('overwrites creation audit info when called again', () => {
    const entity = createEntityBase();
    entity.setCreatedInfo(new Date('2024-01-01'), 'first');
    const now = new Date('2024-06-01');
    entity.setCreatedInfo(now, 'second');
    expect(entity.createdAt).toEqual(now);
    expect(entity.createdBy).toBe('second');
  });

  it('sets modification audit info', () => {
    const entity = createEntityBase();
    const now = new Date('2024-06-01T12:00:00Z');
    entity.setUpdatedInfo(now, 'user42');
    expect(entity.updatedAt).toEqual(now);
    expect(entity.updatedBy).toBe('user42');
  });

  it('overwrites modification audit info when called again', () => {
    const entity = createEntityBase();
    entity.setUpdatedInfo(new Date('2024-01-01'), 'first');
    const now = new Date('2024-06-01');
    entity.setUpdatedInfo(now, 'second');
    expect(entity.updatedAt).toEqual(now);
    expect(entity.updatedBy).toBe('second');
  });

  it('domain events list is immutable (defensive copy)', () => {
    const entity = createEntityBase();
    const events = entity.domainEvents;
    entity.raise({ occurredOn: new Date() });
    expect(events).toHaveLength(0);
    expect(entity.domainEvents).toHaveLength(1);
  });

  it('domainEvents snapshot does not reflect future raises', () => {
    const entity = createEntityBase();
    const snapshot = entity.domainEvents;
    entity.raise({ occurredOn: new Date() });
    expect(snapshot).toHaveLength(0);
    expect(entity.domainEvents).toHaveLength(1);
  });

  it('domainEvents getter returns a defensive copy (mutations do not affect internal state)', () => {
    const base = createEntityBase();
    base.raise({ occurredOn: new Date() });
    const events = base.domainEvents as DomainEvent[];
    events.push({ occurredOn: new Date() }); // mutate the copy
    expect(base.domainEvents).toHaveLength(1); // internal state unchanged
  });
});

describe('createSoftDeletable', () => {
  it('initializes as not deleted', () => {
    const sd = createSoftDeletable();
    expect(sd.isDeleted).toBe(false);
    expect(sd.isHardDeleted).toBe(false);
    expect(sd.deletedAt).toBeUndefined();
    expect(sd.deletedBy).toBeUndefined();
  });

  it('marks as deleted', () => {
    const sd = createSoftDeletable();
    const now = new Date();
    sd.markAsDeleted(now, 'admin');
    expect(sd.isDeleted).toBe(true);
    expect(sd.isHardDeleted).toBe(false);
    expect(sd.deletedAt).toEqual(now);
    expect(sd.deletedBy).toBe('admin');
  });

  it('marks as hard deleted', () => {
    const sd = createSoftDeletable();
    sd.markAsHardDeleted();
    expect(sd.isDeleted).toBe(true);
    expect(sd.isHardDeleted).toBe(true);
    expect(sd.deletedAt).toBeUndefined();
    expect(sd.deletedBy).toBeUndefined();
  });

  it('restores from soft delete', () => {
    const sd = createSoftDeletable();
    sd.markAsDeleted(new Date(), 'admin');
    sd.restore();
    expect(sd.isDeleted).toBe(false);
    expect(sd.isHardDeleted).toBe(false);
    expect(sd.deletedAt).toBeUndefined();
    expect(sd.deletedBy).toBeUndefined();
  });

  it('restore after hard delete resets flags', () => {
    const sd = createSoftDeletable();
    sd.markAsHardDeleted();
    sd.restore();
    expect(sd.isDeleted).toBe(false);
    expect(sd.isHardDeleted).toBe(false);
  });

  it('marks as deleted after restore works again', () => {
    const sd = createSoftDeletable();
    sd.markAsDeleted(new Date(), 'admin');
    sd.restore();
    const later = new Date('2024-12-01');
    sd.markAsDeleted(later, 'user');
    expect(sd.isDeleted).toBe(true);
    expect(sd.deletedAt).toEqual(later);
    expect(sd.deletedBy).toBe('user');
  });
});
