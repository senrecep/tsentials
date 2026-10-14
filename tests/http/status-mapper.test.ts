import { ErrorType } from '../../src/errors/error-type.js';
import {
  extractErrorDescription,
  httpStatusToError,
  httpStatusToErrorType,
  problemDetailsToErrors,
} from '../../src/http/status-mapper.js';

describe('httpStatusToError', () => {
  it('maps 400 to Validation', () => {
    const err = httpStatusToError(400);
    expect(err.type).toBe(ErrorType.Validation);
    expect(err.code).toBe('Http.400');
  });

  it('maps 401 to Unauthorized', () => {
    const err = httpStatusToError(401);
    expect(err.type).toBe(ErrorType.Unauthorized);
    expect(err.code).toBe('Http.401');
  });

  it('maps 403 to Forbidden', () => {
    const err = httpStatusToError(403);
    expect(err.type).toBe(ErrorType.Forbidden);
    expect(err.code).toBe('Http.403');
  });

  it('maps 404 to NotFound', () => {
    const err = httpStatusToError(404);
    expect(err.type).toBe(ErrorType.NotFound);
    expect(err.code).toBe('Http.404');
  });

  it('maps 409 to Conflict', () => {
    const err = httpStatusToError(409);
    expect(err.type).toBe(ErrorType.Conflict);
    expect(err.code).toBe('Http.409');
  });

  it('maps 410 to NotFound', () => {
    const err = httpStatusToError(410);
    expect(err.type).toBe(ErrorType.NotFound);
    expect(err.code).toBe('Http.410');
  });

  it('maps 422 to Validation', () => {
    const err = httpStatusToError(422);
    expect(err.type).toBe(ErrorType.Validation);
    expect(err.code).toBe('Http.422');
  });

  it('maps 429 to Conflict', () => {
    const err = httpStatusToError(429);
    expect(err.type).toBe(ErrorType.Conflict);
    expect(err.code).toBe('Http.429');
  });

  it('maps 500 to Unexpected', () => {
    const err = httpStatusToError(500);
    expect(err.type).toBe(ErrorType.Unexpected);
    expect(err.code).toBe('Http.500');
  });

  it('maps 502 to Unexpected', () => {
    const err = httpStatusToError(502);
    expect(err.type).toBe(ErrorType.Unexpected);
    expect(err.code).toBe('Http.502');
  });

  it('maps 503 to Unexpected', () => {
    const err = httpStatusToError(503);
    expect(err.type).toBe(ErrorType.Unexpected);
    expect(err.code).toBe('Http.503');
  });

  it('maps unknown 4xx to Failure', () => {
    const err = httpStatusToError(418);
    expect(err.type).toBe(ErrorType.Failure);
    expect(err.code).toBe('Http.418');
  });

  it('maps unknown 3xx to Failure', () => {
    const err = httpStatusToError(301);
    expect(err.type).toBe(ErrorType.Failure);
    expect(err.code).toBe('Http.301');
  });

  it('maps 599 to Unexpected', () => {
    const err = httpStatusToError(599);
    expect(err.type).toBe(ErrorType.Unexpected);
    expect(err.code).toBe('Http.599');
  });

  it('uses custom description when provided', () => {
    const err = httpStatusToError(404, 'User not found');
    expect(err.description).toBe('User not found');
  });

  it('uses default description when not provided', () => {
    const err = httpStatusToError(404);
    expect(err.description).toBe('HTTP request failed with status 404.');
  });

  it('returns frozen error', () => {
    const err = httpStatusToError(400);
    expect(Object.isFrozen(err)).toBe(true);
  });
});

