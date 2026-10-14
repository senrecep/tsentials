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
  it('throws a TypeError for an async rule', () => {
    const asyncRule = (async () => Result.ok()) as unknown as Rule<TagsModel>;
    expect(() =>
      Validator.validate(tagsModel, (rules) => {
        rules.satisfies(asyncRule);
      }),
    ).toThrow('satisfies() received an async rule; use satisfiesAsync() instead.');
  });
});

describe('RuleContext.satisfiesAsync (model level)', () => {
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
