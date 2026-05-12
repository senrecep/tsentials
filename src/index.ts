// Core error and result types
export { ErrorType } from './errors/error-type.js';
export { ErrorMetadata } from './errors/error-metadata.js';
export { Err } from './errors/app-error.js';
export type { AppError } from './errors/app-error.js';

// Result pattern (railway-oriented programming)
export { Result, ResultUnwrapError } from './result/result.js';
export type { VoidResult } from './result/result.js';
export { ResultChain, chain } from './result/result-chain.js';
export { maybeToResult, resultToMaybe } from './result/maybe-bridge.js';

// Maybe monad
export { Maybe, tryFirst, tryLast, tryFind, choose, asMaybe } from './maybe/index.js';

// Rule engine
export type { Rule, AsyncRule, TypedRule, TypedAsyncRule } from './rules/rule.js';
export { RuleEngine } from './rules/rule-engine.js';

// HTTP utilities
export { httpStatusToError } from './http/status-mapper.js';
export { fetchResult } from './http/fetch-result.js';
export { RequestBuilder } from './http/request-builder.js';

// Entity / DDD base classes
export type { DomainEvent, DomainEventTiming } from './entity/domain-event.js';
export type { CreationAudit, ModificationAudit, FullAudit } from './entity/audit.js';
export type { EntityBase } from './entity/entity-base.js';
export { createEntityBase } from './entity/entity-base.js';
export type { SoftDeletable } from './entity/soft-deletable.js';
export { createSoftDeletable } from './entity/soft-deletable.js';

// Utilities
export { Union } from './union/union.js';
export type { Cloneable } from './clone/cloneable.js';
export { cloneArray, deepClone } from './clone/cloneable.js';
export type { DateTimeProvider } from './time/date-time-provider.js';
export { SystemDateTimeProvider, createFakeDateTimeProvider } from './time/date-time-provider.js';
