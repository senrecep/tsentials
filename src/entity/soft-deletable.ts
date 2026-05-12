/**
 * Interface for entities that support soft deletion.
 * Adapted from CSharpEssentials.Entity.SoftDeletableEntityBase.
 */
export interface SoftDeletable {
  readonly deletedAt?: Date | undefined;
  readonly deletedBy?: string | undefined;
  readonly isDeleted: boolean;
  readonly isHardDeleted: boolean;
  markAsDeleted(deletedAt: Date, deletedBy: string): void;
  markAsHardDeleted(): void;
  restore(): void;
}

/**
 * Mixin factory for soft delete behavior.
 * Replaces C#'s SoftDeletableEntityBase abstract class.
 *
 * @example
 * class Post implements SoftDeletable {
 *   private readonly _softDelete = createSoftDeletable();
 *   get isDeleted() { return this._softDelete.isDeleted; }
 *   markAsDeleted(at: Date, by: string) { this._softDelete.markAsDeleted(at, by); }
 *   // ...
 * }
 */
export function createSoftDeletable(): SoftDeletable {
  let _deletedAt: Date | undefined;
  let _deletedBy: string | undefined;
  let _isDeleted = false;
  let _isHardDeleted = false;

  return {
    get deletedAt(): Date | undefined { return _deletedAt; },
    get deletedBy(): string | undefined { return _deletedBy; },
    get isDeleted(): boolean { return _isDeleted; },
    get isHardDeleted(): boolean { return _isHardDeleted; },

    markAsDeleted(deletedAt: Date, deletedBy: string): void {
      _deletedAt = deletedAt;
      _deletedBy = deletedBy;
      _isDeleted = true;
    },

    markAsHardDeleted(): void {
      _isHardDeleted = true;
      _isDeleted = true;
    },

    restore(): void {
      _deletedAt = undefined;
      _deletedBy = undefined;
      _isDeleted = false;
    },
  };
}
