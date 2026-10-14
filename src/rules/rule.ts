import type { Result, VoidResult } from '../result/result.js';

/**
 * A Rule is a function that evaluates a context and returns a Result.
 * In TypeScript, a rule is simply a function, no interface hierarchy needed.
 */
export type Rule<TContext> = (context: TContext) => VoidResult;

/**
 * Async rule variant. Receives the caller's `AbortSignal` (if any) from
 * `RuleEngine.evaluateAsync` and the async combinators; rules should observe it.
 */
export type AsyncRule<TContext> = (context: TContext, signal?: AbortSignal) => Promise<VoidResult>;

/**
 * A rule that returns a typed result value.
 */
export type TypedRule<TContext, TResult> = (context: TContext) => Result<TResult>;

/**
 * Async typed rule. Receives the caller's `AbortSignal` (if any) from the async combinators.
 */
export type TypedAsyncRule<TContext, TResult> = (
  context: TContext,
  signal?: AbortSignal,
) => Promise<Result<TResult>>;
