/**
 * `tsentials/validation` — fluent, eager, Result-based model validation
 *
 * @example
 * import { Validator } from 'tsentials/validation';
 *
 * const result = Validator.validate(user, (rules) => {
 *   rules.for('name').notEmpty().maxLength(50);
 *   rules.for('address.city').notEmpty();
 *   rules.forEach('items', (itemRules) => {
 *     itemRules.for('sku').notEmpty(); // → items[0].sku.NotEmpty
 *   });
 * });
 */

export { CascadeMode } from './cascade-mode.js';
export type { AsyncValidator, SyncValidator } from './contracts.js';
export type { EnumLike } from './enum-support.js';
export type { Comparable, ValidationMessage } from './internal.js';
export type { CollectionPath, ElementOf, PathValue, PropertyPath } from './property-path.js';
export type { MustOptions, RuleChain } from './rule-chain.js';
export type { RuleContext } from './rule-context.js';
export type { AsyncConfigure, Configure } from './validator.js';
export { Validator } from './validator.js';
