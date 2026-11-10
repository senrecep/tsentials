import type { AppError } from '../errors/app-error.js';
import { Err } from '../errors/app-error.js';
import { safeString } from '../errors/safe-string.js';
import { type AbortOptions, isCallerAbort, throwIfAborted } from '../result/abort.js';
import { Result, type VoidResult } from '../result/result.js';
import type { AsyncRule, Rule, TypedAsyncRule, TypedRule } from './rule.js';

/**
 * Composable rule engine for evaluating business rules.
 *
 * Implemented as pure function combinators. Each combinator returns a new Rule, they
 * are composable and nest arbitrarily.
 *
 * A child rule that throws is treated as a failure with code `Rule.EvaluationFailed`
 * (so `or` can still succeed on a later child and `if` takes the else branch). In async
 * combinators the caller's own abort (the `signal` passed down) propagates instead.
 *
 * The async combinators and `evaluateAsync` accept sync rules too (`Rule` / `TypedRule`), so
 * sync and async rules mix in one call.
 *
 * Every combinator built from an empty rule list (`and()`, `or()`, `linear()`, ...) evaluates to
 * a Validation failure with code `EMPTY_RULE_ARRAY`; it never throws and never succeeds.
 *
 * @example
 * // Simple rule from a predicate
 * const isAdult = RuleEngine.fromPredicate<User>(
 *   user => user.age >= 18,
 *   Err.validation('User.Underage', 'Must be 18 or older')
 * );
 *
 * // Compose with and (all must pass, stops at the first failure)
 * const registrationRule = RuleEngine.and(isAdult, hasValidEmail, hasAcceptedTerms);
 *
 * // Or report every failure at once
 * const formRule = RuleEngine.andAll(isAdult, hasValidEmail, hasAcceptedTerms);
 *
 * // Evaluate
 * const result = registrationRule(userContext);
 */
