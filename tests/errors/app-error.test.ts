import { Err } from '../../src/errors/app-error.js';
import { ErrorType } from '../../src/errors/error-type.js';

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
  });

  it('creates forbidden error', () => {
    const err = Err.forbidden();
    expect(err.type).toBe(ErrorType.Forbidden);
  });

  it('creates conflict error', () => {
    const err = Err.conflict('User.EmailTaken', 'Email already in use');
    expect(err.type).toBe(ErrorType.Conflict);
  });

  it('creates unexpected error', () => {
    const err = Err.unexpected();
    expect(err.type).toBe(ErrorType.Unexpected);
  });

  it('creates error from exception', () => {
    const nativeErr = new Error('Connection refused');
    const err = Err.fromException(nativeErr);
    expect(err.description).toBe('Connection refused');
    expect(err.type).toBe(ErrorType.Unexpected);
    expect(err.metadata).toBeDefined();
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
});
