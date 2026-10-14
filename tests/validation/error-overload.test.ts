import type { AppError } from '../../src/errors/app-error.js';
import { Err } from '../../src/errors/app-error.js';
import type { Result } from '../../src/result/result.js';
import type { RuleChain } from '../../src/validation/index.js';
import { Validator } from '../../src/validation/index.js';

const customError = Err.validation('Custom.Code', 'Custom description');

const run = <V>(value: V, configure: (chain: RuleChain<V>) => void): Result<{ value: V }> =>
  Validator.validate({ value }, (rules) => {
    configure(rules.for('value') as RuleChain<V>);
  });

const first = (result: Result<unknown>): AppError | undefined =>
  result.ok ? undefined : result.errors[0];

type Case<V> = readonly [string, V, (chain: RuleChain<V>) => void];

describe('custom AppError overloads (used verbatim)', () => {
  const stringCases: Case<string | null>[] = [
    ['notEmpty', null, (c) => c.notEmpty(customError)],
    ['notNull', null, (c) => c.notNull(customError)],
    ['maxLength', 'toolong', (c) => c.maxLength(3, customError)],
    ['minLength', 'ab', (c) => c.minLength(5, customError)],
    ['length', 'x', (c) => c.length(3, 10, customError)],
    ['emailAddress', 'notanemail', (c) => c.emailAddress(customError)],
    ['matches', 'abc', (c) => c.matches('^\\d+$', customError)],
    ['equal', 'foo', (c) => c.equal('bar', customError)],
    ['notEqual', 'foo', (c) => c.notEqual('foo', customError)],
    ['contains', 'hello', (c) => c.contains('xyz', customError)],
    ['startsWith', 'hello', (c) => c.startsWith('world', customError)],
    ['endsWith', 'hello', (c) => c.endsWith('world', customError)],
  ];

  it.each(stringCases)('string %s', (_name, value, configure) => {
    expect(first(run(value, configure))).toBe(customError);
  });

  it('string notEmpty passes when valid', () => {
    expect(run<string | null>('hello', (c) => c.notEmpty(customError)).ok).toBe(true);
  });

  const numberCases: Case<number>[] = [
    ['greaterThan', 3, (c) => c.greaterThan(5, customError)],
    ['greaterThanOrEqualTo', 3, (c) => c.greaterThanOrEqualTo(5, customError)],
    ['lessThan', 10, (c) => c.lessThan(5, customError)],
    ['lessThanOrEqualTo', 10, (c) => c.lessThanOrEqualTo(5, customError)],
    ['inclusiveBetween', 20, (c) => c.inclusiveBetween(1, 10, customError)],
    ['exclusiveBetween', 1, (c) => c.exclusiveBetween(1, 10, customError)],
    ['equal', 3, (c) => c.equal(5, customError)],
    ['notEqual', 5, (c) => c.notEqual(5, customError)],
  ];

  it.each(numberCases)('comparable %s', (_name, value, configure) => {
    expect(first(run(value, configure))).toBe(customError);
  });

  it('comparable greaterThan passes when valid', () => {
    expect(run(10, (c) => c.greaterThan(5, customError)).ok).toBe(true);
  });

  const nullableCases: Case<number | null>[] = [
    ['notNull', null, (c) => c.notNull(customError)],
    ['null', 5, (c) => c.null(customError)],
    ['greaterThan', 3, (c) => c.greaterThan(5, customError)],
    ['greaterThanOrEqualTo', 3, (c) => c.greaterThanOrEqualTo(5, customError)],
    ['lessThan', 10, (c) => c.lessThan(5, customError)],
    ['lessThanOrEqualTo', 10, (c) => c.lessThanOrEqualTo(5, customError)],
    ['inclusiveBetween', 20, (c) => c.inclusiveBetween(1, 10, customError)],
  ];

  it.each(nullableCases)('nullable %s', (_name, value, configure) => {
    expect(first(run(value, configure))).toBe(customError);
  });

  it('nullable notNull passes when it has a value', () => {
    expect(run<number | null>(5, (c) => c.notNull(customError)).ok).toBe(true);
  });

  const collectionCases: Case<readonly string[] | null>[] = [
    ['notEmpty', null, (c) => c.notEmpty(customError)],
    ['notNull', null, (c) => c.notNull(customError)],
    ['minCount', ['a'], (c) => c.minCount(3, customError)],
    ['maxCount', ['a', 'b', 'c', 'd'], (c) => c.maxCount(2, customError)],
    ['countBetween', ['a', 'b', 'c', 'd', 'e'], (c) => c.countBetween(1, 3, customError)],
  ];

  it.each(collectionCases)('collection %s', (_name, value, configure) => {
    expect(first(run(value, configure))).toBe(customError);
  });

  it('collection notEmpty passes when valid', () => {
    expect(run<readonly string[] | null>(['item'], (c) => c.notEmpty(customError)).ok).toBe(true);
  });

  it('a custom string message keeps the default code', () => {
    const error = first(run<string | null>('toolong', (c) => c.maxLength(3, 'Too long!')));
    expect(error?.code).toBe('value.MaxLength');
    expect(error?.description).toBe('Too long!');
    expect(error?.type).toBe('Validation');
  });

  it('a custom AppError keeps its own type and metadata', () => {
    const conflict = Err.conflict('Value.Taken', 'Taken.', new Map([['field', 'value']]));
    const error = first(run<string | null>('a', (c) => c.equal('b', conflict)));
    expect(error).toBe(conflict);
    expect(error?.type).toBe('Conflict');
    expect(error?.metadata?.get('field')).toBe('value');
  });
});
