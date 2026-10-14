import { Err, errorTypeToHttpStatus } from '../../src/errors/app-error.js';
import { ErrorMetadata } from '../../src/errors/error-metadata.js';
import { ErrorType } from '../../src/errors/error-type.js';

describe('Err factory', () => {
  it('creates failure error with defaults', () => {
    const err = Err.failure();
    expect(err.code).toBe('Failure');
    expect(err.type).toBe(ErrorType.Failure);
    expect(err.metadata).toBeUndefined();
  });

  it('creates validation error with custom code and description', () => {
    const err = Err.validation('User.Email', 'Email is invalid');
    expect(err.code).toBe('User.Email');
    expect(err.description).toBe('Email is invalid');
    expect(err.type).toBe(ErrorType.Validation);
  });

  it('creates notFound error', () => {
    const err = Err.notFound('User.NotFound', 'User not found');
    expect(err.type).toBe(ErrorType.NotFound);
    expect(err.code).toBe('User.NotFound');
  });

  it('creates unauthorized error', () => {
    const err = Err.unauthorized();
    expect(err.type).toBe(ErrorType.Unauthorized);
    expect(err.code).toBe('Unauthorized');
    expect(err.description).toBe("An 'Unauthorized' error has occurred.");
  });

  it('creates forbidden error', () => {
    const err = Err.forbidden();
    expect(err.type).toBe(ErrorType.Forbidden);
    expect(err.code).toBe('Forbidden');
  });

  it('creates conflict error', () => {
    const err = Err.conflict('User.EmailTaken', 'Email already in use');
    expect(err.type).toBe(ErrorType.Conflict);
    expect(err.code).toBe('User.EmailTaken');
  });

  it('creates unexpected error', () => {
    const err = Err.unexpected();
    expect(err.type).toBe(ErrorType.Unexpected);
    expect(err.code).toBe('Unexpected');
  });

  it('creates error with metadata', () => {
    const meta = ErrorMetadata.fromRecord({ key: 'value' });
    const err = Err.validation('Test', 'Message', meta);
    expect(err.metadata).toBe(meta);
  });

  it('creates error from exception', () => {
    const nativeErr = new Error('Connection refused');
    const err = Err.fromException(nativeErr);
    expect(err.description).toBe('Connection refused');
    expect(err.type).toBe(ErrorType.Failure);
    expect(err.metadata).toBeDefined();
  });

  it('creates error from exception with custom type', () => {
    const err = Err.fromException(new Error('boom'), ErrorType.Validation);
    expect(err.type).toBe(ErrorType.Validation);
  });

  it('creates error from exception with custom code', () => {
    const err = Err.fromException(new Error('boom'), ErrorType.Unexpected, 'Custom.Code');
    expect(err.code).toBe('Custom.Code');
  });

  it('creates error from exception with custom metadata', () => {
    const extra = ErrorMetadata.fromRecord({ extra: true });
    const err = Err.fromException(new Error('boom'), ErrorType.Unexpected, undefined, extra);
    expect(err.metadata).toBeDefined();
    expect(ErrorMetadata.toRecord(err.metadata!).extra).toBe(true);
  });

  it('creates error from string exception', () => {
    const err = Err.fromException('plain string error');
    expect(err.description).toBe('plain string error');
    expect(err.code).toBe('Error');
  });

  it('creates error from null exception', () => {
    const err = Err.fromException(null);
    expect(err.description).toBe('null');
  });

  it('is immutable (Object.freeze)', () => {
    const err = Err.validation('X', 'Y');
    expect(Object.isFrozen(err)).toBe(true);
  });

  it('combines multiple errors', () => {
    const e1 = Err.validation('A', 'First');
    const e2 = Err.validation('B', 'Second');
    const combined = Err.combine(e1, e2);
    expect(combined).toHaveLength(2);
    expect(combined[0]).toBe(e1);
    expect(combined[1]).toBe(e2);
  });

  it('compares errors structurally with equals()', () => {
    const a = Err.validation('User.Email', 'Invalid');
    const b = Err.validation('User.Email', 'Invalid');
    const c = Err.validation('User.Phone', 'Invalid');
    expect(Err.equals(a, b)).toBe(true);
    expect(Err.equals(a, c)).toBe(false);
  });

  it('equals returns false when types differ', () => {
    const a = Err.validation('Code', 'Desc');
    const b = Err.notFound('Code', 'Desc');
    expect(Err.equals(a, b)).toBe(false);
  });

  it('equals returns false when descriptions differ', () => {
    const a = Err.validation('Code', 'First');
    const b = Err.validation('Code', 'Second');
    expect(Err.equals(a, b)).toBe(false);
  });

  it('equals returns false when codes differ', () => {
    const a = Err.validation('A', 'Desc');
    const b = Err.validation('B', 'Desc');
    expect(Err.equals(a, b)).toBe(false);
  });
});

