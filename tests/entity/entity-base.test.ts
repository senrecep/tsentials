import { createEntityBase } from '../../src/entity/entity-base.js';
import { createSoftDeletable } from '../../src/entity/soft-deletable.js';
import type { DomainEvent } from '../../src/entity/domain-event.js';

interface UserCreatedEvent extends DomainEvent {
  readonly userId: string;
}

describe('createEntityBase', () => {
  it('initializes with empty domain events', () => {
    const entity = createEntityBase();
    expect(entity.domainEvents).toHaveLength(0);
  });

  it('raises domain events', () => {
    const entity = createEntityBase();
    const event: UserCreatedEvent = { occurredOn: new Date(), userId: 'u1' };
    entity.raise(event);
    expect(entity.domainEvents).toHaveLength(1);
    expect(entity.domainEvents[0]).toBe(event);
  });

  it('clears domain events and returns them', () => {
    const entity = createEntityBase();
    const event: DomainEvent = { occurredOn: new Date() };
    entity.raise(event);
    const cleared = entity.clearDomainEvents();
    expect(cleared).toHaveLength(1);
    expect(entity.domainEvents).toHaveLength(0);
  });

  it('sets creation audit info', () => {
    const entity = createEntityBase();
    const now = new Date('2024-01-15T10:00:00Z');
    entity.setCreatedInfo(now, 'admin');
    expect(entity.createdAt).toEqual(now);
    expect(entity.createdBy).toBe('admin');
  });

  it('sets modification audit info', () => {
    const entity = createEntityBase();
    const now = new Date('2024-06-01T12:00:00Z');
    entity.setUpdatedInfo(now, 'user42');
    expect(entity.updatedAt).toEqual(now);
    expect(entity.updatedBy).toBe('user42');
  });

  it('domain events list is immutable (frozen)', () => {
    const entity = createEntityBase();
    const events = entity.domainEvents;
    expect(Object.isFrozen(events)).toBe(true);
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
    expect(sd.deletedAt).toEqual(now);
    expect(sd.deletedBy).toBe('admin');
  });

  it('marks as hard deleted', () => {
    const sd = createSoftDeletable();
    sd.markAsHardDeleted();
    expect(sd.isDeleted).toBe(true);
    expect(sd.isHardDeleted).toBe(true);
  });

  it('restores from soft delete', () => {
    const sd = createSoftDeletable();
    sd.markAsDeleted(new Date(), 'admin');
    sd.restore();
    expect(sd.isDeleted).toBe(false);
    expect(sd.deletedAt).toBeUndefined();
    expect(sd.deletedBy).toBeUndefined();
  });
});