export const RuleEngine = {
  // ─── COMBINATORS ──────────────────────────────────────────────────────────

  /**
   * Sequential chain: stops on first failure.
   *
   * Use when rules must pass in order and later rules depend on earlier ones.
   */
  linear<TContext>(...rules: Rule<TContext>[]): Rule<TContext> {
    return (context: TContext) => {
      if (rules.length === 0) return emptyRuleArray();
      for (const rule of rules) {
        const result = guard(rule, context);
        if (!result.ok) return result;
      }
      return Result.ok();
    };
  },

  /**
   * Async sequential chain: stops on first failure.
   */
  linearAsync<TContext>(...rules: (AsyncRule<TContext> | Rule<TContext>)[]): AsyncRule<TContext> {
    return async (context: TContext, signal?: AbortSignal) => {
      if (rules.length === 0) return emptyRuleArray();
      for (const rule of rules) {
        throwIfAborted(signal);
        const result = await guardAsync(rule, context, signal);
        if (!result.ok) return result;
      }
      return Result.ok();
    };
  },

  /**
   * All rules must pass: stops at the first failure and returns its errors; later rules
   * are not evaluated. Use {@link RuleEngine.andAll} to collect the errors of every rule.
   */
  and<TContext>(...rules: Rule<TContext>[]): Rule<TContext> {
    return (context: TContext) => {
      if (rules.length === 0) return emptyRuleArray();
      for (const rule of rules) {
        const result = guard(rule, context);
        if (!result.ok) return result;
      }
      return Result.ok();
    };
  },

  /**
   * Async version of and: stops at the first failure.
   */
  andAsync<TContext>(...rules: (AsyncRule<TContext> | Rule<TContext>)[]): AsyncRule<TContext> {
    return async (context: TContext, signal?: AbortSignal) => {
      if (rules.length === 0) return emptyRuleArray();
      for (const rule of rules) {
        throwIfAborted(signal);
        const result = await guardAsync(rule, context, signal);
        if (!result.ok) return result;
      }
      return Result.ok();
    };
  },

  /**
   * All rules must pass: evaluates EVERY rule and collects all errors (no short-circuit).
   *
   * Use when you want to report all validation failures at once.
   */
  andAll<TContext>(...rules: Rule<TContext>[]): Rule<TContext> {
    return (context: TContext) => {
      if (rules.length === 0) return emptyRuleArray();
      const errors: AppError[] = [];
      for (const rule of rules) {
        const result = guard(rule, context);
        if (!result.ok) errors.push(...result.errors);
      }
      return errors.length > 0 ? Result.failureFrom(errors) : Result.ok();
    };
  },

  /**
   * Async version of andAll: evaluates every rule in order and collects all errors.
   */
  andAllAsync<TContext>(...rules: (AsyncRule<TContext> | Rule<TContext>)[]): AsyncRule<TContext> {
    return async (context: TContext, signal?: AbortSignal) => {
      if (rules.length === 0) return emptyRuleArray();
      const errors: AppError[] = [];
      for (const rule of rules) {
        throwIfAborted(signal);
        const result = await guardAsync(rule, context, signal);
        if (!result.ok) errors.push(...result.errors);
      }
      return errors.length > 0 ? Result.failureFrom(errors) : Result.ok();
    };
  },

  /**
   * At least one rule must pass: collects all errors if all fail.
   */
  or<TContext>(...rules: Rule<TContext>[]): Rule<TContext> {
    return (context: TContext) => {
      if (rules.length === 0) return emptyRuleArray();
      const errors: AppError[] = [];
      for (const rule of rules) {
        const result = guard(rule, context);
        if (result.ok) return result;
        errors.push(...result.errors);
      }
      return Result.failureFrom(errors);
    };
  },

  /**
   * Async version of or.
   */
  orAsync<TContext>(...rules: (AsyncRule<TContext> | Rule<TContext>)[]): AsyncRule<TContext> {
    return async (context: TContext, signal?: AbortSignal) => {
      if (rules.length === 0) return emptyRuleArray();
      const errors: AppError[] = [];
      for (const rule of rules) {
        throwIfAborted(signal);
        const result = await guardAsync(rule, context, signal);
        if (result.ok) return result;
        errors.push(...result.errors);
      }
      return Result.failureFrom(errors);
    };
  },

  // ─── TYPED RULE COMBINATORS ───────────────────────────────────────────────

  /**
   * Sequential chain for typed rules: stops on first failure.
   */
  linearTyped<TContext, TResult>(
    ...rules: TypedRule<TContext, TResult>[]
  ): TypedRule<TContext, TResult> {
    return (context: TContext) => {
      if (rules.length === 0) return emptyRuleArray<TResult>();
      let lastValue: TResult | undefined;
      for (const rule of rules) {
        const result = guard(rule, context);
        if (!result.ok) return result;
        lastValue = result.value;
      }
      return Result.success(lastValue as TResult);
    };
  },

  /**
   * Async sequential chain for typed rules: stops on first failure.
   */
  linearTypedAsync<TContext, TResult>(
    ...rules: (TypedAsyncRule<TContext, TResult> | TypedRule<TContext, TResult>)[]
  ): TypedAsyncRule<TContext, TResult> {
    return async (context: TContext, signal?: AbortSignal) => {
      if (rules.length === 0) return emptyRuleArray<TResult>();
      let lastValue: TResult | undefined;
      for (const rule of rules) {
        throwIfAborted(signal);
        const result = await guardAsync(rule, context, signal);
        if (!result.ok) return result;
        lastValue = result.value;
      }
      return Result.success(lastValue as TResult);
    };
  },

  /**
   * All typed rules must pass: evaluates every rule and collects ALL errors (does not
   * short-circuit). On success the value is the FIRST rule's value.
   */
  andTyped<TContext, TResult>(
    ...rules: TypedRule<TContext, TResult>[]
  ): TypedRule<TContext, TResult> {
    return (context: TContext) => {
      if (rules.length === 0) return emptyRuleArray<TResult>();
      const errors: AppError[] = [];
      let firstValue: TResult | undefined;
      let hasValue = false;
      for (const rule of rules) {
        const result = guard(rule, context);
        if (!result.ok) {
          errors.push(...result.errors);
        } else if (!hasValue) {
          firstValue = result.value;
          hasValue = true;
        }
      }
      return errors.length > 0
        ? Result.failureFrom<TResult>(errors)
        : Result.success(firstValue as TResult);
    };
  },

  /**
   * Async version of andTyped: collects all errors; on success returns the first rule's value.
   */
  andTypedAsync<TContext, TResult>(
    ...rules: (TypedAsyncRule<TContext, TResult> | TypedRule<TContext, TResult>)[]
  ): TypedAsyncRule<TContext, TResult> {
    return async (context: TContext, signal?: AbortSignal) => {
      if (rules.length === 0) return emptyRuleArray<TResult>();
      const errors: AppError[] = [];
      let firstValue: TResult | undefined;
      let hasValue = false;
      for (const rule of rules) {
        throwIfAborted(signal);
        const result = await guardAsync(rule, context, signal);
        if (!result.ok) {
          errors.push(...result.errors);
        } else if (!hasValue) {
          firstValue = result.value;
          hasValue = true;
        }
      }
      return errors.length > 0
        ? Result.failureFrom<TResult>(errors)
        : Result.success(firstValue as TResult);
    };
  },

  /**
   * At least one typed rule must pass: collects all errors if all fail.
   */
  orTyped<TContext, TResult>(
    ...rules: TypedRule<TContext, TResult>[]
  ): TypedRule<TContext, TResult> {
    return (context: TContext) => {
      if (rules.length === 0) return emptyRuleArray<TResult>();
      const errors: AppError[] = [];
      for (const rule of rules) {
        const result = guard(rule, context);
        if (result.ok) return result;
        errors.push(...result.errors);
      }
      return Result.failureFrom<TResult>(errors);
    };
  },

  /**
   * Async version of orTyped.
   */
  orTypedAsync<TContext, TResult>(
    ...rules: (TypedAsyncRule<TContext, TResult> | TypedRule<TContext, TResult>)[]
  ): TypedAsyncRule<TContext, TResult> {
    return async (context: TContext, signal?: AbortSignal) => {
      if (rules.length === 0) return emptyRuleArray<TResult>();
      const errors: AppError[] = [];
      for (const rule of rules) {
        throwIfAborted(signal);
        const result = await guardAsync(rule, context, signal);
        if (result.ok) return result;
        errors.push(...result.errors);
      }
      return Result.failureFrom<TResult>(errors);
    };
  },

  /**
   * Conditional rule: if/then/else branching. The condition is a rule (success = true) or a
   * plain boolean. When the condition is false and no `onFalse` is given, the result is ok.
   *
   * @example
   * RuleEngine.if(isPremium, premiumLimits, standardLimits);
   * RuleEngine.if(config.strictMode, strictRules);
   */
  if<TContext>(
    condition: boolean | Rule<TContext>,
    onTrue: Rule<TContext>,
    onFalse?: Rule<TContext>,
  ): Rule<TContext> {
    return (context: TContext) => {
      const condResult =
        typeof condition === 'boolean' ? booleanCondition(condition) : guard(condition, context);
      if (condResult.ok) return guard(onTrue, context);
      if (onFalse) return guard(onFalse, context);
      return Result.ok();
    };
  },

  /**
   * Async conditional rule. The condition is an async rule (success = true) or a plain boolean.
   */
  ifAsync<TContext>(
    condition: boolean | AsyncRule<TContext> | Rule<TContext>,
    onTrue: AsyncRule<TContext> | Rule<TContext>,
    onFalse?: AsyncRule<TContext> | Rule<TContext>,
  ): AsyncRule<TContext> {
    return async (context: TContext, signal?: AbortSignal) => {
      throwIfAborted(signal);
      const condResult =
        typeof condition === 'boolean'
          ? booleanCondition(condition)
          : await guardAsync(condition, context, signal);
      throwIfAborted(signal);
      if (condResult.ok) return guardAsync(onTrue, context, signal);
      if (onFalse) return guardAsync(onFalse, context, signal);
      return Result.ok();
    };
  },

  /**
   * Typed conditional rule, as CSharpEssentials `RuleEngine.If` with typed rules: evaluates
   * `condition`, then `onTrue` when it succeeds or `onFalse` when it fails, and returns that
   * branch's result. Without `onFalse`, a failing condition's own result is returned.
   *
   * @example
   * RuleEngine.ifTyped(hasCoupon, couponPrice, listPrice);
   */
  ifTyped<TContext, TResult>(
    condition: TypedRule<TContext, TResult>,
    onTrue: TypedRule<TContext, TResult>,
    onFalse?: TypedRule<TContext, TResult>,
  ): TypedRule<TContext, TResult> {
    return (context: TContext) => {
      const condResult = guard(condition, context);
      const branch = condResult.ok ? onTrue : onFalse;
      return branch ? guard(branch, context) : condResult;
    };
  },

  /**
   * Async version of {@link RuleEngine.ifTyped}. Accepts sync or async typed rules and checks
   * the signal before the condition and before the branch.
   */
  ifTypedAsync<TContext, TResult>(
    condition: TypedAsyncRule<TContext, TResult> | TypedRule<TContext, TResult>,
    onTrue: TypedAsyncRule<TContext, TResult> | TypedRule<TContext, TResult>,
    onFalse?: TypedAsyncRule<TContext, TResult> | TypedRule<TContext, TResult>,
  ): TypedAsyncRule<TContext, TResult> {
    return async (context: TContext, signal?: AbortSignal) => {
      throwIfAborted(signal);
      const condResult = await guardAsync(condition, context, signal);
      throwIfAborted(signal);
      const branch = condResult.ok ? onTrue : onFalse;
      return branch ? guardAsync(branch, context, signal) : condResult;
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
    predicate: (context: TContext, signal?: AbortSignal) => Promise<boolean>,
    error: AppError | ((context: TContext) => AppError),
  ): AsyncRule<TContext> {
    return async (context: TContext, signal?: AbortSignal) => {
      if (await predicate(context, signal)) return Result.ok();
      const err = typeof error === 'function' ? error(context) : error;
      return Result.failure(err);
    };
  },

  // ─── EVALUATION ───────────────────────────────────────────────────────────

  /**
   * Evaluates a rule against a context. A rule that throws becomes a failure with code
   * `Rule.EvaluationFailed`; `evaluate` never throws.
   */
  evaluate<TContext>(rule: Rule<TContext>, context: TContext): VoidResult {
    return guard(rule, context);
  },

  /**
   * Evaluates an async rule against a context.
   *
   * With `{ signal }`: the rule receives the signal (async combinators forward it to every
   * child and check it before each child). When the caller's signal is already aborted, or
   * a rule throws while it is aborted, the abort PROPAGATES (the promise rejects) instead of
   * becoming a failure. An in-flight rule is awaited until it settles, never abandoned; a
   * rule that ignores the signal and resolves still yields its result. Any other thrown error
   * (including an abort-like error while the caller's signal is not aborted) becomes a
   * `Rule.EvaluationFailed` failure.
   *
   * @example
   * await RuleEngine.evaluateAsync(rule, order, { signal: AbortSignal.timeout(5_000) });
   */
  async evaluateAsync<TContext>(
    rule: AsyncRule<TContext> | Rule<TContext>,
    context: TContext,
    options?: AbortOptions,
  ): Promise<VoidResult> {
    const signal = options?.signal;
    throwIfAborted(signal);
    return guardAsync(rule, context, signal);
  },
} as const;

/**
 * The failure a throwing rule becomes: code `Rule.EvaluationFailed`, type `Unexpected`, the thrown
 * message as description. Rules are plain functions, so one stable code is used for every node;
 * match on `Rule.EvaluationFailed`.
 */
function evaluationFailed<T>(e: unknown): Result<T> {
  return Result.failure<T>(
    Err.unexpected('Rule.EvaluationFailed', e instanceof Error ? e.message : safeString(e)),
  );
}

/**
 * The failure every combinator built from an empty rule list evaluates to:
 * Validation `EMPTY_RULE_ARRAY`: "The rule array is empty.".
 */
function emptyRuleArray<T = void>(): Result<T> {
  return Result.failure<T>(Err.validation('EMPTY_RULE_ARRAY', 'The rule array is empty.'));
}

/** A boolean `if` condition as a result: `false` is the Validation failure `False`. */
function booleanCondition(condition: boolean): VoidResult {
  return condition
    ? Result.ok()
    : Result.failure(Err.validation('False', 'A false error has occurred.'));
}

/**
 * Runs one rule node; a throw becomes a `Rule.EvaluationFailed` failure so the enclosing
 * combinator treats it as an ordinary failure.
 */
function guard<TContext, T>(rule: (context: TContext) => Result<T>, context: TContext): Result<T> {
  try {
    return rule(context);
  } catch (e) {
    return evaluationFailed<T>(e);
  }
}

/** Async {@link guard}: the caller's own abort propagates instead of becoming a failure. */
async function guardAsync<TContext, T>(
  rule: (context: TContext, signal?: AbortSignal) => Result<T> | PromiseLike<Result<T>>,
  context: TContext,
  signal: AbortSignal | undefined,
): Promise<Result<T>> {
  try {
    return await rule(context, signal);
  } catch (e) {
    if (isCallerAbort(e, signal)) throw e;
    return evaluationFailed<T>(e);
  }
}
