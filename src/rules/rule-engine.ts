import type { AppError } from '../errors/app-error.js';
import { Result } from '../result/result.js';
import type { AsyncRule, Rule } from './rule.js';

/**
 * Composable rule engine for evaluating business rules.
 *
 * Implemented as pure function combinators. Each combinator returns a new Rule — they
 * are composable and nest arbitrarily.
 *
 * @example
 * // Simple rule from a predicate
 * const isAdult = RuleEngine.fromPredicate<User>(
 *   user => user.age >= 18,
 *   Err.validation('User.Underage', 'Must be 18 or older')
 * );
 *
 * // Compose with and (all must pass, collects all errors)
 * const registrationRule = RuleEngine.and(isAdult, hasValidEmail, hasAcceptedTerms);
 *
 * // Evaluate
 * const result = registrationRule(userContext);
 */
export const RuleEngine = {
  // ─── COMBINATORS ──────────────────────────────────────────────────────────

  /**
   * Sequential chain — stops on first failure.
   *
   * Use when rules must pass in order and later rules depend on earlier ones.
   */
  linear<TContext>(...rules: Rule<TContext>[]): Rule<TContext> {
    return (context: TContext) => {
      for (const rule of rules) {
        const result = rule(context);
        if (!result.ok) return result;
      }
      return Result.ok();
    };
  },

  /**
   * Async sequential chain — stops on first failure.
   */
  linearAsync<TContext>(...rules: AsyncRule<TContext>[]): AsyncRule<TContext> {
    return async (context: TContext) => {
      for (const rule of rules) {
        const result = await rule(context);
        if (!result.ok) return result;
      }
      return Result.ok();
    };
  },

  /**
   * All rules must pass — collects ALL errors (does not short-circuit).
   *
   * Use when you want to report all validation failures at once.
   */
  and<TContext>(...rules: Rule<TContext>[]): Rule<TContext> {
    return (context: TContext) => {
      const errors: AppError[] = [];
      for (const rule of rules) {
        const result = rule(context);
        if (!result.ok) errors.push(...result.errors);
      }
      return errors.length > 0 ? Result.failureFrom(errors) : Result.ok();
    };
  },

  /**
   * Async version of and.
   */
  andAsync<TContext>(...rules: AsyncRule<TContext>[]): AsyncRule<TContext> {
    return async (context: TContext) => {
      const errors: AppError[] = [];
      for (const rule of rules) {
        const result = await rule(context);
        if (!result.ok) errors.push(...result.errors);
      }
      return errors.length > 0 ? Result.failureFrom(errors) : Result.ok();
    };
  },

  /**
   * At least one rule must pass — collects all errors if all fail.
   */
  or<TContext>(...rules: Rule<TContext>[]): Rule<TContext> {
    return (context: TContext) => {
      const errors: AppError[] = [];
      for (const rule of rules) {
        const result = rule(context);
        if (result.ok) return result;
        errors.push(...result.errors);
      }
      return Result.failureFrom(errors);
    };
  },

  /**
   * Async version of or.
   */
  orAsync<TContext>(...rules: AsyncRule<TContext>[]): AsyncRule<TContext> {
    return async (context: TContext) => {
      const errors: AppError[] = [];
      for (const rule of rules) {
        const result = await rule(context);
        if (result.ok) return result;
        errors.push(...result.errors);
      }
      return Result.failureFrom(errors);
    };
  },

  /**
   * Conditional rule — if/then/else branching.
   */
  if<TContext>(
    condition: Rule<TContext>,
    onTrue: Rule<TContext>,
    onFalse?: Rule<TContext>,
  ): Rule<TContext> {
    return (context: TContext) => {
      const condResult = condition(context);
      if (condResult.ok) return onTrue(context);
      if (onFalse) return onFalse(context);
      return Result.ok();
    };
  },

  /**
   * Async conditional rule.
   */
  ifAsync<TContext>(
    condition: AsyncRule<TContext>,
    onTrue: AsyncRule<TContext>,
    onFalse?: AsyncRule<TContext>,
  ): AsyncRule<TContext> {
    return async (context: TContext) => {
      const condResult = await condition(context);
      if (condResult.ok) return onTrue(context);
      if (onFalse) return onFalse(context);
      return Result.ok();
    };
  },

  // ─── FACTORIES ────────────────────────────────────────────────────────────

  /**
   * Creates a rule from a synchronous predicate function.
   *
   * @example
   * const isAdult = RuleEngine.fromPredicate<User>(
   *   u => u.age >= 18,
   *   Err.validation('User.Underage', 'Must be 18+')
   * );
   */
  fromPredicate<TContext>(
    predicate: (context: TContext) => boolean,
    error: AppError | ((context: TContext) => AppError),
  ): Rule<TContext> {
    return (context: TContext) => {
      if (predicate(context)) return Result.ok();
      const err = typeof error === 'function' ? error(context) : error;
      return Result.failure(err);
    };
  },

  /**
   * Creates an async rule from an async predicate.
   */
  fromPredicateAsync<TContext>(
    predicate: (context: TContext) => Promise<boolean>,
    error: AppError | ((context: TContext) => AppError),
  ): AsyncRule<TContext> {
    return async (context: TContext) => {
      if (await predicate(context)) return Result.ok();
      const err = typeof error === 'function' ? error(context) : error;
      return Result.failure(err);
    };
  },

  // ─── EVALUATION ───────────────────────────────────────────────────────────

  /**
   * Evaluates a rule against a context.
   */
  evaluate<TContext>(rule: Rule<TContext>, context: TContext) {
    return rule(context);
  },

  /**
   * Evaluates an async rule against a context.
   */
  evaluateAsync<TContext>(rule: AsyncRule<TContext>, context: TContext) {
    return rule(context);
  },
} as const;
