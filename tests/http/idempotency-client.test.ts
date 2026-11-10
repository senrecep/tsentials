import type { AppError } from '../../src/errors/app-error.js';
import { Err } from '../../src/errors/app-error.js';
import { ErrorMetadata } from '../../src/errors/error-metadata.js';
import { ErrorType } from '../../src/errors/error-type.js';
import {
  fetchResult,
  HttpErrorMetadataKeys,
  IdempotencyErrorCodes,
  idempotentRetryClassifier,
  parseRetryAfter,
  RequestBuilder,
  withIdempotencyKey,
} from '../../src/http/index.js';
import { ResiliencePolicy } from '../../src/resilience/index.js';

const errorWith = (meta: Record<string, unknown>, error = Err.failure('X', 'x')): AppError =>
  ({ ...error, metadata: ErrorMetadata.fromRecord(meta) }) as AppError;

function stubFetch(response: () => Response) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('3')).toBe(3_000);
    expect(parseRetryAfter(' 0 ')).toBe(0);
  });

  it('parses an HTTP-date relative to now, clamping the past to 0', () => {
    const now = Date.parse('Wed, 21 Oct 2026 07:28:00 GMT');
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:05 GMT', now)).toBe(5_000);
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:27:00 GMT', now)).toBe(0);
  });

  it.each([null, '', '-1', '1.5', 'soon', 'Wed, not a date'])(
    'returns undefined for %s',
    (value) => {
      expect(parseRetryAfter(value)).toBeUndefined();
    },
  );
});

