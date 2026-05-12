import { RuleEngine } from '../../src/rules/rule-engine.js';
import { Err } from '../../src/errors/app-error.js';
import { Result } from '../../src/result/result.js';

interface UserContext {
  age: number;
  email: string;
  hasAcceptedTerms: boolean;
}

const ageErr = Err.validation('User.Underage', 'Must be 18 or older');
const emailErr = Err.validation('User.Email', 'Invalid email');
const termsErr = Err.validation('User.Terms', 'Must accept terms');

const isAdult = RuleEngine.fromPredicate<UserContext>(u => u.age >= 18, ageErr);
const hasEmail = RuleEngine.fromPredicate<UserContext>(u => u.email.includes('@'), emailErr);
const acceptedTerms = RuleEngine.fromPredicate<UserContext>(u => u.hasAcceptedTerms, termsErr);

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
      u => u.age >= 18,
      u => Err.validation('User.Underage', `Age ${u.age} is below 18`)
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

  it('collects ALL errors (no short-circuit)', () => {
    const rule = RuleEngine.and(isAdult, hasEmail, acceptedTerms);
    const result = rule(invalidUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(3);
  });

  it('collects partial errors', () => {
    const rule = RuleEngine.and(isAdult, hasEmail, acceptedTerms);
    const result = rule(minorUser); // only age fails
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(1);
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
      Err.validation('Step1.Fail', 'Step 1 failed')
    );
    const r2 = RuleEngine.fromPredicate<UserContext>(
      () => { called.push('r2'); return true; },
      Err.validation('Step2.Fail', 'Step 2 failed')
    );
    const rule = RuleEngine.linear(r1, r2);
    rule(validUser);
    expect(called).toHaveLength(0);
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
});

describe('RuleEngine async', () => {
  it('linearAsync works', async () => {
    const asyncAdult = RuleEngine.fromPredicateAsync<UserContext>(
      async u => u.age >= 18,
      ageErr
    );
    const rule = RuleEngine.linearAsync(asyncAdult);
    expect((await rule(validUser)).ok).toBe(true);
    expect((await rule(minorUser)).ok).toBe(false);
  });

  it('andAsync collects all async errors', async () => {
    const asyncAge = RuleEngine.fromPredicateAsync<UserContext>(async u => u.age >= 18, ageErr);
    const asyncEmail = RuleEngine.fromPredicateAsync<UserContext>(async u => u.email.includes('@'), emailErr);
    const rule = RuleEngine.andAsync(asyncAge, asyncEmail);
    const result = await rule(invalidUser);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });
});

describe('RuleEngine.evaluate', () => {
  it('delegates to rule function', () => {
    const result = RuleEngine.evaluate(isAdult, validUser);
    expect(result.ok).toBe(true);
  });
});
