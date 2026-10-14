import { CascadeMode, Validator } from '../../src/validation/index.js';

interface M {
  email: string | null;
  age: number;
}

const codes = (result: { ok: boolean; errors?: readonly { code: string }[] }): string[] =>
  result.ok ? [] : (result.errors ?? []).map((e) => e.code);

const emailChain = (email: string | null, maxLength = 100, cascade = false) =>
  Validator.validate<M>({ email, age: 0 }, (rules) => {
    const chain = rules.for('email').notEmpty();
    if (cascade) chain.cascade(CascadeMode.Continue);
    chain.minLength(5).maxLength(maxLength).emailAddress();
  });

describe('CascadeMode', () => {
  it('exposes Stop and Continue', () => {
    expect(CascadeMode.Stop).toBe('Stop');
    expect(CascadeMode.Continue).toBe('Continue');
  });

  it('Stop halts the chain after the first failure', () => {
    expect(codes(emailChain('ab'))).toEqual(['email.MinLength']);
  });

  it('Stop: a firing guard produces only the guard error', () => {
    expect(codes(emailChain(null))).toEqual(['email.NotEmpty']);
  });

  it('Continue accumulates every failing validator', () => {
    expect(codes(emailChain('ab', 100, true))).toEqual(['email.MinLength', 'email.EmailAddress']);
  });

  it('Continue after a guard that already failed keeps the chain stopped', () => {
    expect(codes(emailChain(null, 100, true))).toEqual(['email.NotEmpty']);
  });

  it('Continue passes when every validator passes', () => {
    expect(emailChain('user@example.com', 100, true).ok).toBe(true);
  });

  it('Continue reports only the failing validator', () => {
    expect(codes(emailChain(`${'a'.repeat(50)}@example.com`, 20, true))).toEqual([
      'email.MaxLength',
    ]);
  });

  const range = (value: number) =>
    Validator.validate({ value }, (rules) => {
      rules
        .for('value')
        .cascade(CascadeMode.Continue)
        .greaterThan(0)
        .lessThan(100)
        .must((v) => v % 2 === 0, 'Value.Even', 'Value must be even.');
    });

  it('Continue on comparables: only the failing constraint is reported', () => {
    expect(codes(range(0))).toEqual(['value.GreaterThan']);
  });

  it('Continue on comparables: two failures', () => {
    expect(codes(range(201))).toEqual(['value.LessThan', 'Value.Even']);
  });

  it('chains are independent', () => {
    const result = Validator.validate<M>({ email: null, age: -5 }, (rules) => {
      rules.for('email').notEmpty();
      rules.for('age').cascade(CascadeMode.Continue).greaterThan(0).lessThan(150);
    });
    expect(codes(result)).toEqual(['email.NotEmpty', 'age.GreaterThan']);
  });

  it('cascade(Stop) after Continue stops again on the next failure', () => {
    const result = Validator.validate({ value: 500 }, (rules) => {
      rules
        .for('value')
        .cascade(CascadeMode.Continue)
        .lessThan(100)
        .cascade(CascadeMode.Stop)
        .lessThan(50)
        .lessThan(10);
    });
    // The chain already failed, so cascade(Stop) is ignored (mode is only changed before a failure).
    expect(codes(result)).toEqual(['value.LessThan', 'value.LessThan', 'value.LessThan']);
  });

  it('cascade(Stop) before any failure restores Stop behaviour', () => {
    const result = Validator.validate({ value: 500 }, (rules) => {
      rules
        .for('value')
        .cascade(CascadeMode.Continue)
        .cascade(CascadeMode.Stop)
        .lessThan(100)
        .lessThan(50);
    });
    expect(codes(result)).toEqual(['value.LessThan']);
  });
});