describe('Err default codes', () => {
  it.each([
    ['Failure', Err.failure(), 'A failure has occurred.'],
    ['Unexpected', Err.unexpected(), 'An unexpected error has occurred.'],
    ['Validation', Err.validation(), 'A validation error has occurred.'],
    ['Conflict', Err.conflict(), 'A conflict error has occurred.'],
    ['NotFound', Err.notFound(), "A 'Not Found' error has occurred."],
    ['Unauthorized', Err.unauthorized(), "An 'Unauthorized' error has occurred."],
    ['Forbidden', Err.forbidden(), "A 'Forbidden' error has occurred."],
    ['Unknown', Err.unknown(), 'An unknown error has occurred.'],
  ])('%s() uses the bare type name as code', (code, err, description) => {
    expect(err.code).toBe(code);
    expect(err.type).toBe(code);
    expect(err.description).toBe(description);
  });

  it('keeps the default code when only the description is given', () => {
    expect(Err.notFound(undefined, 'Missing').code).toBe('NotFound');
  });
});

describe('Err.unknown', () => {
  it('creates an Unknown error with defaults', () => {
    const err = Err.unknown();
    expect(err.code).toBe('Unknown');
    expect(err.description).toBe('An unknown error has occurred.');
    expect(err.type).toBe(ErrorType.Unknown);
    expect(err.metadata).toBeUndefined();
  });

  it('accepts code, description and metadata', () => {
    const meta = ErrorMetadata.fromRecord({ k: 'v' });
    const err = Err.unknown('X.Unknown', 'Something', meta);
    expect(err).toEqual({
      code: 'X.Unknown',
      description: 'Something',
      type: 'Unknown',
      metadata: meta,
    });
  });
});

describe('Err.fromException — exception details', () => {
  it('defaults to Failure with the constructor name as code', () => {
    class DbError extends Error {}
    const err = Err.fromException(new DbError('db down'));
    expect(err.type).toBe(ErrorType.Failure);
    expect(err.code).toBe('DbError');
    expect(err.description).toBe('db down');
  });

  it('stores exceptionStackTrace and innerException from cause', () => {
    const err = Err.fromException(new Error('top', { cause: new TypeError('inner') }));
    expect(typeof err.metadata?.get('exceptionStackTrace')).toBe('string');
    const inner = err.metadata?.get('innerException') as ErrorMetadata;
    expect(inner.get('exceptionType')).toBe('TypeError');
  });

  it('keeps exception details over supplied metadata on key collision', () => {
    const extra = ErrorMetadata.fromRecord({ exceptionMessage: 'overridden?', traceId: 'abc' });
    const err = Err.fromException(new Error('real'), ErrorType.Unexpected, undefined, extra);
    expect(err.metadata?.get('exceptionMessage')).toBe('real');
    expect(err.metadata?.get('traceId')).toBe('abc');
  });
});

describe('Err.combine — flattening', () => {
  it('flattens errors and error arrays preserving order', () => {
    const [e1, e2, e3, e4] = ['A', 'B', 'C', 'D'].map((c) => Err.validation(c, c)) as [
      ReturnType<typeof Err.validation>,
      ReturnType<typeof Err.validation>,
      ReturnType<typeof Err.validation>,
      ReturnType<typeof Err.validation>,
    ];
    expect(Err.combine(e1, [e2, e3], e4)).toEqual([e1, e2, e3, e4]);
  });

  it('returns a new array and handles empty input', () => {
    const list = [Err.failure()];
    const combined = Err.combine(list);
    expect(combined).toEqual(list);
    expect(combined).not.toBe(list);
    expect(Err.combine()).toEqual([]);
    expect(Err.combine([], [])).toEqual([]);
  });
});

