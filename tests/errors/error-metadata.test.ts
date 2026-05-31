import { ErrorMetadata } from '../../src/errors/error-metadata.js';

describe('ErrorMetadata.empty', () => {
  it('returns an empty ReadonlyMap', () => {
    const meta = ErrorMetadata.empty();
    expect(meta.size).toBe(0);
  });

  it('returns a ReadonlyMap interface', () => {
    const meta = ErrorMetadata.empty();
    // ReadonlyMap compile-time constraint; runtime object is a standard Map
    expect(meta).toBeInstanceOf(Map);
    expect(meta.size).toBe(0);
  });
});

describe('ErrorMetadata.fromRecord', () => {
  it('creates map from a record', () => {
    const meta = ErrorMetadata.fromRecord({ key1: 'value1', key2: 42 });
    expect(meta.get('key1')).toBe('value1');
    expect(meta.get('key2')).toBe(42);
    expect(meta.size).toBe(2);
  });

  it('creates empty map from empty record', () => {
    const meta = ErrorMetadata.fromRecord({});
    expect(meta.size).toBe(0);
  });

  it('preserves nested objects', () => {
    const nested = { a: 1 };
    const meta = ErrorMetadata.fromRecord({ nested });
    expect(meta.get('nested')).toBe(nested);
  });
});

describe('ErrorMetadata.fromException', () => {
  it('extracts metadata from Error instance', () => {
    const err = new Error('Something broke');
    const meta = ErrorMetadata.fromException(err);
    expect(meta.get('exceptionType')).toBe('Error');
    expect(meta.get('exceptionMessage')).toBe('Something broke');
    expect(typeof meta.get('exceptionStack')).toBe('string');
  });

  it('extracts metadata from custom error class', () => {
    class CustomError extends Error {
      constructor() {
        super('custom');
        this.name = 'CustomError';
      }
    }
    const meta = ErrorMetadata.fromException(new CustomError());
    expect(meta.get('exceptionType')).toBe('CustomError');
  });

  it('wraps non-error values in Error', () => {
    const meta = ErrorMetadata.fromException('plain string');
    expect(meta.get('exceptionType')).toBe('Error');
    expect(meta.get('exceptionMessage')).toBe('plain string');
  });

  it('wraps null in Error', () => {
    const meta = ErrorMetadata.fromException(null);
    expect(meta.get('exceptionType')).toBe('Error');
    expect(meta.get('exceptionMessage')).toBe('null');
  });

  it('wraps undefined in Error', () => {
    const meta = ErrorMetadata.fromException(undefined);
    expect(meta.get('exceptionType')).toBe('Error');
    expect(meta.get('exceptionMessage')).toBe('undefined');
  });

  it('wraps number in Error', () => {
    const meta = ErrorMetadata.fromException(42);
    expect(meta.get('exceptionType')).toBe('Error');
    expect(meta.get('exceptionMessage')).toBe('42');
  });

  it('wraps object in Error', () => {
    const meta = ErrorMetadata.fromException({ toString: () => 'obj' });
    expect(meta.get('exceptionType')).toBe('Error');
    expect(meta.get('exceptionMessage')).toBe('obj');
  });

  it('returns empty string for exceptionStack when stack is undefined', () => {
    const err = new Error('no stack');
    delete err.stack;
    const meta = ErrorMetadata.fromException(err);
    expect(meta.get('exceptionStack')).toBe('');
  });
});

describe('ErrorMetadata.combine', () => {
  it('returns base when additional is undefined', () => {
    const base = ErrorMetadata.fromRecord({ a: 1 });
    const combined = ErrorMetadata.combine(base, undefined);
    expect(combined).toBe(base);
  });

  it('merges two metadata maps', () => {
    const base = ErrorMetadata.fromRecord({ a: 1, b: 2 });
    const additional = ErrorMetadata.fromRecord({ b: 3, c: 4 });
    const combined = ErrorMetadata.combine(base, additional);
    expect(combined.get('a')).toBe(1);
    expect(combined.get('b')).toBe(3);
    expect(combined.get('c')).toBe(4);
  });

  it('does not mutate original maps', () => {
    const base = ErrorMetadata.fromRecord({ a: 1 });
    const additional = ErrorMetadata.fromRecord({ b: 2 });
    ErrorMetadata.combine(base, additional);
    expect(base.size).toBe(1);
    expect(additional.size).toBe(1);
  });
});

describe('ErrorMetadata.toRecord', () => {
  it('converts map back to record', () => {
    const meta = ErrorMetadata.fromRecord({ x: 'hello', y: 99 });
    const record = ErrorMetadata.toRecord(meta);
    expect(record).toEqual({ x: 'hello', y: 99 });
  });

  it('converts empty map to empty record', () => {
    const record = ErrorMetadata.toRecord(ErrorMetadata.empty());
    expect(record).toEqual({});
  });

  it('preserves boolean and null values', () => {
    const meta = ErrorMetadata.fromRecord({ flag: true, nil: null });
    const record = ErrorMetadata.toRecord(meta);
    expect(record.flag).toBe(true);
    expect(record.nil).toBeNull();
  });
});
