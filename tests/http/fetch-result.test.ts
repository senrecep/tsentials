import { ErrorType } from '../../src/errors/error-type.js';
import { fetchResult } from '../../src/http/fetch-result.js';

function createMockResponse(init: {
  ok: boolean;
  status: number;
  body?: string;
  contentType?: string;
  json?: unknown;
}): Response {
  const headers = new Headers();
  const hasJson = init.json !== undefined;
  const contentType = init.contentType ?? (hasJson ? 'application/json' : undefined);
  if (contentType) headers.set('content-type', contentType);

  if (init.status === 204) {
    return new Response(null, { status: 204, headers });
  }

  const body = hasJson ? JSON.stringify(init.json) : (init.body ?? '');

  return new Response(body, {
    status: init.status,
    headers,
  });
}

describe('fetchResult.get', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success on 200 with JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: true, status: 200, json: { id: 1 } }))),
    );
    const result = await fetchResult.get<{ id: number }>('https://api.example.com/user');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ id: 1 });
  });

  it('returns success on 204 (no content)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: true, status: 204 }))),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/empty');
    expect(result.ok).toBe(true);
  });

  it('returns success when content-type is missing (non-JSON treated as void)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 200 }))),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/plain');
    expect(result.ok).toBe(true);
  });

  it('returns success with application/problem+json body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          createMockResponse({
            ok: true,
            status: 200,
            contentType: 'application/problem+json',
            json: { type: 'about:blank' },
          }),
        ),
      ),
    );
    const result = await fetchResult.get<{ type: string }>('https://api.example.com/problem');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ type: 'about:blank' });
  });

  it('returns failure on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          createMockResponse({ ok: false, status: 404, json: { detail: 'Not found' } }),
        ),
      ),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/missing');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.type).toBe(ErrorType.NotFound);
      expect(result.errors[0]!.description).toBe('Not found');
    }
  });

  it('returns failure on 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          createMockResponse({ ok: false, status: 500, json: { title: 'Server Error' } }),
        ),
      ),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/broken');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.type).toBe(ErrorType.Unexpected);
      expect(result.errors[0]!.description).toBe('Server Error');
    }
  });

  it('returns failure on 400 with validation type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          createMockResponse({ ok: false, status: 400, json: { detail: 'Bad input' } }),
        ),
      ),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/bad');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.type).toBe(ErrorType.Validation);
  });

  it('returns failure on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: false, status: 401 }))),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/protected');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.type).toBe(ErrorType.Unauthorized);
  });

  it('returns failure on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: false, status: 403 }))),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/forbidden');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.type).toBe(ErrorType.Forbidden);
  });

  it('returns failure on 409', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: false, status: 409 }))),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/conflict');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.type).toBe(ErrorType.Conflict);
  });

  it('returns failure on 422', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: false, status: 422 }))),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/unprocessable');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.type).toBe(ErrorType.Validation);
  });

  it('returns failure on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: false, status: 429 }))),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/rate-limit');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.type).toBe(ErrorType.Conflict);
  });

  it('returns failure on 418 (unknown 4xx maps to Failure)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: false, status: 418 }))),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/teapot');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.type).toBe(ErrorType.Failure);
  });

  it('returns failure on network error (TypeError)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/offline');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('TypeError');
  });

  it('passes RequestInit options through', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(createMockResponse({ ok: true, status: 200, json: {} })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await fetchResult.get('https://api.example.com/user', { headers: { 'X-Custom': '1' } });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/user',
      expect.objectContaining({ method: 'GET', headers: { 'X-Custom': '1' } }),
    );
  });

  it('accepts URL object', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(createMockResponse({ ok: true, status: 200, json: {} })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await fetchResult.get(new URL('https://api.example.com/user'));
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uses default description when response has no JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('', { status: 404, headers: { 'content-type': 'text/plain' } }),
        ),
      ),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/missing');
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors[0]!.description).toBe('HTTP request failed with status 404.');
  });

  it('catches JSON parse error in success response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('{invalid json}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/bad-json');
    expect(result.ok).toBe(false);
  });
});

