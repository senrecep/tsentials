import { Err } from '../../src/errors/app-error.js';
import type { VoidResult } from '../../src/result/result.js';
import { Result } from '../../src/result/result.js';
import { RuleEngine } from '../../src/rules/rule-engine.js';

interface UserContext {
  age: number;
  email: string;
  hasAcceptedTerms: boolean;
}

const ageErr = Err.validation('User.Underage', 'Must be 18 or older');
const emailErr = Err.validation('User.Email', 'Invalid email');
const termsErr = Err.validation('User.Terms', 'Must accept terms');
const emptyErr = Err.validation('EMPTY_RULE_ARRAY', 'The rule array is empty.');

const isAdult = RuleEngine.fromPredicate<UserContext>((u) => u.age >= 18, ageErr);
const hasEmail = RuleEngine.fromPredicate<UserContext>((u) => u.email.includes('@'), emailErr);
const acceptedTerms = RuleEngine.fromPredicate<UserContext>((u) => u.hasAcceptedTerms, termsErr);

const validUser: UserContext = { age: 25, email: 'user@example.com', hasAcceptedTerms: true };
const minorUser: UserContext = { age: 16, email: 'user@example.com', hasAcceptedTerms: true };
const invalidUser: UserContext = { age: 15, email: 'notvalid', hasAcceptedTerms: false };

