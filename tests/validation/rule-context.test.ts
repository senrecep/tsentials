import { Err } from '../../src/errors/app-error.js';
import { Result } from '../../src/result/result.js';
import type { Rule } from '../../src/rules/rule.js';
import { Validator } from '../../src/validation/index.js';

interface TagsModel {
  name: string;
  tags: readonly string[];
}

const tagsModel: TagsModel = { name: 'n', tags: ['a'] };

describe('RuleContext.forEachAsync', () => {
  it('rejects with a TypeError when the explicit form has no configure callback', async () => {
    await expect(
      Validator.validateAsync(tagsModel, async (rules) => {
        await (rules.forEachAsync as unknown as (items: unknown, name: string) => Promise<void>)(
          ['x'],
          'names',
        );
      }),
    ).rejects.toThrow('configure must be a function.');
  });

  it('passes the options signal to the callback instead of the run signal', async () => {
    const run = new AbortController();
    const own = new AbortController();
    let received: AbortSignal | undefined;
    await Validator.validateAsync(
      tagsModel,
      async (rules) => {
        await rules.forEachAsync(
          'tags',
          (_itemRules, _tag, signal) => {
            received = signal;
          },
          { signal: own.signal },
        );
      },
      { signal: run.signal },
    );
    expect(received).toBe(own.signal);
  });
});

describe('RuleContext.satisfies (model level)', () => {
  it('adds no error for a passing rule', () => {
    const result = Validator.validate(tagsModel, (rules) => {
      rules.satisfies(() => Result.ok());
    });
    expect(result.ok).toBe(true);
  });

  it('throws a TypeError for an async rule', () => {
    const asyncRule = (async () => Result.ok()) as unknown as Rule<TagsModel>;
    expect(() =>
      Validator.validate(tagsModel, (rules) => {
        rules.satisfies(asyncRule);
      }),
    ).toThrow('satisfies() received an async rule; use satisfiesAsync() instead.');
  });
});

describe('satisfies with a throwing rule', () => {
  const boom = (): never => {
    throw new Error('boom');
  };
  const codes = (result: { ok: boolean; errors?: readonly { code: string }[] }) =>
    result.ok ? [] : (result.errors ?? []).map((e) => e.code);

  it('RuleContext.satisfies records Rule.EvaluationFailed instead of throwing', () => {
    const result = Validator.validate(tagsModel, (rules) => {
      rules.satisfies(boom);
    });
    expect(result.ok ? undefined : result.errors[0]).toMatchObject({
      code: 'Rule.EvaluationFailed',
      type: 'Unexpected',
      description: 'boom',
    });
  });

  it('RuleChain.satisfies records Rule.EvaluationFailed and marks the chain failed', () => {
    const result = Validator.validate(tagsModel, (rules) => {
      rules.for('name').satisfies(boom).notEmpty().equal('x');
    });
    expect(codes(result)).toEqual(['Rule.EvaluationFailed']);
  });

  it('satisfiesAsync turns a throwing or rejecting rule into Rule.EvaluationFailed', async () => {
    const result = await Validator.validateAsync(tagsModel, async (rules) => {
      await rules.satisfiesAsync(boom);
      await rules.for('name').satisfiesAsync(async () => boom());
    });
    expect(codes(result)).toEqual(['Rule.EvaluationFailed', 'Rule.EvaluationFailed']);
  });
});

describe('RuleContext.satisfiesAsync (model level)', () => {
  it('adds no error for a passing async rule', async () => {
    const result = await Validator.validateAsync(tagsModel, async (rules) => {
      await rules.satisfiesAsync(async () => Result.ok());
    });
    expect(result.ok).toBe(true);
  });

  it('passes the options signal to the rule instead of the run signal', async () => {
    const run = new AbortController();
    const own = new AbortController();
    let received: AbortSignal | undefined;
    const result = await Validator.validateAsync(
      tagsModel,
      async (rules) => {
        await rules.satisfiesAsync(
          async (_model, signal) => {
            received = signal;
            return Result.failure(Err.validation('Model.Bad', 'Bad.'));
          },
          { signal: own.signal },
        );
      },
      { signal: run.signal },
    );
    expect(received).toBe(own.signal);
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['Model.Bad']);
  });
});
