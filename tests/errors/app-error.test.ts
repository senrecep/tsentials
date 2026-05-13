import { Err } from '../../src/errors/app-error.js';
import { ErrorType } from '../../src/errors/error-type.js';
import { ErrorMetadata } from '../../src/errors/error-metadata.js';

describe('Err factory', () => {
  it('creates failure error with defaults', () => {
    const err = Err.failure();
    expect(err.code).toBe('General.Failure');
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
    expect(err.code).toBe('General.Unauthorized');
    expect(err.description).toBe("An 'Unauthorized' error has occurred.");
  });

  it('creates forbidden error', () => {
    const err = Err.forbidden();
    expect(err.type).toBe(ErrorType.Forbidden);
    expect(err.code).toBe('General.Forbidden');
  });

  it('creates conflict error', () => {
    const err = Err.conflict('User.EmailTaken', 'Email already in use');
    expect(err.type).toBe(ErrorType.Conflict);
    expect(err.code).toBe('User.EmailTaken');
  });

  it('creates unexpected error', () => {
    const err = Err.unexpected();
    expect(err.type).toBe(ErrorType.Unexpected);
    expect(err.code).toBe('General.Unexpected');
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
    expect(err.type).toBe(ErrorType.Unexpected);
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
