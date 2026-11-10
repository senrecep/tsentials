import { Err } from '../../src/errors/app-error.js';
import { ErrorMetadata } from '../../src/errors/error-metadata.js';
import type { ErrorType } from '../../src/errors/error-type.js';

describe('Err edge cases', () => {
  it('toJSON maps a type outside ErrorType to the Unknown ordinal', () => {
    const error = Err.failure('Code', 'description');
    const json = Err.toJSON({ ...error, type: 'NotAType' as ErrorType });
    expect(json.numericType).toBe(7);
  });

  it('equals treats errors sharing one metadata map as equal', () => {
    const metadata = ErrorMetadata.fromRecord({ key: 'value' });
    const a = Err.validation('Code', 'description', metadata);
    const b = Err.validation('Code', 'description', metadata);
    expect(Err.equals(a, b)).toBe(true);
  });
});
