import { Err } from '../../src/errors/app-error.js';
import type { DomainError } from '../../src/errors/domain-error.js';
import { ErrorMetadata } from '../../src/errors/error-metadata.js';
import { ErrorType } from '../../src/errors/error-type.js';
import { Result, ResultUnwrapError } from '../../src/result/result.js';
import { ResultAsync } from '../../src/result/result-async.js';
import { chain } from '../../src/result/result-chain.js';

const inputErr = Err.validation('Input.Bad', 'bad input');
const checkErr = Err.conflict('Check.Failed', 'check failed');
const okCheck = (): Result<string> => Result.success('ignored');
const failCheck = (): Result<string> => Result.failure(checkErr);

describe('Result.thenEnsure', () => {
  it('returns the original result when the validator succeeds', () => {
    const r = Result.success(5);
    expect(Result.thenEnsure(r, okCheck)).toBe(r);
  });

  it('returns the validator errors when it fails', () => {
    expect(Result.thenEnsure(Result.success(5), failCheck)).toEqual({
      ok: false,
      errors: [checkErr],
    });
  });

  it('skips the validator on failure', () => {
    const r = Result.failure<number>(inputErr);
    const validator = vi.fn(okCheck);
    expect(Result.thenEnsure(r, validator)).toBe(r);
    expect(validator).not.toHaveBeenCalled();
  });

  it('passes the value and accepts a void validator', () => {
    const r = Result.thenEnsure(Result.success(3), (n) =>
      n > 2 ? Result.ok() : Result.failure(checkErr),
    );
    expect(r).toEqual({ ok: true, value: 3 });
  });
});

describe('Result.thenEnsureAsync', () => {
  it('keeps the value, returns errors, and skips on failure', async () => {
    const r = Result.success(1);
    expect(await Result.thenEnsureAsync(r, async () => okCheck())).toBe(r);
    expect(await Result.thenEnsureAsync(r, async () => failCheck())).toEqual({
      ok: false,
      errors: [checkErr],
    });
    const failed = Result.failure<number>(inputErr);
    expect(await Result.thenEnsureAsync(failed, async () => okCheck())).toBe(failed);
  });
});

describe('ResultChain.thenEnsure / thenEnsureAsync', () => {
  it('validates in a fluent chain', async () => {
    expect(chain(Result.success(2)).thenEnsure(okCheck).unwrap()).toEqual({ ok: true, value: 2 });
    expect(chain(Result.success(2)).thenEnsure(failCheck).unwrap().ok).toBe(false);
    expect(await chain(Result.success(2)).thenEnsureAsync(async () => failCheck())).toEqual({
      ok: false,
      errors: [checkErr],
    });
  });
});

describe('ResultAsync.thenEnsure', () => {
  it('accepts sync, promise and ResultAsync validators', async () => {
    const src = () => ResultAsync.fromResult(Result.success(7));
    expect(await src().thenEnsure(okCheck)).toEqual({ ok: true, value: 7 });
    expect(await src().thenEnsure(async () => failCheck())).toEqual({
      ok: false,
      errors: [checkErr],
    });
    expect(await src().thenEnsure(() => ResultAsync.fromResult(failCheck()))).toEqual({
      ok: false,
      errors: [checkErr],
    });
  });

  it('skips the validator on failure', async () => {
    const validator = vi.fn(okCheck);
    const r = await ResultAsync.fromResult(Result.failure<number>(inputErr)).thenEnsure(validator);
    expect(r).toEqual({ ok: false, errors: [inputErr] });
    expect(validator).not.toHaveBeenCalled();
  });
});

describe('unwrapOrThrow', () => {
  it('returns the value on success', async () => {
    expect(Result.unwrapOrThrow(Result.success(1), 'never')).toBe(1);
    expect(chain(Result.success(2)).unwrapOrThrow()).toBe(2);
    expect(await ResultAsync.fromResult(Result.success(3)).unwrapOrThrow('never')).toBe(3);
  });

  it('throws ResultUnwrapError with the given message and the errors', () => {
    const r = Result.failure<number>(inputErr);
    expect(() => Result.unwrapOrThrow(r, 'Config must load')).toThrow('Config must load');
    try {
      chain(r).unwrapOrThrow('Config must load');
    } catch (e) {
      expect(e).toBeInstanceOf(ResultUnwrapError);
      expect((e as DomainError).errors).toEqual([inputErr]);
    }
    expect.assertions(3);
  });

  it('keeps the default unwrap message without an argument', () => {
    expect(() => Result.unwrapOrThrow(Result.failure(inputErr))).toThrow(
      'Cannot unwrap a failed Result. Errors: Input.Bad',
    );
  });

  it('throws a given Error as-is', async () => {
    const custom = new RangeError('custom');
    const r = Result.failure<number>(inputErr);
    expect(() => Result.unwrapOrThrow(r, custom)).toThrow(custom);
    await expect(ResultAsync.fromResult(r).unwrapOrThrow(custom)).rejects.toBe(custom);
  });

  it('round-trips the errors through Result.try', () => {
    const r = Result.failure<number>(inputErr);
    expect(Result.try(() => Result.unwrapOrThrow(r, 'msg'))).toEqual({
      ok: false,
      errors: [inputErr],
    });
  });
});

describe('Err.fromException overrides', () => {
  it('replaces code and description with an override object', () => {
    const e = Err.fromException(new TypeError('raw'), ErrorType.Unexpected, {
      code: 'Db.Down',
      description: 'Database is unreachable',
    });
    expect(e.code).toBe('Db.Down');
    expect(e.description).toBe('Database is unreachable');
    expect(e.type).toBe(ErrorType.Unexpected);
    expect(e.metadata?.get('exceptionMessage')).toBe('raw');
  });

  it('falls back to the exception when override fields are absent', () => {
    const e = Err.fromException(new TypeError('raw'), ErrorType.Failure, { description: 'd' });
    expect(e.code).toBe('TypeError');
    expect(e.description).toBe('d');
    expect(Err.fromException(new TypeError('raw'), ErrorType.Failure, {}).description).toBe('raw');
  });

  it('treats a null code from untyped callers like a missing code', () => {
    const e = Err.fromException(new TypeError('raw'), ErrorType.Failure, null as unknown as string);
    expect(e.code).toBe('TypeError');
    expect(e.description).toBe('raw');
  });
});

describe('ErrorMetadata.withStackTrace', () => {
  it('captures the current stack under stackTrace', () => {
    const meta = ErrorMetadata.withStackTrace();
    expect([...meta.keys()]).toEqual(['stackTrace']);
    expect(meta.get('stackTrace')).toEqual(expect.stringContaining('result-conveniences.test'));
  });
});
