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
    expect(init.headers).toEqual([
      ['Authorization', 'Bearer token'],
      ['X-Request-ID', 'abc'],
    ]);
  });

  it('adds another value for a header with the same name', async () => {
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
    expect(init.headers).toEqual([
      ['X-Key', 'first'],
      ['X-Key', 'second'],
    ]);
    expect(new Headers(init.headers).get('x-key')).toBe('first, second');
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

    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
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

    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
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

    expect(fetchSpy.mock.calls[0]![0]).toBe('https://api.example.com/users?sort=desc&page=2');
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
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
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

  describe('body() after json()', () => {
    const sentHeaders = async (build: (b: RequestBuilder) => RequestBuilder): Promise<Headers> => {
      const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
      vi.stubGlobal('fetch', fetchSpy);
      await build(RequestBuilder.post('https://api.example.com/upload')).send<void>();
      const init = fetchSpy.mock.calls[0]![1] as RequestInit;
      expect(init.body).toBe('raw');
      return new Headers(init.headers);
    };

    it('removes the Content-Type that json() added', async () => {
      const headers = await sentHeaders((b) => b.json({ a: 1 }).body('raw'));
      expect(headers.has('content-type')).toBe(false);
    });

    it('keeps a Content-Type set explicitly after json()', async () => {
      const headers = await sentHeaders((b) =>
        b.json({ a: 1 }).header('content-type', 'text/csv').body('raw'),
      );
      expect(headers.get('content-type')).toBe('text/csv');
    });

    it('keeps a Content-Type set explicitly before body() without json()', async () => {
      const headers = await sentHeaders((b) => b.header('Content-Type', 'text/plain').body('raw'));
      expect(headers.get('content-type')).toBe('text/plain');
    });

    it('keeps other headers', async () => {
      const headers = await sentHeaders((b) => b.header('X-Trace', '1').json({ a: 1 }).body('raw'));
      expect(headers.get('x-trace')).toBe('1');
      expect(headers.has('content-type')).toBe(false);
    });
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
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    let count = 0;
    headers.forEach(() => {
      count++;
    });
    expect(count).toBe(1);
  });

  it('accepts URL object', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.get(new URL('https://api.example.com/users')).send<unknown>();

    expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://api.example.com/users');
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

  it('keeps a relative URL relative (no localhost base)', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await RequestBuilder.get('/api/users').send<unknown>();

    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/users');
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
    expect(init.headers).toEqual([['Content-Type', 'text/plain']]);
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

describe('RequestBuilder — URL, query, headers, signal, timeout', () => {
  const capture = () => {
    const fetchSpy = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    return {
      url: () => fetchSpy.mock.calls[0]![0],
      init: () => fetchSpy.mock.calls[0]![1]!,
    };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps a relative URL relative when appending query params', async () => {
    const sent = capture();
    await RequestBuilder.get('/api/users').query('page', 1).send<unknown>();
    expect(sent.url()).toBe('/api/users?page=1');
  });

  it('keeps relative paths without a leading slash relative', async () => {
    const sent = capture();
    await RequestBuilder.get('users?active=true').query('page', 2).send<unknown>();
    expect(sent.url()).toBe('users?active=true&page=2');
  });

  it('inserts query params before the hash', async () => {
    const sent = capture();
    await RequestBuilder.get('https://api.example.com/docs#section')
      .query('q', 'a b')
      .send<unknown>();
    expect(sent.url()).toBe('https://api.example.com/docs?q=a+b#section');
  });

  it('does not re-encode an existing query string', async () => {
    const sent = capture();
    await RequestBuilder.get('https://api.example.com/s?filter=a%2Cb&x=%20')
      .query('page', '1')
      .send<unknown>();
    expect(sent.url()).toBe('https://api.example.com/s?filter=a%2Cb&x=%20&page=1');
  });

  it('does not add a separator after a trailing ? or &', async () => {
    const sent = capture();
    await RequestBuilder.get('/a?').query('x', '1').send<unknown>();
    expect(sent.url()).toBe('/a?x=1');
    const sent2 = capture();
    await RequestBuilder.get('/a?y=2&').query('x', '1').send<unknown>();
    expect(sent2.url()).toBe('/a?y=2&x=1');
  });

  it('sends the URL unchanged when there are no query params', async () => {
    const sent = capture();
    await RequestBuilder.get('/api/users?x=1#h').send<unknown>();
    expect(sent.url()).toBe('/api/users?x=1#h');
  });

  it('does not mutate a URL input', async () => {
    const sent = capture();
    const input = new URL('https://api.example.com/users');
    await RequestBuilder.get(input).query('page', '1').send<unknown>();
    expect(input.href).toBe('https://api.example.com/users');
    expect(sent.url()).toBe('https://api.example.com/users?page=1');
  });

  it('query(record) appends entries and skips null/undefined', async () => {
    const sent = capture();
    await RequestBuilder.get('/search')
      .query({ q: 'ts', page: 2, exact: false, empty: '', skipNull: null, skipUndef: undefined })
      .send<unknown>();
    expect(sent.url()).toBe('/search?q=ts&page=2&exact=false&empty=');
  });

  it('query(name, value) stringifies numbers and booleans', async () => {
    const sent = capture();
    await RequestBuilder.get('/x').query('n', 0).query('b', true).send<unknown>();
    expect(sent.url()).toBe('/x?n=0&b=true');
  });

  it('headers(record) sets several headers', async () => {
    const sent = capture();
    await RequestBuilder.get('/x').headers({ 'X-A': '1', 'X-B': '2' }).send<unknown>();
    expect(sent.init().headers).toEqual([
      ['X-A', '1'],
      ['X-B', '2'],
    ]);
  });

  it('header() appends to an existing header case-insensitively', async () => {
    const sent = capture();
    await RequestBuilder.get('/x')
      .header('accept', 'text/plain')
      .headers({ Accept: 'application/json' })
      .send<unknown>();
    expect(new Headers(sent.init().headers).get('Accept')).toBe('text/plain, application/json');
  });

  it('Content-Type is single-valued: a later one replaces the earlier one', async () => {
    const sent = capture();
    await RequestBuilder.post('/x')
      .header('content-type', 'text/plain')
      .header('Content-Type', 'text/csv')
      .body('a,b')
      .send<unknown>();
    expect(sent.init().headers).toEqual([['Content-Type', 'text/csv']]);
  });

  it('the builder can be sent twice without sharing header state', async () => {
    const fetchSpy = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const builder = RequestBuilder.get('/x').header('X-A', '1');
    await builder.send<unknown>();
    (fetchSpy.mock.calls[0]![1]!.headers as [string, string][]).push(['X-Injected', 'y']);
    await builder.send<unknown>();
    expect(fetchSpy.mock.calls[1]![1]!.headers).toEqual([['X-A', '1']]);
  });

  it('json() replaces a lowercase content-type set earlier', async () => {
    const sent = capture();
    await RequestBuilder.post('/x').header('content-type', 'text/plain').json({}).send<unknown>();
    const headers = new Headers(sent.init().headers);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('signal() forwards cancellation: aborting rejects send()', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      ),
    );
    const controller = new AbortController();
    const pending = RequestBuilder.get('/x').signal(controller.signal).send<unknown>();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('timeout() forwards the timeout: elapsing yields Http.Timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      ),
    );
    const result = await RequestBuilder.post('/x').json({}).timeout(20).send<unknown>();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('Http.Timeout');
  });

  it('timeout() validation errors reject send()', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(RequestBuilder.get('/x').timeout(-5).send<unknown>()).rejects.toBeInstanceOf(
      RangeError,
    );
  });
});

describe('RequestBuilder.send empty / null 2xx bodies', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const json = { 'content-type': 'application/json' };
  const builders = [
    ['GET', () => RequestBuilder.get('https://api.example.com/x')],
    ['POST json', () => RequestBuilder.post('https://api.example.com/x').json({ a: 1 })],
    ['POST raw', () => RequestBuilder.post('https://api.example.com/x').body('raw')],
    ['PUT', () => RequestBuilder.put('https://api.example.com/x').json({ a: 1 })],
    ['PATCH', () => RequestBuilder.patch('https://api.example.com/x').json({ a: 1 })],
    ['DELETE', () => RequestBuilder.delete('https://api.example.com/x')],
  ] as const;

  for (const [name, build] of builders) {
    it(`${name}: empty JSON body is NotFound`, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response('', { status: 200, headers: json }))),
      );
      const result = await build().send<unknown>();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]?.type).toBe('NotFound');
    });

    it(`${name}: 204 is a void success`, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(null, { status: 204, headers: json }))),
      );
      const result = await build().send<void>();
      expect(result).toEqual({ ok: true, value: undefined });
    });
  }
});