describe('fetchResult.post', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success on 201 with JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: true, status: 201, json: { id: 2 } }))),
    );
    const result = await fetchResult.post<{ id: number }>('https://api.example.com/user', {
      name: 'Alice',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ id: 2 });
  });

  it('sends JSON body with correct content-type', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(createMockResponse({ ok: true, status: 200, json: {} })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await fetchResult.post('https://api.example.com/user', { name: 'Alice' });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/user',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Alice' }) }),
    );
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('merges custom headers', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(createMockResponse({ ok: true, status: 200, json: {} })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await fetchResult.post(
      'https://api.example.com/user',
      {},
      { headers: { 'X-Api-Key': 'secret' } },
    );
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-api-key')).toBe('secret');
  });

  it('returns failure on 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: false, status: 400 }))),
    );
    const result = await fetchResult.post<unknown>('https://api.example.com/user', {});
    expect(result.ok).toBe(false);
  });

  it('returns failure on network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Network down'))),
    );
    const result = await fetchResult.post<unknown>('https://api.example.com/user', {});
    expect(result.ok).toBe(false);
  });

  it('handles null body', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(createMockResponse({ ok: true, status: 200, json: {} })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await fetchResult.post('https://api.example.com/user', null);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/user',
      expect.objectContaining({
        body: 'null',
      }),
    );
  });
});

describe('fetchResult.put', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(createMockResponse({ ok: true, status: 200, json: { updated: true } })),
      ),
    );
    const result = await fetchResult.put<{ updated: boolean }>('https://api.example.com/user/1', {
      name: 'Bob',
    });
    expect(result.ok).toBe(true);
  });

  it('sends PUT method', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(createMockResponse({ ok: true, status: 200, json: {} })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await fetchResult.put('https://api.example.com/user/1', {});
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/user/1',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('returns failure on 409', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: false, status: 409 }))),
    );
    const result = await fetchResult.put<unknown>('https://api.example.com/user/1', {});
    expect(result.ok).toBe(false);
  });

  it('returns failure on network error (TypeError)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );
    const result = await fetchResult.put('https://api.example.com/user/1', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('TypeError');
  });
});

describe('fetchResult.patch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(createMockResponse({ ok: true, status: 200, json: { patched: true } })),
      ),
    );
    const result = await fetchResult.patch<{ patched: boolean }>('https://api.example.com/user/1', {
      name: 'Charlie',
    });
    expect(result.ok).toBe(true);
  });

  it('sends PATCH method', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(createMockResponse({ ok: true, status: 200, json: {} })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await fetchResult.patch('https://api.example.com/user/1', {});
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/user/1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('returns failure on 422', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: false, status: 422 }))),
    );
    const result = await fetchResult.patch<unknown>('https://api.example.com/user/1', {});
    expect(result.ok).toBe(false);
  });

  it('returns failure on network error (TypeError)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );
    const result = await fetchResult.patch('https://api.example.com/user/1', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('TypeError');
  });
});

describe('fetchResult.delete', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success on 204', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: true, status: 204 }))),
    );
    const result = await fetchResult.delete('https://api.example.com/user/1');
    expect(result.ok).toBe(true);
  });

  it('returns success on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: true, status: 200 }))),
    );
    const result = await fetchResult.delete('https://api.example.com/user/1');
    expect(result.ok).toBe(true);
  });

  it('sends DELETE method', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(createMockResponse({ ok: true, status: 204 })));
    vi.stubGlobal('fetch', fetchSpy);
    await fetchResult.delete('https://api.example.com/user/1');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/user/1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('returns failure on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: false, status: 404 }))),
    );
    const result = await fetchResult.delete('https://api.example.com/user/999');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.type).toBe(ErrorType.NotFound);
  });

  it('returns failure on 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: false, status: 500 }))),
    );
    const result = await fetchResult.delete('https://api.example.com/user/1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.type).toBe(ErrorType.Unexpected);
  });

  it('returns failure on network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('net::ERR_CONNECTION_REFUSED'))),
    );
    const result = await fetchResult.delete('https://api.example.com/user/1');
    expect(result.ok).toBe(false);
  });

  it('returns failure on unknown object thrown from delete', async () => {
    // internal __resultError path
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: false, status: 418 }))),
    );
    const result = await fetchResult.delete('https://api.example.com/user/1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.type).toBe(ErrorType.Failure);
  });
});

