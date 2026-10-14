import type { AppError } from '../../src/errors/app-error.js';
import type { Result } from '../../src/result/result.js';
import type { RuleChain } from '../../src/validation/index.js';
import { Validator } from '../../src/validation/index.js';

interface M {
  value: number;
}

interface N {
  value: number | null | undefined;
}

const validate = (value: number, configure: (chain: RuleChain<number>) => void): Result<M> =>
  Validator.validate<M>({ value }, (rules) => {
    configure(rules.for('value'));
  });

const validateNullable = (
  value: number | null | undefined,
  configure: (chain: RuleChain<number | null | undefined>) => void,
): Result<N> =>
  Validator.validate<N>({ value }, (rules) => {
    configure(rules.for('value'));
  });

const first = (result: Result<unknown>): AppError | undefined =>
  result.ok ? undefined : result.errors[0];

describe('comparable validators', () => {
  describe('greaterThan', () => {
    it.each([0, -1, 5])('fails for %d', (value) => {
      const error = first(validate(value, (c) => c.greaterThan(5)));
      expect(error?.code).toBe('value.GreaterThan');
      expect(error?.description).toBe("'value' must be greater than 5.");
    });

    it.each([6, 100])('passes for %d', (value) => {
      expect(validate(value, (c) => c.greaterThan(5)).ok).toBe(true);
    });
  });

  describe('greaterThanOrEqualTo', () => {
    it('fails below the threshold', () => {
      const error = first(validate(4, (c) => c.greaterThanOrEqualTo(5)));
      expect(error?.code).toBe('value.GreaterThanOrEqualTo');
      expect(error?.description).toBe("'value' must be greater than or equal to 5.");
    });

    it.each([5, 6])('passes for %d', (value) => {
      expect(validate(value, (c) => c.greaterThanOrEqualTo(5)).ok).toBe(true);
    });
  });

  describe('lessThan', () => {
    it.each([5, 10])('fails for %d', (value) => {
      const error = first(validate(value, (c) => c.lessThan(5)));
      expect(error?.code).toBe('value.LessThan');
      expect(error?.description).toBe("'value' must be less than 5.");
    });

    it('passes below the threshold', () => {
      expect(validate(4, (c) => c.lessThan(5)).ok).toBe(true);
    });
  });

  describe('lessThanOrEqualTo', () => {
    it('fails above the threshold', () => {
      const error = first(validate(6, (c) => c.lessThanOrEqualTo(5)));
      expect(error?.code).toBe('value.LessThanOrEqualTo');
      expect(error?.description).toBe("'value' must be less than or equal to 5.");
    });

    it.each([5, 3])('passes for %d', (value) => {
      expect(validate(value, (c) => c.lessThanOrEqualTo(5)).ok).toBe(true);
    });
  });

  describe('inclusiveBetween', () => {
    it.each([1, 11])('fails for %d', (value) => {
      const error = first(validate(value, (c) => c.inclusiveBetween(2, 10)));
      expect(error?.code).toBe('value.InclusiveBetween');
      expect(error?.description).toBe("'value' must be between 2 and 10 (inclusive).");
    });

    it.each([2, 5, 10])('passes for %d', (value) => {
      expect(validate(value, (c) => c.inclusiveBetween(2, 10)).ok).toBe(true);
    });

    it('throws a RangeError when min > max', () => {
      expect(() => validate(1, (c) => c.inclusiveBetween(10, 2))).toThrow(
        new RangeError('min (10) must not be greater than max (2).'),
      );
    });

    it('allows min === max', () => {
      expect(validate(3, (c) => c.inclusiveBetween(3, 3)).ok).toBe(true);
    });
  });

  describe('exclusiveBetween', () => {
    it.each([2, 10, 0])('fails for %d', (value) => {
      const error = first(validate(value, (c) => c.exclusiveBetween(2, 10)));
      expect(error?.code).toBe('value.ExclusiveBetween');
      expect(error?.description).toBe("'value' must be between 2 and 10 (exclusive).");
    });

    it.each([3, 9])('passes for %d', (value) => {
      expect(validate(value, (c) => c.exclusiveBetween(2, 10)).ok).toBe(true);
    });

    it('throws a RangeError when min >= max', () => {
      expect(() => validate(1, (c) => c.exclusiveBetween(5, 5))).toThrow(
        new RangeError('min (5) must be less than max (5) for an exclusive range.'),
      );
    });
  });

  describe('equal / notEqual (generic, unquoted)', () => {
    it('equal fails when the value differs', () => {
      const error = first(validate(3, (c) => c.equal(5)));
      expect(error?.code).toBe('value.Equal');
      expect(error?.description).toBe("'value' must be equal to 5.");
    });

    it('equal passes when the value matches', () => {
      expect(validate(5, (c) => c.equal(5)).ok).toBe(true);
    });

    it('notEqual fails when the value matches', () => {
      const error = first(validate(5, (c) => c.notEqual(5)));
      expect(error?.code).toBe('value.NotEqual');
      expect(error?.description).toBe("'value' must not be equal to 5.");
    });

    it('notEqual passes when the value differs', () => {
      expect(validate(3, (c) => c.notEqual(5)).ok).toBe(true);
    });

    it('equal treats NaN as equal to NaN', () => {
      expect(validate(Number.NaN, (c) => c.equal(Number.NaN)).ok).toBe(true);
    });

    it('equal fails for a null value', () => {
      expect(validateNullable(null, (c) => c.equal(5)).ok).toBe(false);
    });

    it('notEqual skips a null value', () => {
      expect(validateNullable(null, (c) => c.notEqual(5)).ok).toBe(true);
    });

    it('equal compares Dates by timestamp', () => {
      const result = Validator.validate({ at: new Date(1000) }, (rules) => {
        rules.for('at').equal(new Date(1000));
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('other comparable types', () => {
    it('Dates compare by timestamp and render as ISO strings', () => {
      const value = new Date('2020-01-01T00:00:00.000Z');
      const threshold = new Date('2024-01-01T00:00:00.000Z');
      const result = Validator.validate(value, (rules) => {
        rules.for(value, 'v').greaterThan(threshold);
      });
      const error = first(result);
      expect(error?.code).toBe('v.GreaterThan');
      expect(error?.description).toBe("'v' must be greater than 2024-01-01T00:00:00.000Z.");
    });

    it('strings compare ordinally', () => {
      const result = Validator.validate({ s: 'b' }, (rules) => {
        rules.for('s').greaterThan('a').lessThan('c');
      });
      expect(result.ok).toBe(true);
      const fail = Validator.validate({ s: 'B' }, (rules) => {
        rules.for('s').greaterThan('a');
      });
      expect(first(fail)?.description).toBe("'s' must be greater than a.");
    });

    it('bigints are supported', () => {
      const result = Validator.validate({ n: 10n }, (rules) => {
        rules.for('n').inclusiveBetween(1n, 5n);
      });
      expect(first(result)?.description).toBe("'n' must be between 1 and 5 (inclusive).");
    });

    it('NaN sorts before every number', () => {
      expect(validate(Number.NaN, (c) => c.lessThan(0)).ok).toBe(true);
      expect(validate(Number.NaN, (c) => c.greaterThan(-Infinity)).ok).toBe(false);
    });
  });

  describe('nullable comparables', () => {
    it('notNull fails for null', () => {
      expect(first(validateNullable(null, (c) => c.notNull()))?.code).toBe('value.NotNull');
    });

    it('notNull fails for undefined', () => {
      expect(first(validateNullable(undefined, (c) => c.notNull()))?.code).toBe('value.NotNull');
    });

    it('notNull passes with a value', () => {
      expect(validateNullable(42, (c) => c.notNull()).ok).toBe(true);
    });

    it('null fails with a value', () => {
      expect(first(validateNullable(42, (c) => c.null()))?.code).toBe('value.Null');
    });

    it('null passes for null', () => {
      expect(validateNullable(null, (c) => c.null()).ok).toBe(true);
    });

    it.each([
      ['greaterThan', (c: RuleChain<number | null | undefined>) => c.greaterThan(0)],
      [
        'greaterThanOrEqualTo',
        (c: RuleChain<number | null | undefined>) => c.greaterThanOrEqualTo(0),
      ],
      ['lessThan', (c: RuleChain<number | null | undefined>) => c.lessThan(100)],
      ['lessThanOrEqualTo', (c: RuleChain<number | null | undefined>) => c.lessThanOrEqualTo(100)],
      ['inclusiveBetween', (c: RuleChain<number | null | undefined>) => c.inclusiveBetween(1, 10)],
      ['exclusiveBetween', (c: RuleChain<number | null | undefined>) => c.exclusiveBetween(1, 10)],
    ] as const)('%s skips null', (_name, configure) => {
      expect(validateNullable(null, configure).ok).toBe(true);
    });

    it('greaterThan fails below the threshold', () => {
      expect(validateNullable(-1, (c) => c.greaterThan(0)).ok).toBe(false);
    });

    it('greaterThan passes above the threshold', () => {
      expect(validateNullable(5, (c) => c.greaterThan(0)).ok).toBe(true);
    });

    it('inclusiveBetween passes within range', () => {
      expect(validateNullable(5, (c) => c.inclusiveBetween(1, 10)).ok).toBe(true);
    });

    it('exclusiveBetween fails outside range', () => {
      expect(first(validateNullable(0, (c) => c.exclusiveBetween(1, 10)))?.code).toBe(
        'value.ExclusiveBetween',
      );
    });

    it('exclusiveBetween passes inside range', () => {
      expect(validateNullable(5, (c) => c.exclusiveBetween(1, 10)).ok).toBe(true);
    });
  });
});
