import type { AppError } from '../../src/errors/app-error.js';
import type { Result } from '../../src/result/result.js';
import type { RuleChain } from '../../src/validation/index.js';
import { Validator } from '../../src/validation/index.js';

interface CollectionModel {
  items: Iterable<string> | null;
}

type Chain = RuleChain<Iterable<string> | null>;

const validate = (items: Iterable<string> | null, configure: (c: Chain) => void) =>
  Validator.validate<CollectionModel>({ items }, (rules) => {
    configure(rules.for('items'));
  });

const first = (result: Result<unknown>): AppError | undefined =>
  result.ok ? undefined : result.errors[0];

function* generate(count: number): Generator<string> {
  for (let i = 0; i < count; i++) yield 'x';
}

describe('collection validators', () => {
  describe('notEmpty', () => {
    it('fails for a null collection', () => {
      const error = first(validate(null, (c) => c.notEmpty()));
      expect(error?.code).toBe('items.NotEmpty');
      expect(error?.description).toBe("'items' must not be empty.");
    });

    it.each([
      ['array', [] as string[]],
      ['Set', new Set<string>()],
      ['generator', generate(0)],
    ])('fails for an empty %s', (_name, items) => {
      expect(first(validate(items, (c) => c.notEmpty()))?.code).toBe('items.NotEmpty');
    });

    it('passes with items', () => {
      expect(validate(['a', 'b'], (c) => c.notEmpty()).ok).toBe(true);
    });

    it('works with Map properties', () => {
      const result = Validator.validate({ m: new Map<string, number>() }, (rules) => {
        rules.for('m').notEmpty();
      });
      expect(first(result)?.code).toBe('m.NotEmpty');
    });
  });

  describe('minCount', () => {
    it('fails below the minimum', () => {
      const error = first(validate(['a'], (c) => c.minCount(3)));
      expect(error?.code).toBe('items.MinCount');
      expect(error?.description).toBe("'items' must contain at least 3 item(s). It contains 1.");
    });

    it('passes at the minimum', () => {
      expect(validate(['a', 'b', 'c'], (c) => c.minCount(3)).ok).toBe(true);
    });

    it('skips null', () => {
      expect(validate(null, (c) => c.minCount(1)).ok).toBe(true);
    });

    it('throws a RangeError for a negative min', () => {
      expect(() => validate([], (c) => c.minCount(-1))).toThrow(
        new RangeError('min (-1) must not be negative.'),
      );
    });
  });

  describe('maxCount', () => {
    it('fails above the maximum', () => {
      const error = first(validate(['a', 'b', 'c', 'd'], (c) => c.maxCount(3)));
      expect(error?.code).toBe('items.MaxCount');
      expect(error?.description).toBe("'items' must contain at most 3 item(s). It contains 4.");
    });

    it('passes at the maximum', () => {
      expect(validate(['a', 'b', 'c'], (c) => c.maxCount(3)).ok).toBe(true);
    });

    it('skips null', () => {
      expect(validate(null, (c) => c.maxCount(5)).ok).toBe(true);
    });

    it('throws a RangeError for a negative max', () => {
      expect(() => validate([], (c) => c.maxCount(-1))).toThrow(
        new RangeError('max (-1) must not be negative.'),
      );
    });
  });

  describe('countBetween', () => {
    it('fails below the range', () => {
      const error = first(validate(['a'], (c) => c.countBetween(2, 5)));
      expect(error?.code).toBe('items.CountBetween');
      expect(error?.description).toBe(
        "'items' must contain between 2 and 5 item(s). It contains 1.",
      );
    });

    it('fails above the range', () => {
      expect(validate(['a', 'b', 'c', 'd', 'e', 'f'], (c) => c.countBetween(2, 5)).ok).toBe(false);
    });

    it.each([2, 3, 5])('passes for %d generated items', (count) => {
      expect(validate(generate(count), (c) => c.countBetween(2, 5)).ok).toBe(true);
    });

    it('skips null', () => {
      expect(validate(null, (c) => c.countBetween(1, 5)).ok).toBe(true);
    });

    it('throws a RangeError for invalid bounds', () => {
      expect(() => validate([], (c) => c.countBetween(5, 2))).toThrow(
        new RangeError('min (5) must not be greater than max (2).'),
      );
    });
  });

  describe('typed model properties', () => {
    interface ListModel {
      tags: string[] | null;
      codes: readonly string[];
      names?: Set<string>;
    }

    it('notEmpty on a null array property', () => {
      const result = Validator.validate<ListModel>({ tags: null, codes: ['x'] }, (rules) => {
        rules.for('tags').notEmpty();
      });
      expect(first(result)?.code).toBe('tags.NotEmpty');
    });

    it('notEmpty on an empty readonly array', () => {
      const result = Validator.validate<ListModel>({ tags: [], codes: [] }, (rules) => {
        rules.for('codes').notEmpty();
      });
      expect(first(result)?.code).toBe('codes.NotEmpty');
    });

    it('notEmpty on a missing optional Set', () => {
      const result = Validator.validate<ListModel>({ tags: [], codes: [] }, (rules) => {
        rules.for('names').notEmpty();
      });
      expect(first(result)?.code).toBe('names.NotEmpty');
    });

    it('count validators on array properties', () => {
      const result = Validator.validate<ListModel>({ tags: ['only-one'], codes: [] }, (rules) => {
        rules.for('tags').countBetween(2, 5);
        rules.for('codes').minCount(1);
      });
      expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual([
        'tags.CountBetween',
        'codes.MinCount',
      ]);
    });
  });
});
