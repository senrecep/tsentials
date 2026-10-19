import type { AppError } from '../../src/errors/app-error.js';
import { Err } from '../../src/errors/app-error.js';
import { ErrorMetadata } from '../../src/errors/error-metadata.js';
import {
  fetchResult,
  HttpErrorMetadataKeys,
  idempotentRetryClassifier,
  parseRetryAfter,
  RequestBuilder,
  withIdempotencyKey,
} from '../../src/http/index.js';

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

  it.each([
    null,
    '',
    '-1',
    '1.5',
    'soon',
    'Wed, not a date',
  ])('returns undefined for %s', (value) => {
    expect(parseRetryAfter(value)).toBeUndefined();
  });
});

describe('fetchResult failure metadata', () => {
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
});

describe('idempotentRetryClassifier', () => {
  const status = (s: number, extra: Record<string, unknown> = {}) =>
    errorWith({ httpStatus: s, ...extra });

  it('never retries POST or PATCH without a key', () => {
    for (const method of ['POST', 'post', 'PATCH']) {
      const classify = idempotentRetryClassifier(method, false);
      expect(classify(Err.unexpected())).toBe(false);
      expect(classify(status(503))).toBe(false);
    }
  });

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

  it.each([
    [408, true],
    [429, true],
    [503, true],
    [504, true],
    [500, false],
    [502, false],
    [400, false],
    [422, false],
  ])('status %i → %s', (s, expected) => {
    expect(idempotentRetryClassifier('DELETE', false)(status(s))).toBe(expected);
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
    const key = new Headers(withIdempotencyKey({}).headers).get('Idempotency-Key');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
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

  it('is undefined until set and rejects an invalid key', () => {
    const builder = RequestBuilder.get('/x');
    expect(builder.idempotencyKeyValue).toBeUndefined();
    expect(() => builder.idempotencyKey('bad"key')).toThrow(TypeError);
  });
});