describe('extractErrorDescription', () => {
  it('returns detail from problem+json response', async () => {
    const response = new Response(JSON.stringify({ detail: 'Email is invalid' }), {
      status: 422,
      headers: { 'content-type': 'application/problem+json' },
    });
    const desc = await extractErrorDescription(response);
    expect(desc).toBe('Email is invalid');
  });

  it('returns title when detail is missing', async () => {
    const response = new Response(JSON.stringify({ title: 'Bad Request' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
    const desc = await extractErrorDescription(response);
    expect(desc).toBe('Bad Request');
  });

  it('prefers detail over title', async () => {
    const response = new Response(
      JSON.stringify({ detail: 'Specific error', title: 'General error' }),
      {
        status: 400,
        headers: { 'content-type': 'application/json' },
      },
    );
    const desc = await extractErrorDescription(response);
    expect(desc).toBe('Specific error');
  });

  it('returns undefined for non-JSON content-type', async () => {
    const response = new Response(' plain text error ', {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    });
    const desc = await extractErrorDescription(response);
    expect(desc).toBeUndefined();
  });

  it('returns undefined when content-type header is missing', async () => {
    const response = new Response('error', { status: 500 });
    const desc = await extractErrorDescription(response);
    expect(desc).toBeUndefined();
  });

  it('returns undefined when JSON body has no detail or title', async () => {
    const response = new Response(JSON.stringify({ code: 'ERR_001' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
    const desc = await extractErrorDescription(response);
    expect(desc).toBeUndefined();
  });

  it('returns undefined when JSON body is not an object', async () => {
    const response = new Response(JSON.stringify('just a string'), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
    const desc = await extractErrorDescription(response);
    expect(desc).toBeUndefined();
  });

  it('returns undefined when body is invalid JSON', async () => {
    const response = new Response('{invalid json}', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
    const desc = await extractErrorDescription(response);
    expect(desc).toBeUndefined();
  });

  it('returns undefined for empty body', async () => {
    const response = new Response(null, {
      status: 204,
      headers: { 'content-type': 'application/json' },
    });
    const desc = await extractErrorDescription(response);
    expect(desc).toBeUndefined();
  });

  it('handles detail that is not a string (returns undefined)', async () => {
    const response = new Response(JSON.stringify({ detail: 123 }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
    const desc = await extractErrorDescription(response);
    expect(desc).toBeUndefined();
  });

  it('handles title that is not a string (returns undefined)', async () => {
    const response = new Response(JSON.stringify({ title: true }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
    const desc = await extractErrorDescription(response);
    expect(desc).toBeUndefined();
  });
});

describe('httpStatusToErrorType — full status table', () => {
  it.each([
    [400, ErrorType.Validation],
    [411, ErrorType.Validation],
    [413, ErrorType.Validation],
    [414, ErrorType.Validation],
    [415, ErrorType.Validation],
    [416, ErrorType.Validation],
    [417, ErrorType.Validation],
    [422, ErrorType.Validation],
    [401, ErrorType.Unauthorized],
    [407, ErrorType.Unauthorized],
    [402, ErrorType.Failure],
    [405, ErrorType.Failure],
    [406, ErrorType.Failure],
    [403, ErrorType.Forbidden],
    [404, ErrorType.NotFound],
    [410, ErrorType.NotFound],
    [408, ErrorType.Unexpected],
    [409, ErrorType.Conflict],
    [412, ErrorType.Conflict],
    [429, ErrorType.Conflict],
    [418, ErrorType.Failure],
    [451, ErrorType.Failure],
    [500, ErrorType.Unexpected],
    [504, ErrorType.Unexpected],
    [200, ErrorType.Failure],
    [302, ErrorType.Failure],
    [100, ErrorType.Failure],
  ])('%i → %s', (status, type) => {
    expect(httpStatusToErrorType(status)).toBe(type);
    const err = httpStatusToError(status);
    expect(err.type).toBe(type);
    expect(err.code).toBe(`Http.${status}`);
  });
});

describe('problemDetailsToErrors', () => {
  it('parses the list shape [{ code, description }] with the status type', () => {
    const errors = problemDetailsToErrors(400, {
      title: 'Bad Request',
      errors: [
        { code: 'User.Email', description: 'Email is invalid' },
        { code: 'User.Name', description: 'Name is required' },
      ],
    });
    expect(errors).toEqual([
      {
        code: 'User.Email',
        description: 'Email is invalid',
        type: ErrorType.Validation,
        metadata: undefined,
      },
      {
        code: 'User.Name',
        description: 'Name is required',
        type: ErrorType.Validation,
        metadata: undefined,
      },
    ]);
  });

  it('parses the AllErrors shape using type, numericType and metadata', () => {
    const errors = problemDetailsToErrors(400, {
      errors: [
        { code: 'A', description: 'by name', type: 'Conflict', numericType: 3 },
        { code: 'B', description: 'by ordinal', numericType: 4 },
        { code: 'C', description: 'numeric type field', type: 5 },
        { code: 'D', description: 'with meta', type: 'Forbidden', metadata: { field: 'x', n: 1 } },
        { code: 'E', description: 'invalid type falls back', type: 'Nope', numericType: 99 },
      ],
    });
    expect(errors.map((e) => [e.code, e.type])).toEqual([
      ['A', ErrorType.Conflict],
      ['B', ErrorType.NotFound],
      ['C', ErrorType.Unauthorized],
      ['D', ErrorType.Forbidden],
      ['E', ErrorType.Validation],
    ]);
    const d = errors[3]!;
    expect(d.metadata).toBeInstanceOf(Map);
    expect(Object.fromEntries(d.metadata!)).toEqual({ field: 'x', n: 1 });
    expect(errors[0]!.metadata).toBeUndefined();
  });

  it('parses the dictionary validation-problem shape { key: string[] }', () => {
    const errors = problemDetailsToErrors(422, {
      errors: { Email: ['Required', 'Invalid format'], Name: 'Too short' },
    });
    expect(errors.map((e) => [e.code, e.description, e.type])).toEqual([
      ['Email', 'Required', ErrorType.Validation],
      ['Email', 'Invalid format', ErrorType.Validation],
      ['Name', 'Too short', ErrorType.Validation],
    ]);
  });

  it('maps plain-string list items to Http.{status} Validation errors', () => {
    const errors = problemDetailsToErrors(409, { errors: ['Already exists'] });
    expect(errors).toEqual([
      {
        code: 'Http.409',
        description: 'Already exists',
        type: ErrorType.Validation,
        metadata: undefined,
      },
    ]);
  });

  it('untyped entries are Validation regardless of the status', () => {
    const list = problemDetailsToErrors(404, {
      errors: [
        { code: 'A', description: 'no type' },
        { code: 'B', description: 'bad type', type: 'Bogus' },
        { code: 'C', description: 'typed', type: 'NotFound' },
      ],
    });
    expect(list.map((e) => [e.code, e.type])).toEqual([
      ['A', ErrorType.Validation],
      ['B', ErrorType.Validation],
      ['C', ErrorType.NotFound],
    ]);
    const dict = problemDetailsToErrors(409, { errors: { Name: ['Required'] } });
    expect(dict.map((e) => [e.code, e.type])).toEqual([['Name', ErrorType.Validation]]);
  });

  it('without parsable errors the status error keeps the status type', () => {
    const [err] = problemDetailsToErrors(409, { title: 'Conflict!' });
    expect(err?.type).toBe(ErrorType.Conflict);
  });

  it('skips malformed entries but keeps valid ones', () => {
    const errors = problemDetailsToErrors(400, {
      errors: [
        null,
        42,
        { code: 'X' },
        { description: 'no code' },
        { code: 'OK', description: 'kept' },
      ],
    });
    expect(errors.map((e) => e.code)).toEqual(['OK']);
  });

  it('falls back to the status error using detail, then title', () => {
    expect(problemDetailsToErrors(404, { title: 'Not Found', detail: 'User 42 missing' })).toEqual([
      httpStatusToError(404, 'User 42 missing'),
    ]);
    expect(problemDetailsToErrors(404, { title: 'Not Found' })).toEqual([
      httpStatusToError(404, 'Not Found'),
    ]);
  });

  it.each([
    ['no body', undefined],
    ['non-object body', 'oops'],
    ['array body', [1, 2]],
    ['empty errors list', { errors: [] }],
    ['empty errors dictionary', { errors: {} }],
    ['only malformed entries', { errors: [{ foo: 1 }] }],
    ['non-string dictionary values', { errors: { Email: [1, 2] } }],
  ])('falls back to the single status error for %s', (_label, body) => {
    expect(problemDetailsToErrors(500, body)).toEqual([httpStatusToError(500)]);
  });
});
