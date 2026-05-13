import { Err } from '../../src/errors/app-error.js';
import { Maybe } from '../../src/maybe/maybe.js';
import { maybeToResult, resultToMaybe } from '../../src/result/maybe-bridge.js';
import { Result } from '../../src/result/result.js';

const notFoundError = Err.notFound('Test.NotFound', 'Value not found');

describe('maybeToResult', () => {
  it('converts Some to success Result', () => {
    const maybe = Maybe.some(42);
    const result = maybeToResult(maybe, notFoundError);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('converts None to failure Result with given error', () => {
    const maybe = Maybe.none<number>();
    const result = maybeToResult(maybe, notFoundError);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.code).toBe('Test.NotFound');
      expect(result.errors[0]!.description).toBe('Value not found');
    }
  });

  it('converts Some with object value correctly', () => {
    const obj = { id: 1, name: 'Alice' };
    const result = maybeToResult(Maybe.some(obj), notFoundError);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(obj);
  });

  it('converts Some with null value correctly (null is a valid value)', () => {
    // Note: Maybe.some(null) is possible even if unusual
    const result = maybeToResult(Maybe.some(null), notFoundError);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it('converts Some with false value correctly', () => {
    const result = maybeToResult(Maybe.some(false), notFoundError);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(false);
  });

  it('converts Some with empty string correctly', () => {
    const result = maybeToResult(Maybe.some(''), notFoundError);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('');
  });

  it('converts Some with zero correctly', () => {
    const result = maybeToResult(Maybe.some(0), notFoundError);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0);
  });

  it('converts Maybe.from non-null to success', () => {
    const maybe = Maybe.from('exists');
    const result = maybeToResult(maybe, notFoundError);
    expect(result.ok).toBe(true);
  });

  it('converts Maybe.from null to failure', () => {
    const maybe = Maybe.from(null);
    const result = maybeToResult(maybe, notFoundError);
    expect(result.ok).toBe(false);
  });

  it('converts Maybe.from undefined to failure', () => {
    const maybe = Maybe.from(undefined);
    const result = maybeToResult(maybe, notFoundError);
    expect(result.ok).toBe(false);
  });
});

describe('resultToMaybe', () => {
  it('converts success Result to Some', () => {
    const result = Result.success(42);
    const maybe = resultToMaybe(result);
    expect(maybe.hasValue).toBe(true);
    if (maybe.hasValue) expect(maybe.value).toBe(42);
  });

  it('converts failure Result to None', () => {
    const result = Result.failure(notFoundError);
    const maybe = resultToMaybe(result);
    expect(maybe.hasValue).toBe(false);
  });

  it('converts void success to Some(undefined)', () => {
    const result = Result.ok();
    const maybe = resultToMaybe(result);
    expect(maybe.hasValue).toBe(true);
    if (maybe.hasValue) expect(maybe.value).toBeUndefined();
  });

  it('converts success with object to Some', () => {
    const obj = { a: 1 };
    const maybe = resultToMaybe(Result.success(obj));
    expect(maybe.hasValue).toBe(true);
    if (maybe.hasValue) expect(maybe.value).toBe(obj);
  });

  it('converts success with false to Some(false)', () => {
    const maybe = resultToMaybe(Result.success(false));
    expect(maybe.hasValue).toBe(true);
    if (maybe.hasValue) expect(maybe.value).toBe(false);
  });

  it('converts success with zero to Some(0)', () => {
    const maybe = resultToMaybe(Result.success(0));
    expect(maybe.hasValue).toBe(true);
    if (maybe.hasValue) expect(maybe.value).toBe(0);
  });

  it('converts success with empty string to Some("")', () => {
    const maybe = resultToMaybe(Result.success(''));
    expect(maybe.hasValue).toBe(true);
    if (maybe.hasValue) expect(maybe.value).toBe('');
  });

  it('converts multiple-error failure to None', () => {
    const result = Result.failureFrom([notFoundError, Err.validation('X', 'Y')]);
    const maybe = resultToMaybe(result);
    expect(maybe.hasValue).toBe(false);
  });

  it('round-trips: Result -> Maybe -> Result preserves success value', () => {
    const original = Result.success({ nested: 'value' });
    const maybe = resultToMaybe(original);
    const restored = maybeToResult(maybe, notFoundError);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value).toEqual({ nested: 'value' });
  });

  it('round-trips: Maybe -> Result -> Maybe preserves Some value', () => {
    const original = Maybe.some(99);
    const result = maybeToResult(original, notFoundError);
    const restored = resultToMaybe(result);
    expect(restored.hasValue).toBe(true);
    if (restored.hasValue) expect(restored.value).toBe(99);
  });

  it('round-trips: None -> Result -> Maybe preserves None', () => {
    const original = Maybe.none<string>();
    const result = maybeToResult(original, notFoundError);
    const restored = resultToMaybe(result);
    expect(restored.hasValue).toBe(false);
  });
});
