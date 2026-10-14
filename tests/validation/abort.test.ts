import type { RuleContext } from '../../src/validation/index.js';
import { Validator } from '../../src/validation/index.js';

interface Model {
  name: string | null;
  tags: readonly string[];
  address: { city: string | null } | null;
}

const model = (): Model => ({ name: 'a', tags: ['x', 'y', 'z'], address: { city: 'c' } });

const aborted = (reason: unknown): AbortSignal => {
  const controller = new AbortController();
  controller.abort(reason);
  return controller.signal;
};

describe('abort support', () => {
  it('validateAsync rejects with the reason when the signal is already aborted', async () => {
    const reason = new Error('already');
    const configure = vi.fn();
    await expect(
      Validator.validateAsync(model(), configure, { signal: aborted(reason) }),
    ).rejects.toBe(reason);
    expect(configure).not.toHaveBeenCalled();
  });

  it('subclass validateAsync honours the signal', async () => {
    class V extends Validator<Model> {
      protected configure(rules: RuleContext<Model>): void {
        rules.for('name').notEmpty();
      }
    }
    const reason = new Error('stop');
    await expect(new V().validateAsync(model(), { signal: aborted(reason) })).rejects.toBe(reason);
  });

  it('aborting during a pending mustAsync rejects with the reason (not a validation error)', async () => {
    const controller = new AbortController();
    const reason = new Error('mid-flight');
    const promise = Validator.validateAsync(
      model(),
      async (rules) => {
        await rules
          .for('name')
          .mustAsync(() => new Promise<boolean>(() => undefined), 'Never', 'never');
      },
      { signal: controller.signal },
    );
    controller.abort(reason);
    await expect(promise).rejects.toBe(reason);
  });

  it('mustAsync with an explicit aborted signal rejects without calling the predicate', async () => {
    const reason = new Error('explicit');
    const predicate = vi.fn(async () => true);
    await expect(
      Validator.validateAsync(model(), async (rules) => {
        await rules.for('name').mustAsync(predicate, 'C', 'M', { signal: aborted(reason) });
      }),
    ).rejects.toBe(reason);
    expect(predicate).not.toHaveBeenCalled();
  });

  it('forEachAsync stops between items when aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('between items');
    const visited: string[] = [];
    const promise = Validator.validateAsync(
      model(),
      async (rules) => {
        await rules.forEachAsync('tags', (_itemRules, tag) => {
          visited.push(tag);
          if (tag === 'y') controller.abort(reason);
        });
      },
      { signal: controller.signal },
    );
    await expect(promise).rejects.toBe(reason);
    expect(visited).toEqual(['x', 'y']);
  });

  it('setValidatorAsync forwards an aborted signal to the nested validator', async () => {
    const reason = new Error('nested');
    class CityValidator extends Validator<{ city: string | null }> {
      protected configure(rules: RuleContext<{ city: string | null }>): void {
        rules.for('city').notEmpty();
      }
    }
    await expect(
      Validator.validateAsync(model(), async (rules) => {
        await rules
          .for('address')
          .setValidatorAsync(new CityValidator(), { signal: aborted(reason) });
      }),
    ).rejects.toBe(reason);
  });

  it('satisfiesAsync rejects with the reason when aborted', async () => {
    const reason = new Error('rule');
    await expect(
      Validator.validateAsync(model(), async (rules) => {
        await rules.for('name').satisfiesAsync(
          async () => {
            throw new Error('should not run');
          },
          { signal: aborted(reason) },
        );
      }),
    ).rejects.toBe(reason);
  });

  it('a default AbortController reason (DOMException) propagates as-is', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      Validator.validateAsync(model(), () => undefined, { signal: controller.signal }),
    ).rejects.toBe(controller.signal.reason);
  });

  it('a non-aborted signal leaves results unchanged', async () => {
    const controller = new AbortController();
    const result = await Validator.validateAsync(
      model(),
      async (rules) => {
        await rules.for('name').mustAsync(async () => false, 'Name.Bad', 'Bad.');
      },
      { signal: controller.signal },
    );
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['Name.Bad']);
  });
});