describe('RuleEngine.fromPredicate', () => {
  it('passes when predicate is true', () => {
    const result = isAdult(validUser);
    expect(result.ok).toBe(true);
  });

  it('fails when predicate is false', () => {
    const result = isAdult(minorUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('User.Underage');
  });

  it('supports dynamic error factory', () => {
    const rule = RuleEngine.fromPredicate<UserContext>(
      (u) => u.age >= 18,
      (u) => Err.validation('User.Underage', `Age ${u.age} is below 18`),
    );
    const result = rule(minorUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.description).toContain('16');
  });
});

describe('RuleEngine.and', () => {
  it('passes when all rules pass', () => {
    const rule = RuleEngine.and(isAdult, hasEmail, acceptedTerms);
    expect(rule(validUser).ok).toBe(true);
  });

  it('stops at the first failure and returns only its errors', () => {
    const rule = RuleEngine.and(isAdult, hasEmail, acceptedTerms);
    const result = rule(invalidUser);
    expect(result).toEqual({ ok: false, errors: [ageErr] });
  });

  it('does not evaluate rules after the first failure', () => {
    const later = vi.fn((_u: UserContext): VoidResult => Result.ok());
    const rule = RuleEngine.and(isAdult, later);
    rule(minorUser);
    expect(later).not.toHaveBeenCalled();
    rule(validUser);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('collects partial errors', () => {
    const rule = RuleEngine.and(isAdult, hasEmail, acceptedTerms);
    const result = rule(minorUser); // only age fails
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(1);
  });

  it('returns EMPTY_RULE_ARRAY for empty rules', () => {
    expect(RuleEngine.and<UserContext>()(validUser)).toEqual({ ok: false, errors: [emptyErr] });
  });
});

describe('RuleEngine.andAll', () => {
  it('passes when all rules pass', () => {
    expect(RuleEngine.andAll(isAdult, hasEmail, acceptedTerms)(validUser).ok).toBe(true);
  });

  it('collects ALL errors (no short-circuit), in rule order', () => {
    const result = RuleEngine.andAll(isAdult, hasEmail, acceptedTerms)(invalidUser);
    expect(result).toEqual({ ok: false, errors: [ageErr, emailErr, termsErr] });
  });

  it('evaluates every rule even after a failure', () => {
    const later = vi.fn((_u: UserContext): VoidResult => Result.ok());
    RuleEngine.andAll(isAdult, later)(minorUser);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('returns EMPTY_RULE_ARRAY for empty rules', () => {
    expect(RuleEngine.andAll<UserContext>()(validUser)).toEqual({ ok: false, errors: [emptyErr] });
  });
});

describe('RuleEngine.linear', () => {
  it('passes when all rules pass in sequence', () => {
    const rule = RuleEngine.linear(isAdult, hasEmail, acceptedTerms);
    expect(rule(validUser).ok).toBe(true);
  });

  it('stops on first failure (short-circuits)', () => {
    const called: string[] = [];
    const r1 = RuleEngine.fromPredicate<UserContext>(
      () => false,
      Err.validation('Step1.Fail', 'Step 1 failed'),
    );
    const r2 = RuleEngine.fromPredicate<UserContext>(
      () => {
        called.push('r2');
        return true;
      },
      Err.validation('Step2.Fail', 'Step 2 failed'),
    );
    const rule = RuleEngine.linear(r1, r2);
    rule(validUser);
    expect(called).toHaveLength(0);
  });

  it('returns EMPTY_RULE_ARRAY for empty rules (never throws)', () => {
    expect(RuleEngine.linear<UserContext>()(validUser)).toEqual({ ok: false, errors: [emptyErr] });
  });
});

describe('RuleEngine.or', () => {
  it('passes when at least one rule passes', () => {
    const rule = RuleEngine.or(isAdult, hasEmail);
    expect(rule(minorUser).ok).toBe(true); // email passes
  });

  it('fails when all rules fail', () => {
    const rule = RuleEngine.or(isAdult, acceptedTerms);
    const result = rule(invalidUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });

  it('returns EMPTY_RULE_ARRAY for empty rules (never throws)', () => {
    expect(RuleEngine.or<UserContext>()(validUser)).toEqual({ ok: false, errors: [emptyErr] });
  });
});

describe('RuleEngine.if', () => {
  it('evaluates onTrue when condition passes', () => {
    const rule = RuleEngine.if(isAdult, hasEmail);
    expect(rule(validUser).ok).toBe(true);
  });

  it('skips onTrue when condition fails (returns ok)', () => {
    const rule = RuleEngine.if(isAdult, hasEmail);
    expect(rule(minorUser).ok).toBe(true); // no onFalse, condition failed → ok
  });

  it('evaluates onFalse when condition fails and onFalse provided', () => {
    const onFalse = RuleEngine.fromPredicate<UserContext>(() => false, termsErr);
    const rule = RuleEngine.if(isAdult, hasEmail, onFalse);
    const result = rule(minorUser); // condition fails → onFalse runs → fails
    expect(result.ok).toBe(false);
  });

  it('onFalse can return success', () => {
    const onFalse = RuleEngine.fromPredicate<UserContext>(() => true, termsErr);
    const rule = RuleEngine.if(isAdult, hasEmail, onFalse);
    const result = rule(minorUser);
    expect(result.ok).toBe(true);
  });

  it('accepts a boolean condition: true runs onTrue', () => {
    expect(RuleEngine.if(true, isAdult, hasEmail)(minorUser)).toEqual({
      ok: false,
      errors: [ageErr],
    });
  });

  it('accepts a boolean condition: false runs onFalse', () => {
    const onTrue = vi.fn((_u: UserContext): VoidResult => Result.ok());
    const result = RuleEngine.if(false, onTrue, acceptedTerms)(invalidUser);
    expect(result).toEqual({ ok: false, errors: [termsErr] });
    expect(onTrue).not.toHaveBeenCalled();
  });

  it('a false boolean condition without onFalse is ok', () => {
    expect(RuleEngine.if<UserContext>(false, isAdult)(minorUser).ok).toBe(true);
  });
});

describe('RuleEngine async', () => {
  it('linearAsync works', async () => {
    const asyncAdult = RuleEngine.fromPredicateAsync<UserContext>(async (u) => u.age >= 18, ageErr);
    const rule = RuleEngine.linearAsync(asyncAdult);
    expect((await rule(validUser)).ok).toBe(true);
    expect((await rule(minorUser)).ok).toBe(false);
  });

  it('linearAsync short-circuits', async () => {
    const called: string[] = [];
    const r1 = RuleEngine.fromPredicateAsync<UserContext>(async () => false, ageErr);
    const r2 = RuleEngine.fromPredicateAsync<UserContext>(async () => {
      called.push('r2');
      return true;
    }, emailErr);
    const rule = RuleEngine.linearAsync(r1, r2);
    await rule(validUser);
    expect(called).toHaveLength(0);
  });

  it('andAsync stops at the first async failure', async () => {
    const asyncAge = RuleEngine.fromPredicateAsync<UserContext>(async (u) => u.age >= 18, ageErr);
    const asyncEmail = vi.fn(
      RuleEngine.fromPredicateAsync<UserContext>(async (u) => u.email.includes('@'), emailErr),
    );
    const rule = RuleEngine.andAsync(asyncAge, asyncEmail);
    const result = await rule(invalidUser);
    expect(result).toEqual({ ok: false, errors: [ageErr] });
    expect(asyncEmail).not.toHaveBeenCalled();
  });

  it('andAllAsync collects all async errors', async () => {
    const asyncAge = RuleEngine.fromPredicateAsync<UserContext>(async (u) => u.age >= 18, ageErr);
    const asyncEmail = RuleEngine.fromPredicateAsync<UserContext>(
      async (u) => u.email.includes('@'),
      emailErr,
    );
    const result = await RuleEngine.andAllAsync(asyncAge, asyncEmail)(invalidUser);
    expect(result).toEqual({ ok: false, errors: [ageErr, emailErr] });
    expect((await RuleEngine.andAllAsync(asyncAge, asyncEmail)(validUser)).ok).toBe(true);
  });

  it('every async combinator returns EMPTY_RULE_ARRAY for empty rules', async () => {
    const expected = { ok: false, errors: [emptyErr] };
    expect(await RuleEngine.andAsync<UserContext>()(validUser)).toEqual(expected);
    expect(await RuleEngine.andAllAsync<UserContext>()(validUser)).toEqual(expected);
    expect(await RuleEngine.orAsync<UserContext>()(validUser)).toEqual(expected);
    expect(await RuleEngine.linearAsync<UserContext>()(validUser)).toEqual(expected);
    expect(await RuleEngine.andTypedAsync<UserContext, number>()(validUser)).toEqual(expected);
    expect(await RuleEngine.orTypedAsync<UserContext, number>()(validUser)).toEqual(expected);
  });

  it('ifAsync accepts a boolean condition', async () => {
    const asyncAge = RuleEngine.fromPredicateAsync<UserContext>(async (u) => u.age >= 18, ageErr);
    const asyncTerms = RuleEngine.fromPredicateAsync<UserContext>(
      async (u) => u.hasAcceptedTerms,
      termsErr,
    );
    expect(await RuleEngine.ifAsync(true, asyncAge, asyncTerms)(invalidUser)).toEqual({
      ok: false,
      errors: [ageErr],
    });
    expect(await RuleEngine.ifAsync(false, asyncAge, asyncTerms)(invalidUser)).toEqual({
      ok: false,
      errors: [termsErr],
    });
    expect((await RuleEngine.ifAsync<UserContext>(false, asyncAge)(invalidUser)).ok).toBe(true);
  });

  it('andAsync returns ok when all pass', async () => {
    const asyncAge = RuleEngine.fromPredicateAsync<UserContext>(async (u) => u.age >= 18, ageErr);
    const rule = RuleEngine.andAsync(asyncAge);
    const result = await rule(validUser);
    expect(result.ok).toBe(true);
  });

  it('orAsync returns first success', async () => {
    const asyncAge = RuleEngine.fromPredicateAsync<UserContext>(async (u) => u.age >= 18, ageErr);
    const asyncEmail = RuleEngine.fromPredicateAsync<UserContext>(
      async (u) => u.email.includes('@'),
      emailErr,
    );
    const rule = RuleEngine.orAsync(asyncAge, asyncEmail);
    const result = await rule(minorUser);
    expect(result.ok).toBe(true);
  });

  it('orAsync collects all errors when all fail', async () => {
    const asyncAge = RuleEngine.fromPredicateAsync<UserContext>(async (u) => u.age >= 18, ageErr);
    const asyncEmail = RuleEngine.fromPredicateAsync<UserContext>(
      async (u) => u.email.includes('@'),
      emailErr,
    );
    const rule = RuleEngine.orAsync(asyncAge, asyncEmail);
    const result = await rule(invalidUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });

  it('ifAsync evaluates onTrue when condition passes', async () => {
    const asyncAdult = RuleEngine.fromPredicateAsync<UserContext>(async (u) => u.age >= 18, ageErr);
    const asyncEmail = RuleEngine.fromPredicateAsync<UserContext>(
      async (u) => u.email.includes('@'),
      emailErr,
    );
    const rule = RuleEngine.ifAsync(asyncAdult, asyncEmail);
    const result = await rule(validUser);
    expect(result.ok).toBe(true);
  });

  it('ifAsync evaluates onFalse when condition fails', async () => {
    const asyncAdult = RuleEngine.fromPredicateAsync<UserContext>(async (u) => u.age >= 18, ageErr);
    const asyncEmail = RuleEngine.fromPredicateAsync<UserContext>(
      async (u) => u.email.includes('@'),
      emailErr,
    );
    const asyncTerms = RuleEngine.fromPredicateAsync<UserContext>(
      async (u) => u.hasAcceptedTerms,
      termsErr,
    );
    const rule = RuleEngine.ifAsync(asyncAdult, asyncEmail, asyncTerms);
    const result = await rule(minorUser);
    expect(result.ok).toBe(true);
  });

  it('fromPredicateAsync supports dynamic error factory', async () => {
    const rule = RuleEngine.fromPredicateAsync<UserContext>(
      async (u) => u.age >= 18,
      (u) => Err.validation('User.Underage', `Age ${u.age} is below 18`),
    );
    const result = await rule(minorUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.description).toContain('16');
  });
});

describe('RuleEngine.linearTyped', () => {
  const toAge = (ctx: UserContext): Result<number> => Result.success(ctx.age);
  const failTyped = (_ctx: UserContext): Result<number> =>
    Result.failure(Err.validation('Typed.Fail', 'typed fail'));

  it('stops on first failure', () => {
    const rule = RuleEngine.linearTyped(failTyped, toAge);
    const result = rule(validUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('Typed.Fail');
  });

  it('returns the last rule value when all rules pass', () => {
    const rule = RuleEngine.linearTyped(toAge, toAge);
    const result = rule(validUser);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(25);
  });

  it('returns the LAST value, not the first, when values differ', () => {
    const doubleAge = (ctx: UserContext): Result<number> => Result.success(ctx.age * 2);
    const rule = RuleEngine.linearTyped(toAge, doubleAge);
    const result = rule(validUser);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(50);
  });

  it('returns EMPTY_RULE_ARRAY for empty rules', () => {
    const rule = RuleEngine.linearTyped<UserContext, number>();
    expect(rule(validUser)).toEqual({ ok: false, errors: [emptyErr] });
  });
});

describe('RuleEngine.linearTypedAsync', () => {
  const toAgeAsync = async (ctx: UserContext): Promise<Result<number>> => Result.success(ctx.age);
  const failTypedAsync = async (_ctx: UserContext): Promise<Result<number>> =>
    Result.failure(Err.validation('Typed.Fail', 'typed fail'));

  it('stops on first failure', async () => {
    const rule = RuleEngine.linearTypedAsync(failTypedAsync, toAgeAsync);
    const result = await rule(validUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('Typed.Fail');
  });

  it('returns the last rule value when all rules pass', async () => {
    const rule = RuleEngine.linearTypedAsync(toAgeAsync);
    const result = await rule(validUser);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(25);
  });

  it('returns the LAST value, not the first, when values differ', async () => {
    const doubleAgeAsync = async (ctx: UserContext): Promise<Result<number>> =>
      Result.success(ctx.age * 2);
    const rule = RuleEngine.linearTypedAsync(toAgeAsync, doubleAgeAsync);
    const result = await rule(validUser);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(50);
  });

  it('returns EMPTY_RULE_ARRAY for empty rules', async () => {
    const rule = RuleEngine.linearTypedAsync<UserContext, number>();
    expect(await rule(validUser)).toEqual({ ok: false, errors: [emptyErr] });
  });
});

describe('RuleEngine.andTyped', () => {
  const toAge = (ctx: UserContext): Result<number> => Result.success(ctx.age);
  const failA = (_ctx: UserContext): Result<number> =>
    Result.failure(Err.validation('A.Fail', 'a'));
  const failB = (_ctx: UserContext): Result<number> =>
    Result.failure(Err.validation('B.Fail', 'b'));

  it('returns the FIRST value when all pass', () => {
    const doubleAge = (ctx: UserContext): Result<number> => Result.success(ctx.age * 2);
    const rule = RuleEngine.andTyped(toAge, doubleAge);
    expect(rule(validUser)).toEqual({ ok: true, value: 25 });
  });

  it('evaluates every rule even when an earlier one fails', () => {
    const later = vi.fn(toAge);
    RuleEngine.andTyped(failA, later)(validUser);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('returns EMPTY_RULE_ARRAY for empty rules', () => {
    expect(RuleEngine.andTyped<UserContext, number>()(validUser)).toEqual({
      ok: false,
      errors: [emptyErr],
    });
  });

  it('collects ALL errors (no short-circuit)', () => {
    const rule = RuleEngine.andTyped(failA, failB);
    const result = rule(validUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });

  it('collects errors even when an earlier rule succeeded', () => {
    const rule = RuleEngine.andTyped(toAge, failA);
    const result = rule(validUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(1);
  });
});

describe('RuleEngine.andTypedAsync', () => {
  const toAgeAsync = async (ctx: UserContext): Promise<Result<number>> => Result.success(ctx.age);
  const failAAsync = async (_ctx: UserContext): Promise<Result<number>> =>
    Result.failure(Err.validation('A.Fail', 'a'));
  const failBAsync = async (_ctx: UserContext): Promise<Result<number>> =>
    Result.failure(Err.validation('B.Fail', 'b'));

  it('returns the FIRST value when all pass', async () => {
    const doubleAgeAsync = async (ctx: UserContext): Promise<Result<number>> =>
      Result.success(ctx.age * 2);
    const rule = RuleEngine.andTypedAsync(toAgeAsync, doubleAgeAsync);
    expect(await rule(validUser)).toEqual({ ok: true, value: 25 });
  });

  it('collects ALL errors', async () => {
    const rule = RuleEngine.andTypedAsync(failAAsync, failBAsync);
    const result = await rule(validUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });

  it('collects errors even when an earlier rule succeeded', async () => {
    const rule = RuleEngine.andTypedAsync(toAgeAsync, failAAsync);
    const result = await rule(validUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(1);
  });
});

describe('RuleEngine.orTyped', () => {
  const toAge = (ctx: UserContext): Result<number> => Result.success(ctx.age);
  const failA = (_ctx: UserContext): Result<number> =>
    Result.failure(Err.validation('A.Fail', 'a'));
  const failB = (_ctx: UserContext): Result<number> =>
    Result.failure(Err.validation('B.Fail', 'b'));

  it('returns first success', () => {
    const rule = RuleEngine.orTyped(failA, toAge);
    const result = rule(validUser);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(25);
  });

  it('collects all errors when all fail', () => {
    const rule = RuleEngine.orTyped(failA, failB);
    const result = rule(validUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });

  it('returns EMPTY_RULE_ARRAY for empty rules', () => {
    expect(RuleEngine.orTyped<UserContext, number>()(validUser)).toEqual({
      ok: false,
      errors: [emptyErr],
    });
  });
});

describe('RuleEngine.orTypedAsync', () => {
  const toAgeAsync = async (ctx: UserContext): Promise<Result<number>> => Result.success(ctx.age);
  const failAAsync = async (_ctx: UserContext): Promise<Result<number>> =>
    Result.failure(Err.validation('A.Fail', 'a'));
  const failBAsync = async (_ctx: UserContext): Promise<Result<number>> =>
    Result.failure(Err.validation('B.Fail', 'b'));

  it('returns first success', async () => {
    const rule = RuleEngine.orTypedAsync(failAAsync, toAgeAsync);
    const result = await rule(validUser);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(25);
  });

  it('collects all errors when all fail', async () => {
    const rule = RuleEngine.orTypedAsync(failAAsync, failBAsync);
    const result = await rule(validUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });
});

describe('RuleEngine.ifAsync (no onFalse)', () => {
  it('returns ok when condition fails and no onFalse provided', async () => {
    const asyncAdult = RuleEngine.fromPredicateAsync<UserContext>(async (u) => u.age >= 18, ageErr);
    const asyncEmail = RuleEngine.fromPredicateAsync<UserContext>(
      async (u) => u.email.includes('@'),
      emailErr,
    );
    const rule = RuleEngine.ifAsync(asyncAdult, asyncEmail);
    const result = await rule(minorUser);
    expect(result.ok).toBe(true);
  });
});

describe('RuleEngine.evaluate', () => {
  it('delegates to rule function', () => {
    const result = RuleEngine.evaluate(isAdult, validUser);
    expect(result.ok).toBe(true);
  });

  it('evaluateAsync delegates to async rule', async () => {
    const asyncAdult = RuleEngine.fromPredicateAsync<UserContext>(async (u) => u.age >= 18, ageErr);
    const result = await RuleEngine.evaluateAsync(asyncAdult, validUser);
    expect(result.ok).toBe(true);
  });

  it('evaluateAsync returns failure when rule throws (exception guard)', async () => {
    const throwingRule = async (_ctx: unknown): Promise<VoidResult> => {
      throw new Error('unexpected failure');
    };
    const result = await RuleEngine.evaluateAsync(throwingRule, {});
    expect(Result.isFailure(result)).toBe(true);
    expect(Result.firstError(result)?.code).toBe('Rule.EvaluationFailed');
  });

  it('evaluateAsync handles non-Error thrown values', async () => {
    const throwingRule = async (_ctx: unknown): Promise<VoidResult> => {
      throw 'string error';
    };
    const result = await RuleEngine.evaluateAsync(throwingRule, {});
    expect(Result.isFailure(result)).toBe(true);
    expect(Result.firstError(result)?.code).toBe('Rule.EvaluationFailed');
    expect(Result.firstError(result)?.description).toBe('string error');
  });
});

describe('RuleEngine.evaluate with values String() rejects', () => {
  it('a rule throwing a prototype-less object becomes Rule.EvaluationFailed', () => {
    const r = RuleEngine.evaluate<number>(() => {
      throw Object.create(null);
    }, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe('Rule.EvaluationFailed');
      expect(r.errors[0]?.description).toBe('[object Object]');
    }
  });

  it('evaluateAsync does the same', async () => {
    const r = await RuleEngine.evaluateAsync<number>(async () => {
      throw Object.create(null);
    }, 1);
    expect(r.ok || r.errors[0]?.description).toBe('[object Object]');
  });
});
