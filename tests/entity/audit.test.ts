import type { CreationAudit, FullAudit, ModificationAudit } from '../../src/entity/audit.js';

describe('Audit interfaces type compatibility', () => {
  it('CreationAudit requires createdAt and createdBy', () => {
    const audit: CreationAudit = {
      createdAt: new Date('2024-01-01T00:00:00Z'),
      createdBy: 'admin',
    };
    expect(audit.createdAt).toEqual(new Date('2024-01-01T00:00:00Z'));
    expect(audit.createdBy).toBe('admin');
  });

  it('CreationAudit is readonly', () => {
    const audit: CreationAudit = {
      createdAt: new Date('2024-01-01T00:00:00Z'),
      createdBy: 'admin',
    };
    // TypeScript compile-time check; at runtime we verify the shape
    expect(Object.isFrozen(audit)).toBe(false); // interface itself doesn't freeze
    expect(audit.createdAt instanceof Date).toBe(true);
    expect(typeof audit.createdBy).toBe('string');
  });

  it('ModificationAudit with all fields', () => {
    const audit: ModificationAudit = {
      updatedAt: new Date('2024-06-01T12:00:00Z'),
      updatedBy: 'user42',
    };
    expect(audit.updatedAt).toEqual(new Date('2024-06-01T12:00:00Z'));
    expect(audit.updatedBy).toBe('user42');
  });

  it('ModificationAudit with only updatedAt', () => {
    const audit: ModificationAudit = {
      updatedAt: new Date('2024-06-01T12:00:00Z'),
    };
    expect(audit.updatedAt).toBeDefined();
    expect(audit.updatedBy).toBeUndefined();
  });

  it('ModificationAudit with only updatedBy', () => {
    const audit: ModificationAudit = {
      updatedBy: 'user42',
    };
    expect(audit.updatedBy).toBe('user42');
    expect(audit.updatedAt).toBeUndefined();
  });

  it('ModificationAudit with no fields', () => {
    const audit: ModificationAudit = {};
    expect(audit.updatedAt).toBeUndefined();
    expect(audit.updatedBy).toBeUndefined();
  });

  it('FullAudit combines CreationAudit and ModificationAudit', () => {
    const audit: FullAudit = {
      createdAt: new Date('2024-01-01T00:00:00Z'),
      createdBy: 'admin',
      updatedAt: new Date('2024-06-01T12:00:00Z'),
      updatedBy: 'user42',
    };
    expect(audit.createdAt).toBeInstanceOf(Date);
    expect(audit.createdBy).toBe('admin');
    expect(audit.updatedAt).toBeInstanceOf(Date);
    expect(audit.updatedBy).toBe('user42');
  });

  it('FullAudit without modification fields', () => {
    const audit: FullAudit = {
      createdAt: new Date('2024-01-01T00:00:00Z'),
      createdBy: 'admin',
    };
    expect(audit.updatedAt).toBeUndefined();
    expect(audit.updatedBy).toBeUndefined();
  });

  it('object implementing FullAudit satisfies CreationAudit', () => {
    const full: FullAudit = {
      createdAt: new Date(),
      createdBy: 'system',
      updatedAt: new Date(),
      updatedBy: 'system',
    };
    // Structural typing: FullAudit extends CreationAudit
    const creation: CreationAudit = full;
    expect(creation.createdBy).toBe('system');
  });

  it('object implementing FullAudit satisfies ModificationAudit', () => {
    const full: FullAudit = {
      createdAt: new Date(),
      createdBy: 'system',
      updatedAt: new Date(),
      updatedBy: 'system',
    };
    const modification: ModificationAudit = full;
    expect(modification.updatedBy).toBe('system');
  });
});
