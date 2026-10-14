import { type AppError, Err } from '../../src/errors/app-error.js';
import { ErrorMetadata } from '../../src/errors/error-metadata.js';
import { ErrorType } from '../../src/errors/error-type.js';
import {
  compare,
  countOf,
  display,
  isEmptyIterable,
  prefixError,
} from '../../src/validation/internal.js';

function* yieldAll<T>(...items: T[]): Generator<T> {
  yield* items;
}

describe('compare', () => {
  it('treats two NaN values as equal', () => {
    expect(compare(Number.NaN, Number.NaN)).toBe(0);
  });

  it('sorts NaN before every number', () => {
    expect(compare(Number.NaN, -1)).toBe(-1);
    expect(compare(-1, Number.NaN)).toBe(1);
  });

  it('compares Dates by timestamp', () => {
    expect(compare(new Date(1), new Date(2))).toBe(-1);
    expect(compare(new Date(2), new Date(2))).toBe(0);
  });
});

describe('display', () => {
  it('renders an invalid Date as Invalid Date', () => {
    expect(display(new Date(Number.NaN))).toBe('Invalid Date');
  });

  it('renders a valid Date as an ISO string', () => {
    expect(display(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('countOf', () => {
  it('uses the size of a Set or Map', () => {
    expect(countOf(new Set([1, 2, 3]))).toBe(3);
    expect(countOf(new Map([['a', 1]]))).toBe(1);
  });

  it('counts the items of any other iterable', () => {
    expect(countOf(yieldAll('a', 'b'))).toBe(2);
  });
});

describe('isEmptyIterable', () => {
  it('is false for a generator that yields an item', () => {
    expect(isEmptyIterable(yieldAll(1))).toBe(false);
  });

  it('is true for a generator that yields nothing', () => {
    expect(isEmptyIterable(yieldAll())).toBe(true);
  });

  it('uses the size of a Set or Map', () => {
    expect(isEmptyIterable(new Set())).toBe(true);
    expect(isEmptyIterable(new Map([['a', 1]]))).toBe(false);
  });
});

describe('prefixError', () => {
  it('qualifies the quoted property name and keeps type and metadata', () => {
    const metadata = ErrorMetadata.fromRecord({ limit: 3 });
    const error = prefixError(
      Err.conflict('city.NotEmpty', "'city' must not be empty.", metadata),
      'address.',
    );
    expect(error.code).toBe('address.city.NotEmpty');
    expect(error.description).toBe("'address.city' must not be empty.");
    expect(error.type).toBe(ErrorType.Conflict);
    expect(error.metadata).toEqual(metadata);
  });

  it('falls back to a Validation error for an unknown error type', () => {
    const foreign = {
      code: 'city.X',
      description: "'city' x",
      type: 'Bogus',
      metadata: undefined,
    } as unknown as AppError;
    const error = prefixError(foreign, 'address.');
    expect(error.type).toBe(ErrorType.Validation);
    expect(error.code).toBe('address.city.X');
    expect(error.description).toBe("'address.city' x");
  });

  it('leaves the description alone when the code has no property part', () => {
    const error = prefixError(Err.validation('Custom', "'Custom' failed."), 'items[0].');
    expect(error.code).toBe('items[0].Custom');
    expect(error.description).toBe("'Custom' failed.");
  });

  it('leaves the description alone when it does not quote the property name', () => {
    const error = prefixError(Err.validation('city.NotEmpty', 'Fill in a city.'), 'address.');
    expect(error.description).toBe('Fill in a city.');
  });
});