describe('fetchResult failure metadata', () => {
  it('measures an HTTP-date Retry-After from the response Date header', async () => {
    const headers = {
      'retry-after': 'Wed, 21 Oct 2015 07:28:10 GMT',
      date: 'Wed, 21 Oct 2015 07:28:00 GMT',
    };
    stubFetch(() => new Response(null, { status: 503, headers }));
    const r = await fetchResult.get('/x');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.metadata?.get(HttpErrorMetadataKeys.RetryAfterMs)).toBe(10_000);
  });

  it('falls back to the local clock when the Date header is missing or invalid', async () => {
    const retryAfter = new Date(Date.now() + 60_000).toUTCString();
    for (const date of [undefined, 'not a date', '1']) {
      const headers: Record<string, string> = { 'retry-after': retryAfter };
      if (date !== undefined) headers['date'] = date;
      stubFetch(() => new Response(null, { status: 503, headers }));
      const r = await fetchResult.get('/x');
      if (r.ok) throw new Error('expected a failure');
      const ms = r.errors[0]?.metadata?.get(HttpErrorMetadataKeys.RetryAfterMs) as number;
      expect(ms).toBeGreaterThan(55_000);
      expect(ms).toBeLessThanOrEqual(60_000);
    }
  });

  it('adds status, replay flag, Retry-After and problem code to the first error', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            title: 'Busy',
            code: 'Idempotency.InFlight',
            errors: [
              { code: 'A', description: 'a' },
              { code: 'B', description: 'b' },
            ],
          }),
          {
            status: 409,
            headers: {
              'content-type': 'application/problem+json',
              'retry-after': '2',
              'idempotency-replayed': 'TRUE',
            },
          },
        ),
    );
    const r = await fetchResult.get('/x');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const first = r.errors[0];
    expect(first?.metadata?.get(HttpErrorMetadataKeys.HttpStatus)).toBe(409);
    expect(first?.metadata?.get(HttpErrorMetadataKeys.RetryAfterMs)).toBe(2_000);
    expect(first?.metadata?.get(HttpErrorMetadataKeys.IdempotencyReplayed)).toBe(true);
    expect(first?.metadata?.get(HttpErrorMetadataKeys.ProblemCode)).toBe('Idempotency.InFlight');
    expect(r.errors[1]?.metadata?.get(HttpErrorMetadataKeys.HttpStatus)).toBeUndefined();
    expect(Object.isFrozen(first)).toBe(true);
    expect(JSON.parse(JSON.stringify(first))).toMatchObject({ code: 'A' });
  });

  it('adds only the status when the response has nothing else', async () => {
    stubFetch(() => new Response('oops', { status: 500 }));
    const r = await fetchResult.get('/x');
    if (r.ok) throw new Error('expected failure');
    const meta = r.errors[0]?.metadata;
    expect(meta?.get(HttpErrorMetadataKeys.HttpStatus)).toBe(500);
    expect(meta?.has(HttpErrorMetadataKeys.RetryAfterMs)).toBe(false);
    expect(meta?.has(HttpErrorMetadataKeys.IdempotencyReplayed)).toBe(false);
    expect(meta?.has(HttpErrorMetadataKeys.ProblemCode)).toBe(false);
  });

  it('keeps metadata the problem body gave the error', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ title: 'Bad', code: 7 }), {
          status: 400,
          headers: { 'content-type': 'application/problem+json', 'retry-after': 'later' },
        }),
    );
    const r = await fetchResult.get('/x');
    if (r.ok) throw new Error('expected failure');
    const meta = r.errors[0]?.metadata;
    expect(meta?.get(HttpErrorMetadataKeys.HttpStatus)).toBe(400);
    expect(meta?.has(HttpErrorMetadataKeys.RetryAfterMs)).toBe(false);
    expect(meta?.has(HttpErrorMetadataKeys.ProblemCode)).toBe(false);
  });

  it('leaves a network error without status metadata', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network down');
    });
    const r = await fetchResult.get('/x');
    if (r.ok) throw new Error('expected failure');
    expect(r.errors[0]?.metadata?.get(HttpErrorMetadataKeys.HttpStatus)).toBeUndefined();
    expect(idempotentRetryClassifier('POST', true)(r.errors[0] as AppError)).toBe(true);
  });

  it('keeps the status on a 2xx body that cannot be parsed and never retries it', async () => {
    const fetchMock = stubFetch(
      () =>
        new Response('{not json', { status: 201, headers: { 'content-type': 'application/json' } }),
    );
    const r = await ResiliencePolicy.create<unknown>()
      .withRetry({ maxAttempts: 3, delay: 0, shouldRetry: idempotentRetryClassifier('POST', true) })
      .execute(() => RequestBuilder.post('/orders').json({}).idempotencyKey('k-1').send());
    if (r.ok) throw new Error('expected failure');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.errors[0]?.type).toBe(ErrorType.Validation);
    expect(r.errors[0]?.metadata?.get(HttpErrorMetadataKeys.HttpStatus)).toBe(201);
  });

  it('does not retry a 2xx body that cannot be parsed with the default classifier', async () => {
    const fetchMock = stubFetch(
      () =>
        new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const r = await ResiliencePolicy.create<unknown>()
      .withRetry({ maxAttempts: 3, delay: 0 })
      .execute(() => fetchResult.get('/orders/1'));
    expect(r.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('idempotentRetryClassifier', () => {
  const status = (s: number, extra: Record<string, unknown> = {}) =>
    errorWith({ httpStatus: s, ...extra });

  it.each(['POST', 'post', 'PATCH', 'TRACE', 'CONNECT', 'PROPFIND'])(
    'never retries %s without a key',
    (method) => {
      const classify = idempotentRetryClassifier(method, false);
      expect(classify(Err.unexpected())).toBe(false);
      expect(classify(status(503))).toBe(false);
      expect(classify(status(409, { problemCode: IdempotencyErrorCodes.InFlight }))).toBe(false);
    },
  );

  it('retries unanswered calls of safe methods and keyed POSTs', () => {
    expect(idempotentRetryClassifier('GET', false)(Err.unexpected())).toBe(true);
    expect(idempotentRetryClassifier('post', true)(Err.unexpected('Http.Timeout', 't'))).toBe(true);
    expect(idempotentRetryClassifier('PUT', false)(Err.failure('X', 'not unexpected'))).toBe(false);
  });

  it('never retries a replayed response', () => {
    expect(
      idempotentRetryClassifier('POST', true)(status(503, { idempotencyReplayed: true })),
    ).toBe(false);
  });

  it('retries 409 only for an in-flight key', () => {
    const classify = idempotentRetryClassifier('POST', true);
    expect(classify(status(409, { problemCode: 'Idempotency.InFlight' }))).toBe(true);
    expect(
      classify(errorWith({ httpStatus: 409 }, Err.conflict('Idempotency.InFlight', 'f'))),
    ).toBe(true);
    expect(classify(status(409))).toBe(false);
    expect(classify(status(409, { problemCode: 'Other' }))).toBe(false);
  });

  it('retries 503 Idempotency.ReservationLost (the key was released)', () => {
    const classify = idempotentRetryClassifier('POST', true);
    expect(classify(status(503, { problemCode: IdempotencyErrorCodes.ReservationLost }))).toBe(
      true,
    );
  });

  it('never retries 409 Idempotency.ResultUnavailable', () => {
    const classify = idempotentRetryClassifier('POST', true);
    expect(classify(status(409, { problemCode: IdempotencyErrorCodes.ResultUnavailable }))).toBe(
      false,
    );
    expect(
      classify(
        errorWith(
          { httpStatus: 409 },
          Err.conflict(IdempotencyErrorCodes.ResultUnavailable, 'unavailable'),
        ),
      ),
    ).toBe(false);
    expect(classify(Err.conflict(IdempotencyErrorCodes.ResultUnavailable, 'unavailable'))).toBe(
      false,
    );
  });

  it.each(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'get'])(
    'retries a safe %s without a key like the C# table',
    (method) => {
      const classify = idempotentRetryClassifier(method, false);
      for (const s of [408, 429, 500, 502, 503, 504]) expect(classify(status(s))).toBe(true);
      for (const s of [400, 404, 422]) expect(classify(status(s))).toBe(false);
      expect(classify(status(500, { idempotencyReplayed: true }))).toBe(false);
    },
  );

  it('retries 409 Idempotency.InFlight only when the request had a key', () => {
    const inFlight = status(409, { problemCode: IdempotencyErrorCodes.InFlight });
    expect(idempotentRetryClassifier('GET', false)(inFlight)).toBe(false);
    expect(idempotentRetryClassifier('PUT', false)(inFlight)).toBe(false);
    expect(idempotentRetryClassifier('PUT', true)(inFlight)).toBe(true);
  });

  it.each([
    [408, true],
    [429, true],
    [503, true],
    [504, true],
    [500, false],
    [502, false],
    [400, false],
    [422, false],
  ])('keyed POST status %i → %s', (s, expected) => {
    expect(idempotentRetryClassifier('POST', true)(status(s))).toBe(expected);
  });
});

describe('withIdempotencyKey', () => {
  it('adds the header to a copy and keeps the other headers', () => {
    const init = { method: 'POST', headers: { 'x-a': '1', 'Idempotency-Key': 'old' } };
    const next = withIdempotencyKey(init, 'k-1');
    const headers = new Headers(next.headers);
    expect(headers.get('idempotency-key')).toBe('k-1');
    expect(headers.get('x-a')).toBe('1');
    expect(next.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe('old');
  });

  it('generates a UUID by default', () => {
    const key = new Headers(withIdempotencyKey({} as RequestInit).headers).get('Idempotency-Key');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses an injected generator and validates its key like an explicit one', () => {
    const init = withIdempotencyKey({} as RequestInit, undefined, {
      idempotencyKeyGenerator: () => 'gen-1',
    });
    expect(new Headers(init.headers).get('idempotency-key')).toBe('gen-1');
    expect(() =>
      withIdempotencyKey({}, undefined, { idempotencyKeyGenerator: () => 'bad key' }),
    ).toThrow(TypeError);
    const generator = vi.fn(() => 'unused');
    withIdempotencyKey({}, 'explicit', { idempotencyKeyGenerator: generator });
    expect(generator).not.toHaveBeenCalled();
  });

  it('generates the key once for every retry of one operation', async () => {
    const mock = stubFetch(() => new Response(null, { status: 503 }));
    const generator = vi.fn(() => 'gen-key');
    const init = withIdempotencyKey({ method: 'POST' }, undefined, {
      idempotencyKeyGenerator: generator,
    });
    const result = await ResiliencePolicy.create()
      .withRetry({ maxAttempts: 2, delay: 0, shouldRetry: idempotentRetryClassifier('POST', true) })
      .execute((signal) => fetchResult.send('/orders', { ...init, signal }));
    expect(result.ok).toBe(false);
    expect(generator).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(3);
    expect(mock.mock.calls.map(([, i]) => new Headers(i?.headers).get('idempotency-key'))).toEqual([
      'gen-key',
      'gen-key',
      'gen-key',
    ]);
  });

  it('rejects an invalid key', () => {
    expect(() => withIdempotencyKey({}, 'has space')).toThrow(TypeError);
    expect(() => withIdempotencyKey({}, '')).toThrow(TypeError);
  });
});

describe('RequestBuilder.idempotencyKey', () => {
  const sentKeys = (mock: ReturnType<typeof stubFetch>) =>
    mock.mock.calls.map(([, init]) => new Headers(init?.headers).get('idempotency-key'));

  it('sends the same generated key on every send', async () => {
    const mock = stubFetch(
      () =>
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const builder = RequestBuilder.post('/orders').json({ a: 1 }).idempotencyKey();
    const key = builder.idempotencyKeyValue;
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    await builder.send();
    await builder.send();
    expect(sentKeys(mock)).toEqual([key, key]);
  });

  it('replaces an earlier key instead of appending', async () => {
    const mock = stubFetch(
      () =>
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const builder = RequestBuilder.put('/orders/1')
      .header('Idempotency-Key', 'manual')
      .idempotencyKey('first')
      .idempotencyKey('second');
    await builder.send();
    expect(sentKeys(mock)).toEqual(['second']);
    expect(builder.idempotencyKeyValue).toBe('second');
  });

  it('uses an injected generator once across retries', async () => {
    const mock = stubFetch(() => new Response(null, { status: 503 }));
    const generator = vi.fn(() => 'gen-key');
    const builder = RequestBuilder.post('/orders')
      .json({ a: 1 })
      .idempotencyKey(undefined, { idempotencyKeyGenerator: generator });
    await ResiliencePolicy.create()
      .withRetry({ maxAttempts: 2, delay: 0, shouldRetry: idempotentRetryClassifier('POST', true) })
      .execute((signal) => builder.signal(signal).send());
    expect(generator).toHaveBeenCalledTimes(1);
    expect(builder.idempotencyKeyValue).toBe('gen-key');
    expect(sentKeys(mock)).toEqual(['gen-key', 'gen-key', 'gen-key']);
  });

  it('rejects an invalid generated key like an explicit one', async () => {
    const mock = stubFetch(() => new Response(null, { status: 204 }));
    const builder = RequestBuilder.post('/x');
    expect(() =>
      builder.idempotencyKey(undefined, { idempotencyKeyGenerator: () => 'bad key' }),
    ).toThrow(TypeError);
    expect(builder.idempotencyKeyValue).toBeUndefined();
    builder.idempotencyKey('a');
    expect(() =>
      builder.idempotencyKey(undefined, { idempotencyKeyGenerator: () => 'bad key' }),
    ).toThrow(TypeError);
    expect(builder.idempotencyKeyValue).toBe('a');
    await builder.send();
    expect(sentKeys(mock)).toEqual(['a']);
  });

  it('is undefined until set and rejects an invalid key', () => {
    const builder = RequestBuilder.get('/x');
    expect(builder.idempotencyKeyValue).toBeUndefined();
    expect(() => builder.idempotencyKey('bad"key')).toThrow(TypeError);
  });
});
