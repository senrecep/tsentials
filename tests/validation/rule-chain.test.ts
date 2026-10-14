import { Err } from '../../src/errors/app-error.js';
import { Result } from '../../src/result/result.js';
import type { Rule } from '../../src/rules/rule.js';
import { RuleEngine } from '../../src/rules/rule-engine.js';
import type { RuleChain } from '../../src/validation/index.js';
import { CascadeMode, Validator } from '../../src/validation/index.js';

interface Model {
  text: string | null;
  number: number;
}

interface OuterModel {
  inner: Model | null;
}

const model = (text: string | null, number = 5): Model => ({ text, number });

describe('RuleChain.must', () => {
  it('adds the given code and message (verbatim, no path prefix) when the predicate fails', () => {
    const result = Validator.validate(model('hello'), (rules) => {
      rules.for('text').must((v) => v === 'world', 'Text.Wrong', "Must be 'world'.");
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe('Text.Wrong');
    expect(result.errors[0]?.description).toBe("Must be 'world'.");
    expect(result.errors[0]?.type).toBe('Validation');
  });

  it('passes when the predicate returns true', () => {
    const result = Validator.validate(model('world'), (rules) => {
      rules.for('text').must((v) => v === 'world', 'Text.Wrong', "Must be 'world'.");
    });
    expect(result.ok).toBe(true);
  });

  it('is skipped after an earlier failure on the same chain', () => {
    const result = Validator.validate(model(null), (rules) => {
      rules
        .for('text')
        .notNull()
        .must((v) => v === 'world', 'Text.Wrong', "Must be 'world'.");
    });
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['text.NotNull']);
  });

  it('errors accumulate across different properties', () => {
    const result = Validator.validate(model(null, -1), (rules) => {
      rules.for('text').notNull();
      rules.for('number').greaterThan(0);
    });
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual([
      'text.NotNull',
      'number.GreaterThan',
    ]);
  });

  it('default overload uses <path>.Must and the explicit expression', () => {
    const result = Validator.validate(model('abc'), (rules) => {
      rules.for('text').must((v) => v === 'x', { expression: "v === 'x'" });
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('text.Must');
    expect(result.errors[0]?.description).toBe("'text' did not satisfy the condition: v === 'x'.");
  });

  it('default overload falls back to the predicate source', () => {
    const predicate = (v: string | null): boolean => v === 'x';
    const result = Validator.validate(model('abc'), (rules) => {
      rules.for('text').must(predicate);
    });
    if (result.ok) throw new Error('expected failure');
    expect(result.errors[0]?.description).toBe(
      `'text' did not satisfy the condition: ${predicate.toString()}.`,
    );
  });

  it('throws a TypeError for an async predicate', () => {
    expect(() =>
      Validator.validate(model('abc'), (rules) => {
        rules.for('text').must((async () => true) as unknown as (v: string | null) => boolean);
      }),
    ).toThrow(TypeError);
  });
});

describe('RuleChain.mustAsync', () => {
  it('adds the error when the async predicate returns false', async () => {
    const result = await Validator.validateAsync(model('hello'), async (rules, _m, signal) => {
      await rules
        .for('text')
        .mustAsync(async (v) => v === 'world', 'Text.Wrong', "Must be 'world'.", { signal });
    });
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['Text.Wrong']);
  });

  it('passes when the async predicate returns true', async () => {
    const result = await Validator.validateAsync(model('world'), async (rules) => {
      await rules.for('text').mustAsync(async (v) => v === 'world', 'Text.Wrong', 'x');
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a synchronous boolean predicate', async () => {
    const result = await Validator.validateAsync(model('hello'), async (rules) => {
      await rules.for('text').mustAsync((v) => v === 'world', 'Text.Wrong', 'x');
    });
    expect(result.ok).toBe(false);
  });

  it('resolves to the chain so chaining continues', async () => {
    const result = await Validator.validateAsync(model('toolong'), async (rules) => {
      (await rules.for('text').mustAsync(async () => true, 'C', 'M')).maxLength(3);
    });
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['text.MaxLength']);
  });

  it('is skipped (predicate not called) when the chain already failed', async () => {
    const predicate = vi.fn(async () => false);
    const result = await Validator.validateAsync(model(null), async (rules) => {
      await rules.for('text').notNull().mustAsync(predicate, 'C', 'M');
    });
    expect(predicate).not.toHaveBeenCalled();
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['text.NotNull']);
  });

  it('passes the run signal to the predicate', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    await Validator.validateAsync(
      model('a'),
      async (rules) => {
        await rules.for('text').mustAsync(
          (_v, signal) => {
            received = signal;
            return true;
          },
          'C',
          'M',
        );
      },
      { signal: controller.signal },
    );
    expect(received).toBe(controller.signal);
  });

  it('a throwing predicate rejects (not turned into a validation error)', async () => {
    const boom = new Error('boom');
    await expect(
      Validator.validateAsync(model('a'), async (rules) => {
        await rules.for('text').mustAsync(
          () => {
            throw boom;
          },
          'C',
          'M',
        );
      }),
    ).rejects.toBe(boom);
  });
});

describe('RuleChain metadata', () => {
  it('propertyName is the path', () => {
    let captured = '';
    Validator.validate(model('test'), (rules) => {
      captured = rules.for('text').propertyName;
    });
    expect(captured).toBe('text');
  });

  it('propertyName of a nested path', () => {
    let captured = '';
    const outer: OuterModel = { inner: model('test') };
    Validator.validate(outer, (rules) => {
      captured = rules.for('inner.text').propertyName;
    });
    expect(captured).toBe('inner.text');
  });

  it('value is captured immediately', () => {
    let captured: unknown;
    Validator.validate(model('test', 7), (rules) => {
      captured = rules.for('number').value;
    });
    expect(captured).toBe(7);
  });

  it('addError records only the first error in Stop mode', () => {
    const result = Validator.validate(model(null), (rules) => {
      const chain: RuleChain<string | null> = rules.for('text');
      chain.addError(Err.validation('First', 'First error.'));
      chain.addError(Err.validation('Second', 'This should be ignored.'));
    });
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['First']);
  });

  it('addError records every error in Continue mode', () => {
    const result = Validator.validate(model(null), (rules) => {
      rules
        .for('text')
        .cascade(CascadeMode.Continue)
        .addError(Err.validation('First', 'a'))
        .addError(Err.validation('Second', 'b'));
    });
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['First', 'Second']);
  });

  it('addFailure adds a model-level error', () => {
    const result = Validator.validate(model('test'), (rules) => {
      rules.addFailure('Model.Invalid', 'Cross-field validation failed.');
    });
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['Model.Invalid']);
  });

  it('addFailure accepts an AppError verbatim', () => {
    const error = Err.conflict('Model.Conflict', 'Conflict.');
    const result = Validator.validate(model('test'), (rules) => {
      rules.addFailure(error);
    });
    expect(result.ok ? undefined : result.errors[0]).toBe(error);
  });

  it('hasFailed is false before any error', () => {
    let hasFailed = true;
    Validator.validate(model('test'), (rules) => {
      hasFailed = rules.for('text').hasFailed;
    });
    expect(hasFailed).toBe(false);
  });

  it('hasFailed is true after a failure', () => {
    let hasFailed = false;
    Validator.validate(model(null), (rules) => {
      hasFailed = rules.for('text').notNull().hasFailed;
    });
    expect(hasFailed).toBe(true);
  });

  it('hasFailed stays false in Continue mode', () => {
    let hasFailed = true;
    Validator.validate(model(null), (rules) => {
      hasFailed = rules.for('text').cascade(CascadeMode.Continue).notNull().hasFailed;
    });
    expect(hasFailed).toBe(false);
  });
});

