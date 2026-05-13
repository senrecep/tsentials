import { ErrorType } from '../../src/errors/error-type.js';
import { extractErrorDescription, httpStatusToError } from '../../src/http/status-mapper.js';

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