describe('fetchResult.send', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends init as-is without forcing JSON encoding', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(createMockResponse({ ok: true, status: 200, json: {} })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await fetchResult.send('https://api.example.com/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'raw text',
    });
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'raw text',
      signal: expect.any(AbortSignal),
    });
  });

  it('returns success on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: true, status: 200, json: { id: 1 } }))),
    );
    const result = await fetchResult.send<{ id: number }>('https://api.example.com/user', {
      method: 'POST',
      body: 'raw',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ id: 1 });
  });

  it('returns failure on 4xx without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createMockResponse({ ok: false, status: 400 }))),
    );
    const result = await fetchResult.send('https://api.example.com/upload', {
      method: 'POST',
      body: 'not json',
    });
    expect(result.ok).toBe(false);
  });

  it('returns failure on network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );
    const result = await fetchResult.send('https://api.example.com/upload', {
      method: 'POST',
      body: 'not json',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('TypeError');
  });
});

describe('fetchResult empty / null 2xx bodies', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const json = { 'content-type': 'application/json' };
  const emptyBodyDescription = 'Response body was empty or could not be deserialized.';
  const verbs = [
    ['get', () => fetchResult.get<unknown>('https://api.example.com/x')],
    ['post', () => fetchResult.post<unknown>('https://api.example.com/x', {})],
    ['put', () => fetchResult.put<unknown>('https://api.example.com/x', {})],
    ['patch', () => fetchResult.patch<unknown>('https://api.example.com/x', {})],
    ['send', () => fetchResult.send<unknown>('https://api.example.com/x', { method: 'POST' })],
  ] as const;

  for (const [name, call] of verbs) {
    it(`${name}: JSON content-type with an empty body is NotFound (not a SyntaxError)`, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response('', { status: 200, headers: json }))),
      );
      const result = await call();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.type).toBe(ErrorType.NotFound);
        expect(result.errors[0]?.code).toBe('NotFound');
        expect(result.errors[0]?.description).toBe(emptyBodyDescription);
      }
    });

    it(`${name}: JSON literal null body is NotFound`, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response('null', { status: 200, headers: json }))),
      );
      const result = await call();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]?.type).toBe(ErrorType.NotFound);
    });

    it(`${name}: 204 with a JSON content-type stays a void success`, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(null, { status: 204, headers: json }))),
      );
      const result = await call();
      expect(result).toEqual({ ok: true, value: undefined });
    });

    it(`${name}: 205 stays a void success`, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(null, { status: 205, headers: json }))),
      );
      const result = await call();
      expect(result).toEqual({ ok: true, value: undefined });
    });
  }

  describe('delete accepts any 2xx without requiring a body', () => {
    const del = () => fetchResult.delete('https://api.example.com/x');
    const respond = (body: string | null, status = 200) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(body, { status, headers: json }))),
      );

    it.each([
      ['empty body', ''],
      ['literal null', 'null'],
      ['whitespace', ' \n'],
    ])('%s is a void success', async (_name, body) => {
      respond(body);
      expect(await del()).toEqual({ ok: true, value: undefined });
    });

    it.each([204, 205])('%i is a void success', async (status) => {
      respond(null, status);
      expect(await del()).toEqual({ ok: true, value: undefined });
    });

    it('a non-empty JSON body is still parsed', async () => {
      respond('{"deleted":3}');
      const result = await fetchResult.delete<{ deleted: number }>('https://api.example.com/x');
      expect(result).toEqual({ ok: true, value: { deleted: 3 } });
    });

    it('a malformed JSON body is still a failure', async () => {
      respond('{oops');
      const result = await del();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]?.type).toBe(ErrorType.Unexpected);
    });

    it('an error status is still a failure', async () => {
      respond(null, 404);
      const result = await del();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]?.type).toBe(ErrorType.NotFound);
    });
  });

  it('whitespace-only JSON body is NotFound', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('  \n', { status: 200, headers: json }))),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.type).toBe(ErrorType.NotFound);
  });

  it('malformed JSON body stays an Unexpected failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{oops', { status: 200, headers: json }))),
    );
    const result = await fetchResult.get<unknown>('https://api.example.com/x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.type).toBe(ErrorType.Unexpected);
  });

  it('empty body without a JSON content-type stays a void success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 200 }))),
    );
    const result = await fetchResult.post<unknown>('https://api.example.com/x', {});
    expect(result).toEqual({ ok: true, value: undefined });
  });
});
