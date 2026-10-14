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
    expect(typeof meta.get('exceptionStackTrace')).toBe('string');
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

  it('returns empty string for exceptionStackTrace when stack is undefined', () => {
    const err = new Error('no stack');
    delete err.stack;
    const meta = ErrorMetadata.fromException(err);
    expect(meta.get('exceptionStackTrace')).toBe('');
  });
});

describe('ErrorMetadata.combine', () => {
  it('returns base when additional is undefined', () => {
    const base = ErrorMetadata.fromRecord({ a: 1 });
    const combined = ErrorMetadata.combine(base, undefined);
    expect(combined).toBe(base);
  });

  it('merges two metadata maps, keeping the base value on key collision (first wins)', () => {
    const base = ErrorMetadata.fromRecord({ a: 1, b: 2 });
    const additional = ErrorMetadata.fromRecord({ b: 3, c: 4 });
    const combined = ErrorMetadata.combine(base, additional);
    expect(combined.get('a')).toBe(1);
    expect(combined.get('b')).toBe(2);
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

describe('ErrorMetadata.fromException — detailed exception keys', () => {
  it('uses the documented key names in order', () => {
    const meta = ErrorMetadata.fromException(new Error('boom'));
    expect([...meta.keys()]).toEqual(['exceptionType', 'exceptionStackTrace', 'exceptionMessage']);
    expect(meta.has('exceptionStack')).toBe(false);
  });

  it('adds a nested innerException map from error.cause (recursive)', () => {
    const root = new TypeError('root cause');
    const middle = new RangeError('middle', { cause: root });
    const top = new Error('top', { cause: middle });
    const meta = ErrorMetadata.fromException(top);

    const inner = meta.get('innerException') as ErrorMetadata;
    expect(inner).toBeInstanceOf(Map);
    expect(inner.get('exceptionType')).toBe('RangeError');
    expect(inner.get('exceptionMessage')).toBe('middle');

    const innermost = inner.get('innerException') as ErrorMetadata;
    expect(innermost.get('exceptionType')).toBe('TypeError');
    expect(innermost.get('exceptionMessage')).toBe('root cause');
    expect(innermost.has('innerException')).toBe(false);
  });

  it('ignores a non-Error cause', () => {
    const meta = ErrorMetadata.fromException(new Error('top', { cause: 'just a string' }));
    expect(meta.has('innerException')).toBe(false);
  });

  it('stops on a cyclic cause chain', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    const meta = ErrorMetadata.fromException(a);
    const inner = meta.get('innerException') as ErrorMetadata;
    expect(inner.get('exceptionMessage')).toBe('b');
    expect(inner.has('innerException')).toBe(false);
  });
});

describe('ErrorMetadata.combine — first wins', () => {
  it('returns a new map even when nothing collides', () => {
    const base = ErrorMetadata.fromRecord({ a: 1 });
    const combined = ErrorMetadata.combine(base, ErrorMetadata.fromRecord({ b: 2 }));
    expect(combined).not.toBe(base);
    expect(ErrorMetadata.toRecord(combined)).toEqual({ a: 1, b: 2 });
  });

  it('keeps base keys first in iteration order', () => {
    const combined = ErrorMetadata.combine(
      ErrorMetadata.fromRecord({ x: 1, y: 2 }),
      ErrorMetadata.fromRecord({ z: 3, x: 99 }),
    );
    expect([...combined.entries()]).toEqual([
      ['x', 1],
      ['y', 2],
      ['z', 3],
    ]);
  });
});

describe('ErrorMetadata.toRecord — nested maps', () => {
  it('converts nested metadata maps to plain objects recursively', () => {
    const meta = ErrorMetadata.fromRecord({
      outer: new Map<string, unknown>([['inner', new Map<string, unknown>([['deep', 1]])]]),
      list: [1, 2],
    });
    expect(ErrorMetadata.toRecord(meta)).toEqual({ outer: { inner: { deep: 1 } }, list: [1, 2] });
  });

  it('produces a JSON-serializable innerException', () => {
    const meta = ErrorMetadata.fromException(new Error('top', { cause: new Error('inner') }));
    const parsed = JSON.parse(JSON.stringify(ErrorMetadata.toRecord(meta)));
    expect(parsed.innerException.exceptionMessage).toBe('inner');
    expect(parsed.innerException.exceptionType).toBe('Error');
  });
});

describe('ErrorMetadata.fromException with values String() rejects', () => {
  it('never throws for an object without a prototype', () => {
    const meta = ErrorMetadata.fromException(Object.create(null));
    expect(meta.get('exceptionType')).toBe('Error');
    expect(meta.get('exceptionMessage')).toBe('[object Object]');
  });
});
