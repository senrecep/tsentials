import { RequestBuilder } from '../../src/http/request-builder.js';

describe('RequestBuilder static factories', () => {
  it('creates GET builder', () => {
    const builder = RequestBuilder.get('https://api.example.com/users');
    expect(builder).toBeInstanceOf(RequestBuilder);
  });

  it('creates POST builder', () => {
    const builder = RequestBuilder.post('https://api.example.com/users');
    expect(builder).toBeInstanceOf(RequestBuilder);
  });

  it('creates PUT builder', () => {
    const builder = RequestBuilder.put('https://api.example.com/users/1');
    expect(builder).toBeInstanceOf(RequestBuilder);
  });

  it('creates PATCH builder', () => {
    const builder = RequestBuilder.patch('https://api.example.com/users/1');
    expect(builder).toBeInstanceOf(RequestBuilder);
  });

  it('creates DELETE builder', () => {
    const builder = RequestBuilder.delete('https://api.example.com/users/1');
    expect(builder).toBeInstanceOf(RequestBuilder);
  });
});

describe('RequestBuilder fluent API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('chains headers fluently', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.get('https://api.example.com/users')
      .header('Authorization', 'Bearer token')
      .header('X-Request-ID', 'abc')
      .send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toEqual({
      Authorization: 'Bearer token',
      'X-Request-ID': 'abc',
    });
  });

  it('overwrites header with same name', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.get('https://api.example.com/users')
      .header('X-Key', 'first')
      .header('X-Key', 'second')
      .send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toEqual({ 'X-Key': 'second' });
  });

  it('appends query parameters', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.get('https://api.example.com/users')
      .query('page', '1')
      .query('limit', '10')
      .send<unknown>();

    const url = fetchSpy.mock.calls[0]![0] as URL;
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('appends duplicate query keys', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.get('https://api.example.com/users')
      .query('tag', 'a')
      .query('tag', 'b')
      .send<unknown>();

    const url = fetchSpy.mock.calls[0]![0] as URL;
    expect(url.searchParams.getAll('tag')).toEqual(['a', 'b']);
  });

  it('preserves existing query string and appends new params', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.get('https://api.example.com/users?sort=desc')
      .query('page', '2')
      .send<unknown>();

    const url = fetchSpy.mock.calls[0]![0] as URL;
    expect(url.searchParams.get('sort')).toBe('desc');
    expect(url.searchParams.get('page')).toBe('2');
  });

  it('sets JSON body and Content-Type header', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const body = { name: 'Alice', email: 'alice@example.com' };
    await RequestBuilder.post('https://api.example.com/users').json(body).send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify(body));
  });

  it('json() overwrites previous body', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.post('https://api.example.com/users')
      .body('old')
      .json({ name: 'Alice' })
      .send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ name: 'Alice' }));
  });

  it('body() sets raw body on init', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.get('https://api.example.com/upload').body('raw text').send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe('raw text');
  });

  it('overwrites Content-Type when json() is called after header()', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.post('https://api.example.com/users')
      .header('Content-Type', 'text/plain')
      .json({ name: 'Alice' })
      .send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('accepts URL object', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.get(new URL('https://api.example.com/users')).send<unknown>();

    const url = fetchSpy.mock.calls[0]![0] as URL;
    expect(url.href).toBe('https://api.example.com/users');
  });

  it('sends GET request correctly', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.get('https://api.example.com/users').send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('GET');
  });

  it('sends POST request correctly', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.post('https://api.example.com/users')
      .json({ name: 'Alice' })
      .send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
  });

  it('sends PUT request correctly', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.put('https://api.example.com/users/1')
      .json({ name: 'Bob' })
      .send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('PUT');
  });

  it('sends PATCH request correctly', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.patch('https://api.example.com/users/1')
      .json({ name: 'Charlie' })
      .send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('PATCH');
  });

  it('sends DELETE request correctly in send()', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.delete('https://api.example.com/users/1').send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('DELETE');
  });

  it('parses JSON body before passing to fetchResult.post', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.post('https://api.example.com/users')
      .json({ nested: { value: 1 } })
      .send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ nested: { value: 1 } });
  });

  it('handles string URL without protocol by using localhost base', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.get('/api/users').send<unknown>();

    const url = fetchSpy.mock.calls[0]![0] as URL;
    expect(url.href).toBe('http://localhost/api/users');
  });

  it('handles failure response from send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 404 }))),
    );

    const result = await RequestBuilder.get('https://api.example.com/missing').send<unknown>();
    expect(result.ok).toBe(false);
  });

  it('returns typed result on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 1, name: 'Alice' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );

    const result = await RequestBuilder.get('https://api.example.com/users/1').send<{
      id: number;
      name: string;
    }>();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(1);
      expect(result.value.name).toBe('Alice');
    }
  });

  it('sends POST without body (null body fallback)', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.post('https://api.example.com/users').send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
  });

  it('sends PUT without body (null body fallback)', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.put('https://api.example.com/users/1').send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('PUT');
  });

  it('sends PATCH without body (null body fallback)', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.patch('https://api.example.com/users/1').send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('PATCH');
  });

  it('sends a raw non-JSON body on POST without throwing', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await RequestBuilder.post('https://api.example.com/upload')
      .header('Content-Type', 'text/plain')
      .body('not json at all')
      .send<unknown>();

    expect(result.ok).toBe(true);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe('not json at all');
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain' });
  });

  it('sends a raw non-JSON body on PUT without throwing', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await RequestBuilder.put('https://api.example.com/upload')
      .body('plain text body')
      .send<unknown>();

    expect(result.ok).toBe(true);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe('plain text body');
  });

  it('sends a raw non-JSON body on PATCH without throwing', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await RequestBuilder.patch('https://api.example.com/upload')
      .body('plain text body')
      .send<unknown>();

    expect(result.ok).toBe(true);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe('plain text body');
  });

  it('does not double-encode JSON bodies (no parse/stringify round-trip)', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.post('https://api.example.com/users')
      .json({ name: 'Alice' })
      .send<unknown>();

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ name: 'Alice' }));
  });

  it('falls back to GET for unknown HTTP method (default branch)', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    // Bypass private constructor to trigger the default case in send()
    const builder = Reflect.construct(RequestBuilder, [
      'OPTIONS',
      'https://api.example.com/test',
    ]) as RequestBuilder;
    await builder.send<unknown>();

    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
