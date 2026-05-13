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
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice' }),
      }),
    );
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
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/user',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'secret' },
      }),
    );
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
