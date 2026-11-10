import { DomainError, Err } from '../../src/errors/index.js';
import { Result, ResultUnwrapError } from '../../src/result/index.js';

const conflict = Err.conflict('Order.Shipped', 'Order is already shipped');
const notFound = Err.notFound('Order.NotFound', 'Order not found');

describe('DomainError', () => {
  it('carries one error and uses its description as message', () => {
    const e = new DomainError(conflict);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('DomainError');
    expect(e.message).toBe('Order is already shipped');
    expect(e.error).toBe(conflict);
    expect(e.errors).toEqual([conflict]);
  });

  it('carries several errors and accepts a message override', () => {
    const input = [conflict, notFound];
    const e = new DomainError(input, 'custom');
    input.pop();
    expect(e.message).toBe('custom');
    expect(e.errors).toEqual([conflict, notFound]);
    expect(Object.isFrozen(e.errors)).toBe(true);
  });

  it('falls back to a default message without errors', () => {
    const e = new DomainError([]);
    expect(e.message).toBe('A domain error has occurred.');
    expect(e.error).toBeUndefined();
  });

  it('ResultUnwrapError is a DomainError', () => {
    expect(new ResultUnwrapError([conflict])).toBeInstanceOf(DomainError);
  });
});

describe('Result.try family with DomainError', () => {
  const throwIt = (): never => {
    throw new DomainError([conflict, notFound]);
  };

  it('try returns the carried errors as-is', () => {
    expect(Result.try(throwIt)).toEqual({ ok: false, errors: [conflict, notFound] });
  });

  it('try keeps carried errors even with onError', () => {
    expect(Result.try(throwIt, () => Err.unexpected())).toEqual({
      ok: false,
      errors: [conflict, notFound],
    });
  });

  it('try still uses onError and fromException for other errors', () => {
    const boom = (): never => {
      throw new TypeError('boom');
    };
    expect(Result.firstError(Result.try(boom)).code).toBe('TypeError');
    expect(Result.firstError(Result.try(boom, () => notFound))).toBe(notFound);
  });

  it('try converts a DomainError without errors like any other error', () => {
    const r = Result.try(() => {
      throw new DomainError([]);
    });
    expect(Result.firstError(r).code).toBe('DomainError');
  });

  it('try keeps the typed errors of an unwrapped failure', () => {
    const r = Result.try(() => Result.unwrap(Result.failure(conflict)));
    expect(r).toEqual({ ok: false, errors: [conflict] });
  });

  it('tryAsync returns the carried errors as-is, with or without onError', async () => {
    const fn = async () => throwIt();
    expect(await Result.tryAsync(fn)).toEqual({ ok: false, errors: [conflict, notFound] });
    expect(await Result.tryAsync(fn, () => Err.unexpected())).toEqual({
      ok: false,
      errors: [conflict, notFound],
    });
  });

  it('tryAsync still propagates the caller abort', async () => {
    const ac = new AbortController();
    const reason = new Error('stop');
    ac.abort(reason);
    await expect(Result.tryAsync(async () => throwIt(), { signal: ac.signal })).rejects.toBe(
      reason,
    );
  });

  it('tryCatch and tryCatchAsync return the carried errors as-is', async () => {
    const ok = Result.success(1);
    expect(Result.tryCatch(ok, throwIt)).toEqual({ ok: false, errors: [conflict, notFound] });
    expect(Result.tryCatch(ok, throwIt, Err.unexpected())).toEqual({
      ok: false,
      errors: [conflict, notFound],
    });
    expect(
      await Result.tryCatchAsync(
        ok,
        async () => throwIt(),
        () => Err.unexpected(),
      ),
    ).toEqual({ ok: false, errors: [conflict, notFound] });
  });
});
