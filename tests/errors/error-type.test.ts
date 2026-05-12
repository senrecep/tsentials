import { ErrorType } from '../../src/errors/error-type.js';

describe('ErrorType', () => {
  it('has all expected error type values', () => {
    expect(ErrorType.Failure).toBe('Failure');
    expect(ErrorType.Unexpected).toBe('Unexpected');
    expect(ErrorType.Validation).toBe('Validation');
    expect(ErrorType.Conflict).toBe('Conflict');
    expect(ErrorType.NotFound).toBe('NotFound');
    expect(ErrorType.Unauthorized).toBe('Unauthorized');
    expect(ErrorType.Forbidden).toBe('Forbidden');
    expect(ErrorType.Unknown).toBe('Unknown');
  });

  it('is usable as a const enum (as const)', () => {
    const type: typeof ErrorType.Validation = ErrorType.Validation;
    expect(type).toBe('Validation');
  });
});