describe('RuleChain.satisfies (Rule / RuleEngine integration)', () => {
  const notBlank: Rule<string | null> = (v) =>
    v !== null && v.trim() !== ''
      ? Result.ok()
      : Result.failure(Err.validation('Text.Blank', 'Blank.'));
  const short: Rule<string | null> = (v) =>
    v === null || v.length <= 3
      ? Result.ok()
      : Result.failure(Err.validation('Text.Long', 'Long.'));

  it('records every error of a failing rule verbatim and stops the chain', () => {
    const rule = RuleEngine.and(notBlank, short);
    const result = Validator.validate(model('   '), (rules) => {
      rules.for('text').satisfies(rule).maxLength(1);
    });
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['Text.Blank']);
  });

  it('collects all errors from RuleEngine.andAll', () => {
    const blankOrLong: Rule<string | null> = RuleEngine.andAll(
      (v: string | null) => (v === 'xxxx' ? Result.failure(Err.validation('A', 'a')) : Result.ok()),
      short,
    );
    const result = Validator.validate(model('xxxx'), (rules) => {
      rules.for('text').satisfies(blankOrLong);
    });
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['A', 'Text.Long']);
  });

  it('passes when the rule passes', () => {
    const result = Validator.validate(model('abc'), (rules) => {
      rules.for('text').satisfies(notBlank).satisfies(short);
    });
    expect(result.ok).toBe(true);
  });

  it('satisfiesAsync evaluates async rules and forwards the signal', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const result = await Validator.validateAsync(
      model('toolong'),
      async (rules) => {
        await rules.for('text').satisfiesAsync(async (v, signal) => {
          received = signal;
          return short(v);
        });
      },
      { signal: controller.signal },
    );
    expect(received).toBe(controller.signal);
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['Text.Long']);
  });

  it('satisfies throws a TypeError for an async rule', () => {
    expect(() =>
      Validator.validate(model('a'), (rules) => {
        rules.for('text').satisfies((async () => Result.ok()) as unknown as Rule<string | null>);
      }),
    ).toThrow(TypeError);
  });
});

