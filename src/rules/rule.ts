import type { AppError } from '../errors/app-error.js';
import type { Result, VoidResult } from '../result/result.js';

/**
 * A Rule is a function that evaluates a context and returns a Result.
 *
 * TypeScript adaptation of CSharpEssentials.Rules.IRule<TContext>.
 *
 * Design insight: In C#, rules required implementing one of 12 interfaces
 * (IRule, IAsyncRule, ILinearRule, IAndRule, IOrRule, IConditionalRule, etc.)
 * plus adapter classes for wrapping functions. In TypeScript, a rule is simply
 * a function — no interface hierarchy needed.
 */
export type Rule<TContext> = (context: TContext) => VoidResult;

/**
 * Async rule variant. Replaces C#'s IAsyncRule<TContext>.
 */
export type AsyncRule<TContext> = (context: TContext) => Promise<VoidResult>;

/**
 * A rule that returns a typed result value.
 * Replaces C#'s IRule<TContext, TResult>.
 */
export type TypedRule<TContext, TResult> = (context: TContext) => Result<TResult>;

/**
 * Async typed rule. Replaces C#'s IAsyncRule<TContext, TResult>.
 */
export type TypedAsyncRule<TContext, TResult> = (context: TContext) => Promise<Result<TResult>>;
