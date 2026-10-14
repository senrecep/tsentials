import type { AppError } from '../../src/errors/app-error.js';
import { Err } from '../../src/errors/app-error.js';
import type { Result } from '../../src/result/result.js';
import type { RuleChain } from '../../src/validation/index.js';
import { Validator } from '../../src/validation/index.js';

interface M {
  value: string | null;
}

const validate = (
  value: string | null,
  configure: (chain: RuleChain<string | null>) => void,
): Result<M> =>
  Validator.validate<M>({ value }, (rules) => {
    configure(rules.for('value'));
  });

const first = (result: Result<M>): AppError | undefined =>
  result.ok ? undefined : result.errors[0];

describe('string validators', () => {
  describe('notEmpty', () => {
    it.each([null, '', '   ', '\t', '\n '])('fails for %j', (value) => {
      const error = first(validate(value, (c) => c.notEmpty()));
      expect(error?.code).toBe('value.NotEmpty');
      expect(error?.description).toBe("'value' must not be empty.");
      expect(error?.type).toBe('Validation');
    });

    it.each(['a', 'hello', '  x  '])('passes for %j', (value) => {
      expect(validate(value, (c) => c.notEmpty()).ok).toBe(true);
    });

    it('uses a custom message', () => {
      expect(first(validate(null, (c) => c.notEmpty('Custom message.')))?.description).toBe(
        'Custom message.',
      );
    });

    it('uses a custom AppError verbatim', () => {
      const custom = Err.failure('Custom.Code', 'Custom.');
      expect(first(validate(null, (c) => c.notEmpty(custom)))).toBe(custom);
    });
  });

  describe('notNull / null', () => {
    it('notNull fails for null', () => {
      const error = first(validate(null, (c) => c.notNull()));
      expect(error?.code).toBe('value.NotNull');
      expect(error?.description).toBe("'value' must not be null.");
    });

    it('notNull passes for an empty string', () => {
      expect(validate('', (c) => c.notNull()).ok).toBe(true);
    });

    it('null fails for a value', () => {
      const error = first(validate('x', (c) => c.null()));
      expect(error?.code).toBe('value.Null');
      expect(error?.description).toBe("'value' must be null.");
    });

    it('null passes for null', () => {
      expect(validate(null, (c) => c.null()).ok).toBe(true);
    });
  });

  describe('maxLength', () => {
    it('fails when the value exceeds the limit', () => {
      const error = first(validate('abcdef', (c) => c.maxLength(5)));
      expect(error?.code).toBe('value.MaxLength');
      expect(error?.description).toBe(
        "'value' must be 5 characters or fewer. You entered 6 characters.",
      );
    });

    it.each(['abcde', 'abc', ''])('passes for %j', (value) => {
      expect(validate(value, (c) => c.maxLength(5)).ok).toBe(true);
    });

    it('skips null', () => {
      expect(validate(null, (c) => c.maxLength(5)).ok).toBe(true);
    });

    it('throws a RangeError for a negative max', () => {
      expect(() => validate('a', (c) => c.maxLength(-1))).toThrow(
        new RangeError('max (-1) must not be negative.'),
      );
    });
  });

  describe('minLength', () => {
    it.each(['ab', ''])('fails for %j', (value) => {
      const error = first(validate(value, (c) => c.minLength(3)));
      expect(error?.code).toBe('value.MinLength');
      expect(error?.description).toBe(
        `'value' must be at least 3 characters. You entered ${value.length} characters.`,
      );
    });

    it('skips null', () => {
      expect(validate(null, (c) => c.minLength(3)).ok).toBe(true);
    });

    it.each(['abc', 'abcdef'])('passes for %j', (value) => {
      expect(validate(value, (c) => c.minLength(3)).ok).toBe(true);
    });

    it('throws a RangeError for a negative min', () => {
      expect(() => validate('a', (c) => c.minLength(-2))).toThrow(
        new RangeError('min (-2) must not be negative.'),
      );
    });
  });

  describe('length', () => {
    it.each(['ab', 'abcdef'])('fails for %j', (value) => {
      const error = first(validate(value, (c) => c.length(3, 5)));
      expect(error?.code).toBe('value.Length');
      expect(error?.description).toBe(
        `'value' must be between 3 and 5 characters. You entered ${value.length} characters.`,
      );
    });

    it.each(['abc', 'abcd', 'abcde'])('passes for %j', (value) => {
      expect(validate(value, (c) => c.length(3, 5)).ok).toBe(true);
    });

    it('skips null', () => {
      expect(validate(null, (c) => c.length(3, 5)).ok).toBe(true);
    });

    it('throws a RangeError for invalid bounds', () => {
      expect(() => validate('a', (c) => c.length(-1, 5))).toThrow(
        new RangeError('min (-1) must not be negative.'),
      );
      expect(() => validate('a', (c) => c.length(6, 5))).toThrow(
        new RangeError('min (6) must not be greater than max (5).'),
      );
    });

    it('validates arguments even when the chain already failed', () => {
      expect(() => validate(null, (c) => c.notNull().length(6, 5))).toThrow(RangeError);
    });
  });

  describe('emailAddress', () => {
    it.each([
      '',
      'notanemail',
      'missing@',
      '@nodomain.com',
      'a b@c.d',
      'a@b',
    ])('fails for %j', (value) => {
      const error = first(validate(value, (c) => c.emailAddress()));
      expect(error?.code).toBe('value.EmailAddress');
      expect(error?.description).toBe("'value' is not a valid email address.");
    });

    it('skips null', () => {
      expect(validate(null, (c) => c.emailAddress()).ok).toBe(true);
    });

    it.each([
      'user@example.com',
      'USER@EXAMPLE.COM',
      'user+tag@domain.co.uk',
    ])('passes for %j', (value) => {
      expect(validate(value, (c) => c.emailAddress()).ok).toBe(true);
    });
  });

  describe('matches', () => {
    it('fails when the pattern does not match', () => {
      const error = first(validate('abc123', (c) => c.matches('^\\d+$')));
      expect(error?.code).toBe('value.Matches');
      expect(error?.description).toBe("'value' is not in the correct format.");
    });

    it('passes when the pattern matches', () => {
      expect(validate('12345', (c) => c.matches('^\\d+$')).ok).toBe(true);
    });

    it('is a search, not an anchored match', () => {
      expect(validate('abc123', (c) => c.matches('\\d+')).ok).toBe(true);
    });

    it('skips null', () => {
      expect(validate(null, (c) => c.matches('^\\d+$')).ok).toBe(true);
    });

    it('accepts a RegExp', () => {
      expect(validate('ABC', (c) => c.matches(/^abc$/i)).ok).toBe(true);
    });

    it('is stateless for global / sticky regexes', () => {
      const regex = /\d/g;
      expect(validate('1', (c) => c.matches(regex)).ok).toBe(true);
      expect(validate('1', (c) => c.matches(regex)).ok).toBe(true);
      expect(regex.lastIndex).toBe(0);
    });
  });

  describe('equal / notEqual', () => {
    it('equal fails when the value differs (quoted message)', () => {
      const error = first(validate('hello', (c) => c.equal('world')));
      expect(error?.code).toBe('value.Equal');
      expect(error?.description).toBe("'value' must be equal to 'world'.");
    });

    it('equal passes when the value matches', () => {
      expect(validate('hello', (c) => c.equal('hello')).ok).toBe(true);
    });

    it('equal is case-sensitive (ordinal)', () => {
      expect(validate('Hello', (c) => c.equal('hello')).ok).toBe(false);
    });

    it('equal: null fails against a string, passes against null', () => {
      expect(validate(null, (c) => c.equal('x')).ok).toBe(false);
      expect(validate(null, (c) => c.equal(null)).ok).toBe(true);
    });

    it('notEqual fails when the value matches', () => {
      const error = first(validate('forbidden', (c) => c.notEqual('forbidden')));
      expect(error?.code).toBe('value.NotEqual');
      expect(error?.description).toBe("'value' must not be equal to 'forbidden'.");
    });

    it('notEqual passes when the value differs', () => {
      expect(validate('allowed', (c) => c.notEqual('forbidden')).ok).toBe(true);
    });

    it('notEqual: null passes against a string', () => {
      expect(validate(null, (c) => c.notEqual('x')).ok).toBe(true);
    });
  });

  describe('contains / startsWith / endsWith', () => {
    it('contains fails when absent', () => {
      const error = first(validate('hello world', (c) => c.contains('xyz')));
      expect(error?.code).toBe('value.Contains');
      expect(error?.description).toBe("'value' must contain 'xyz'.");
    });

    it('contains passes when present', () => {
      expect(validate('hello world', (c) => c.contains('world')).ok).toBe(true);
    });

    it('startsWith fails when absent', () => {
      const error = first(validate('hello', (c) => c.startsWith('world')));
      expect(error?.code).toBe('value.StartsWith');
      expect(error?.description).toBe("'value' must start with 'world'.");
    });

    it('startsWith passes when present', () => {
      expect(validate('hello world', (c) => c.startsWith('hello')).ok).toBe(true);
    });

    it('endsWith fails when absent', () => {
      const error = first(validate('hello', (c) => c.endsWith('world')));
      expect(error?.code).toBe('value.EndsWith');
      expect(error?.description).toBe("'value' must end with 'world'.");
    });

    it('endsWith passes when present', () => {
      expect(validate('hello world', (c) => c.endsWith('world')).ok).toBe(true);
    });

    it.each([
      ['contains', (c: RuleChain<string | null>) => c.contains('x')],
      ['startsWith', (c: RuleChain<string | null>) => c.startsWith('x')],
      ['endsWith', (c: RuleChain<string | null>) => c.endsWith('x')],
    ] as const)('%s skips null', (_name, configure) => {
      expect(validate(null, configure).ok).toBe(true);
    });
  });
});