describe('RuleChain after a failed rule (Stop cascade)', () => {
  const codesOf = (result: Result<unknown>): string[] =>
    result.ok ? [] : result.errors.map((e) => e.code);
  const failing: Rule<string | null> = () => Result.failure(Err.validation('Rule.Ran', 'Ran.'));

  it('skips equal, notEqual and satisfies', () => {
    const result = Validator.validate(model(''), (rules) => {
      rules.for('text').notEmpty().equal('x').notEqual('').satisfies(failing);
    });
    expect(codesOf(result)).toEqual(['text.NotEmpty']);
  });

  it('skips satisfiesAsync without calling the rule', async () => {
    const rule = vi.fn(failing);
    const result = await Validator.validateAsync(model(''), async (rules) => {
      await rules.for('text').notEmpty().satisfiesAsync(rule);
    });
    expect(codesOf(result)).toEqual(['text.NotEmpty']);
    expect(rule).not.toHaveBeenCalled();
  });
});

describe('RuleChain.equal / notEqual with a null operand', () => {
  const descriptionOf = (result: Result<unknown>): string | undefined =>
    result.ok ? undefined : result.errors[0]?.description;

  it('equal quotes an empty expected value when a string is compared with null', () => {
    const result = Validator.validate(model('abc'), (rules) => {
      rules.for('text').equal(null);
    });
    expect(descriptionOf(result)).toBe("'text' must be equal to ''.");
  });

  it('equal renders a null expected value as empty for non-string values', () => {
    const result = Validator.validate<{ count: number | null }>({ count: 5 }, (rules) => {
      rules.for('count').equal(null);
    });
    expect(descriptionOf(result)).toBe("'count' must be equal to .");
  });

  it('notEqual fails for null against null and quotes an empty value', () => {
    const result = Validator.validate(model(null), (rules) => {
      rules.for('text').notEqual(null);
    });
    expect(descriptionOf(result)).toBe("'text' must not be equal to ''.");
  });
});
