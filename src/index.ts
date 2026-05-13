// Core error and result types

export type { Cloneable } from './clone/cloneable.js';
export { cloneArray, deepClone } from './clone/cloneable.js';
export type { CreationAudit, FullAudit, ModificationAudit } from './entity/audit.js';
// Entity / DDD base classes
export type { DomainEvent, DomainEventTiming } from './entity/domain-event.js';
export type { EntityBase } from './entity/entity-base.js';
export { createEntityBase } from './entity/entity-base.js';
export type { SoftDeletable } from './entity/soft-deletable.js';
export { createSoftDeletable } from './entity/soft-deletable.js';
export type { AppError } from './errors/app-error.js';
export { Err } from './errors/app-error.js';
export { ErrorMetadata } from './errors/error-metadata.js';
export { ErrorType } from './errors/error-type.js';
export { fetchResult } from './http/fetch-result.js';
export { RequestBuilder } from './http/request-builder.js';
// HTTP utilities
export { httpStatusToError } from './http/status-mapper.js';
export type { Json, JsonArray, JsonObject, JsonPrimitive } from './json/index.js';
// JSON utilities
export {
  isJson,
  isJsonArray,
  isJsonObject,
  isJsonPrimitive,
  parseAndValidate,
  safeJsonParse,
  safeJsonStringify,
} from './json/index.js';
// Maybe monad
export { asMaybe, choose, Maybe, tryFind, tryFirst, tryLast } from './maybe/index.js';
export { maybeToResult, resultToMaybe } from './result/maybe-bridge.js';
export type { VoidResult } from './result/result.js';
// Result pattern (railway-oriented programming)
export { Result, ResultUnwrapError } from './result/result.js';
export { chain, ResultChain } from './result/result-chain.js';
// Rule engine
export type { AsyncRule, Rule, TypedAsyncRule, TypedRule } from './rules/rule.js';
export { RuleEngine } from './rules/rule-engine.js';
export type { DateTimeProvider } from './time/date-time-provider.js';
export { createFakeDateTimeProvider, SystemDateTimeProvider } from './time/date-time-provider.js';
// Utilities
export { Union } from './union/union.js';
