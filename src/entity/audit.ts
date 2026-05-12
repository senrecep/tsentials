/**
 * Audit information for entity creation.
 * Adapted from EntityBase.CreatedAt / EntityBase.CreatedBy fields.
 */
export interface CreationAudit {
  readonly createdAt: Date;
  readonly createdBy: string;
}

/**
 * Audit information for entity modifications.
 * Adapted from EntityBase.UpdatedAt / EntityBase.UpdatedBy fields.
 */
export interface ModificationAudit {
  readonly updatedAt?: Date | undefined;
  readonly updatedBy?: string | undefined;
}

/**
 * Combined audit interface for entities that track both creation and modification.
 */
export interface FullAudit extends CreationAudit, ModificationAudit {}
