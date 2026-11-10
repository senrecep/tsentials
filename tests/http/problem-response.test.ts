import { Err } from '../../src/errors/app-error.js';
import type { ErrorType } from '../../src/errors/error-type.js';
import {
  resultToResponse,
  rfc9110TypeUri,
  toProblemDetails,
  toProblemResponse,
} from '../../src/http/index.js';
import { problemDetailsToErrors } from '../../src/http/status-mapper.js';
import { Result } from '../../src/result/result.js';

const shape = (errors: readonly { code: string; description: string; type: ErrorType }[]) =>
  errors.map(({ code, description, type }) => ({ code, description, type }));

describe('toProblemDetails', () => {
  it('builds the body from one error', () => {
    expect(toProblemDetails([Err.notFound('User.NotFound', 'User 7 was not found.')])).toEqual({
      type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5',
      title: 'Not Found',
      status: 404,
      detail: 'User 7 was not found.',
      errorCodes: ['User.NotFound'],
    });
  });

  it('picks the error with the highest status, the first on a tie', () => {
    const body = toProblemDetails([
      Err.validation('A', 'a'),
      Err.conflict('B', 'b'),
      Err.notFound('C', 'c'),
      Err.conflict('D', 'd'),
    ]);
    expect(body).toMatchObject({ status: 409, title: 'Conflict', detail: 'b' });
  });

  it('writes distinct codes in order and validation errors as code/description', () => {
    const body = toProblemDetails([
      Err.validation('Name.Empty', 'Name is required.'),
      Err.notFound('User.NotFound', 'missing'),
      Err.validation('Name.Empty', 'Name is too short.'),
    ]);
    expect(body.errorCodes).toEqual(['Name.Empty', 'User.NotFound']);
    expect(body.errors).toEqual([
      { code: 'Name.Empty', description: 'Name is required.' },
      { code: 'Name.Empty', description: 'Name is too short.' },
    ]);
    expect(Object.keys(body)).toEqual([
      'type',
      'title',
      'status',
      'detail',
      'errorCodes',
      'errors',
    ]);
  });

  it('maps every error type to its title', () => {
    const titleOf = (e: Parameters<typeof toProblemDetails>[0][0]) => toProblemDetails([e]).title;
    expect(titleOf(Err.failure('X', 'x'))).toBe('Server Failure');
    expect(titleOf(Err.unexpected('X', 'x'))).toBe('Unexpected Error');
    expect(titleOf(Err.unknown('X', 'x'))).toBe('Unknown Error');
    expect(titleOf(Err.unauthorized('X', 'x'))).toBe('Unauthorized');
    expect(titleOf(Err.forbidden('X', 'x'))).toBe('Forbidden');
    expect(titleOf(Err.validation('X', 'x'))).toBe('Validation Error');
  });

  it('applies status, title, type and extensions options', () => {
    const error = Err.unexpected('Lost', 'lost');
    expect(toProblemDetails([error], { status: 503 })).toEqual({
      type: 'https://tools.ietf.org/html/rfc9110#section-15.6.4',
      title: 'Service Unavailable',
      status: 503,
      detail: 'lost',
      errorCodes: ['Lost'],
    });
    const body = toProblemDetails([error], {
      status: 503,
      title: 'Reservation lost',
      typeUri: () => undefined,
      extensions: { code: 'Lost', traceId: 't' },
    });
    expect(body).toEqual({
      title: 'Reservation lost',
      status: 503,
      detail: 'lost',
      code: 'Lost',
      traceId: 't',
      errorCodes: ['Lost'],
    });
  });

  it('uses the reason phrase as title for an overridden status, none when it has no phrase', () => {
    const error = Err.validation('Key.Reused', 'reused');
    expect(toProblemDetails([error], { status: 422 }).title).toBe('Unprocessable Entity');
    expect(toProblemDetails([error], { status: 400 }).title).toBe('Validation Error');
    expect(toProblemDetails([error], { status: 420 })).not.toHaveProperty('title');
  });

  it('throws for no errors', () => {
    expect(() => toProblemDetails([])).toThrow(TypeError);
  });
});

describe('rfc9110TypeUri', () => {
  it.each([
    [400, '15.5.1'],
    [417, '15.5.18'],
    [421, '15.5.20'],
    [422, '15.5.21'],
    [426, '15.5.22'],
    [500, '15.6.1'],
    [505, '15.6.6'],
  ])('maps %i to section %s', (status, section) => {
    expect(rfc9110TypeUri(status)).toBe(`https://tools.ietf.org/html/rfc9110#section-${section}`);
  });

  it.each([200, 399, 418, 420, 423, 499, 506])('has no link for %i', (status) => {
    expect(rfc9110TypeUri(status)).toBeUndefined();
  });
});

describe('round trip through problemDetailsToErrors', () => {
  it.each([
    ['one domain error', [Err.notFound('User.NotFound', 'User 7 was not found.')]],
    ['validation errors', [Err.validation('Name.Empty', 'a'), Err.validation('Age.Low', 'b')]],
    [
      'validation errors with the primary error',
      [Err.validation('Name.Empty', 'a'), Err.conflict('User.Exists', 'taken')],
    ],
    ['a server error', [Err.unexpected('Db.Down', 'database is down')]],
  ])('keeps %s', async (_, errors) => {
    const response = toProblemResponse(errors);
    expect(shape(problemDetailsToErrors(response.status, await response.json()))).toEqual(
      shape(errors),
    );
  });
});

describe('toProblemResponse', () => {
  it('sends the body as application/problem+json with extra headers', async () => {
    const response = toProblemResponse([Err.conflict('Busy', 'busy')], {
      headers: { 'retry-after': '3' },
    });
    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.headers.get('retry-after')).toBe('3');
    expect(await response.json()).toMatchObject({ status: 409, errorCodes: ['Busy'] });
  });
});

describe('resultToResponse', () => {
  it('sends a value as 200 JSON', async () => {
    const response = resultToResponse(Result.success({ id: 1 }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ id: 1 });
  });

  it('sends a void success as 204 without a body', async () => {
    const response = resultToResponse(Result.ok());
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('sends a failure as a problem response', async () => {
    const response = resultToResponse(Result.failure(Err.forbidden('No', 'no')), {
      extensions: { traceId: 't' },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toMatchObject({ detail: 'no', traceId: 't' });
  });
});