describe('Err.equals — metadata', () => {
  const meta = (r: Record<string, unknown>) => ErrorMetadata.fromRecord(r);

  it('is true when both have no metadata', () => {
    expect(Err.equals(Err.failure('A', 'a'), Err.failure('A', 'a'))).toBe(true);
  });

  it('is false when only one has metadata (even if empty)', () => {
    expect(Err.equals(Err.failure('A', 'a'), Err.failure('A', 'a', ErrorMetadata.empty()))).toBe(
      false,
    );
  });

  it('is true for distinct maps with the same entries', () => {
    expect(
      Err.equals(
        Err.failure('A', 'a', meta({ x: 1, y: 'z' })),
        Err.failure('A', 'a', meta({ y: 'z', x: 1 })),
      ),
    ).toBe(true);
  });

  it('is false when a value differs', () => {
    expect(
      Err.equals(Err.failure('A', 'a', meta({ x: 1 })), Err.failure('A', 'a', meta({ x: 2 }))),
    ).toBe(false);
  });

  it('is false when sizes differ', () => {
    expect(
      Err.equals(
        Err.failure('A', 'a', meta({ x: 1 })),
        Err.failure('A', 'a', meta({ x: 1, y: 2 })),
      ),
    ).toBe(false);
  });

  it('is false when keys differ with the same size', () => {
    expect(
      Err.equals(
        Err.failure('A', 'a', meta({ x: undefined })),
        Err.failure('A', 'a', meta({ y: undefined })),
      ),
    ).toBe(false);
  });

  it('compares values by reference (Object.is)', () => {
    expect(
      Err.equals(
        Err.failure('A', 'a', meta({ o: { n: 1 } })),
        Err.failure('A', 'a', meta({ o: { n: 1 } })),
      ),
    ).toBe(false);
    expect(
      Err.equals(
        Err.failure('A', 'a', meta({ n: Number.NaN })),
        Err.failure('A', 'a', meta({ n: Number.NaN })),
      ),
    ).toBe(true);
  });
});

describe('AppError JSON serialization', () => {
  it('JSON.stringify emits code, description, type, numericType and metadata record', () => {
    const err = Err.validation(
      'User.Email',
      'Invalid',
      ErrorMetadata.fromRecord({ field: 'email' }),
    );
    expect(JSON.parse(JSON.stringify(err))).toEqual({
      code: 'User.Email',
      description: 'Invalid',
      type: 'Validation',
      numericType: 2,
      metadata: { field: 'email' },
    });
  });

  it('omits metadata when absent', () => {
    expect(JSON.parse(JSON.stringify(Err.notFound('X', 'Y')))).toEqual({
      code: 'X',
      description: 'Y',
      type: 'NotFound',
      numericType: 4,
    });
  });

  it.each([
    [Err.failure(), 0],
    [Err.unexpected(), 1],
    [Err.validation(), 2],
    [Err.conflict(), 3],
    [Err.notFound(), 4],
    [Err.unauthorized(), 5],
    [Err.forbidden(), 6],
    [Err.unknown(), 7],
  ])('numericType of %o is the ordinal %i', (err, n) => {
    expect(Err.toJSON(err).numericType).toBe(n);
  });

  it('serializes a nested innerException as a plain object', () => {
    const err = Err.fromException(new Error('top', { cause: new Error('inner') }));
    const json = JSON.parse(JSON.stringify(err));
    expect(json.metadata.innerException.exceptionMessage).toBe('inner');
    expect(json.metadata.exceptionMessage).toBe('top');
  });

  it('toJSON is non-enumerable so structural equality is unaffected', () => {
    const err = Err.conflict('C', 'D');
    expect(Object.keys(err)).toEqual(['code', 'description', 'type', 'metadata']);
    expect(err).toEqual({ code: 'C', description: 'D', type: 'Conflict', metadata: undefined });
    expect({ ...err }).not.toHaveProperty('toJSON');
  });

  it('Err.toJSON works on plain AppError objects', () => {
    const plain = { code: 'P', description: 'Plain', type: ErrorType.Forbidden };
    expect(Err.toJSON(plain)).toEqual({
      code: 'P',
      description: 'Plain',
      type: 'Forbidden',
      numericType: 6,
    });
  });
});

describe('errorTypeToHttpStatus — full type table', () => {
  it.each([
    [ErrorType.Failure, 500],
    [ErrorType.Unexpected, 500],
    [ErrorType.Unknown, 500],
    [ErrorType.Validation, 400],
    [ErrorType.Unauthorized, 401],
    [ErrorType.Forbidden, 403],
    [ErrorType.NotFound, 404],
    [ErrorType.Conflict, 409],
  ])('%s → %i', (type, status) => {
    expect(errorTypeToHttpStatus(type)).toBe(status);
  });
});

describe('Err.fromException with values String() rejects', () => {
  it('a thrown object without a prototype becomes [object Object]', () => {
    const err = Err.fromException(Object.create(null));
    expect(err.code).toBe('Error');
    expect(err.description).toBe('[object Object]');
    expect(err.type).toBe(ErrorType.Failure);
  });

  it('a value whose conversion and tag both throw becomes [unserializable]', () => {
    const hostile = {
      [Symbol.toPrimitive]() {
        throw new Error('no primitive');
      },
      get [Symbol.toStringTag](): string {
        throw new Error('no tag');
      },
    };
    expect(Err.fromException(hostile).description).toBe('[unserializable]');
  });

  it('a throwing toString falls back to the object tag', () => {
    const value = {
      toString() {
        throw new Error('no');
      },
    };
    expect(Err.fromException(value).description).toBe('[object Object]');
  });
});
