import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ErrorType } from '../../src/errors/error-type.js';
import type { FetchResultInit } from '../../src/http/fetch-result.js';
import { fetchResult } from '../../src/http/fetch-result.js';
import { RequestBuilder } from '../../src/http/request-builder.js';
import type { Result } from '../../src/result/result.js';

const URL_ = 'https://api.example.com/resource';

type Call = (init: FetchResultInit) => Promise<Result<unknown>>;

const builder = (b: RequestBuilder, init: FetchResultInit): Promise<Result<unknown>> => {
  if (init.signal) b.signal(init.signal);
  if (init.timeout !== undefined) b.timeout(init.timeout);
  return b.send<unknown>();
};

const calls: Array<[string, Call]> = [
  ['get', (init) => fetchResult.get(URL_, init)],
  ['post', (init) => fetchResult.post(URL_, { a: 1 }, init)],
  ['put', (init) => fetchResult.put(URL_, { a: 1 }, init)],
  ['patch', (init) => fetchResult.patch(URL_, { a: 1 }, init)],
  ['delete', (init) => fetchResult.delete(URL_, init)],
  ['send', (init) => fetchResult.send(URL_, { method: 'POST', body: 'raw', ...init })],
  ['RequestBuilder.get', (init) => builder(RequestBuilder.get(URL_), init)],
  ['RequestBuilder.post(json)', (init) => builder(RequestBuilder.post(URL_).json({ a: 1 }), init)],
  ['RequestBuilder.put(body)', (init) => builder(RequestBuilder.put(URL_).body('raw'), init)],
  ['RequestBuilder.delete', (init) => builder(RequestBuilder.delete(URL_), init)],
];

/** fetch mock that never settles on its own and rejects with `signal.reason` on abort (like real fetch). */
const hangingFetch = () =>
  vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );

/** fetch mock whose headers arrive immediately but whose body stalls until the signal aborts. */
const stalledBodyFetch = (status: number) =>
  vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    });
    return Promise.resolve(
      new Response(body, { status, headers: { 'content-type': 'application/json' } }),
    );
  });

const jsonResponse = (status: number, json: unknown, contentType = 'application/json') =>
  new Response(JSON.stringify(json), { status, headers: { 'content-type': contentType } });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(calls)('%s — cancellation and timeout', (_name, call) => {
  it('rejects (does not return a Result) when the caller signal is already aborted', async () => {
    const fetchSpy = hangingFetch();
    vi.stubGlobal('fetch', fetchSpy);
    const controller = new AbortController();
    const reason = new Error('user cancelled');
    controller.abort(reason);
    await expect(call({ signal: controller.signal })).rejects.toBe(reason);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects with the abort reason when the caller aborts mid-flight', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const controller = new AbortController();
    const pending = call({ signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('caller abort wins over a configured timeout', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const controller = new AbortController();
    const pending = call({ signal: controller.signal, timeout: 1_000 });
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('returns an Http.Timeout Unexpected failure when the timeout elapses', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const result = await call({ timeout: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe('Http.Timeout');
      expect(result.errors[0]!.type).toBe(ErrorType.Unexpected);
      expect(result.errors[0]!.description).toContain('20 ms');
      expect(result.errors[0]!.metadata?.get('exceptionType')).toBe('DOMException');
    }
  });

  it('times out with a caller signal that is never aborted', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const result = await call({ signal: new AbortController().signal, timeout: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('Http.Timeout');
  });

  it('applies the default 30 s timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    let settled: Result<unknown> | undefined;
    void call({}).then((r) => {
      settled = r;
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled?.ok).toBe(false);
    if (settled && !settled.ok) expect(settled.errors[0]!.code).toBe('Http.Timeout');
  });

  it('timeout 0 disables the timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    const controller = new AbortController();
    let settled = false;
    const pending = call({ timeout: 0, signal: controller.signal }).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(settled).toBe(false);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('returns an Unexpected failure for an AbortError not caused by the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('aborted elsewhere', 'AbortError'))),
    );
    const result = await call({ signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.type).toBe(ErrorType.Unexpected);
      expect(result.errors[0]!.code).toBe('DOMException');
    }
  });

  it('returns an Unexpected failure coded with the exception name on network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );
    const result = await call({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.type).toBe(ErrorType.Unexpected);
      expect(result.errors[0]!.code).toBe('TypeError');
      expect(result.errors[0]!.description).toBe('fetch failed');
    }
  });

  it.each([-1, Number.NaN, 2 ** 31])('rejects with RangeError for timeout %s', async (timeout) => {
    const fetchSpy = hangingFetch();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(call({ timeout })).rejects.toBeInstanceOf(RangeError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts timeout Infinity (disabled)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, { ok: 1 }))),
    );
    const result = await call({ timeout: Number.POSITIVE_INFINITY });
    expect(result.ok).toBe(true);
  });

  it('passes its own signal to fetch and detaches from the caller signal afterwards', async () => {
    const fetchSpy = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(200, {})),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const result = await call({ signal: controller.signal });
    expect(result.ok).toBe(true);
    const passed = fetchSpy.mock.calls[0]![1]!.signal!;
    expect(passed).toBeInstanceOf(AbortSignal);
    expect(passed).not.toBe(controller.signal);
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    expect(passed.aborted).toBe(false);
  });
});

describe('timeout while reading the body', () => {
  it('returns Http.Timeout when a success body stalls', async () => {
    vi.stubGlobal('fetch', stalledBodyFetch(200));
    const result = await fetchResult.get(URL_, { timeout: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('Http.Timeout');
  });

  it('returns Http.Timeout when an error body stalls (not the status error)', async () => {
    vi.stubGlobal('fetch', stalledBodyFetch(400));
    const result = await fetchResult.get(URL_, { timeout: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('Http.Timeout');
  });

  it('rejects when the caller aborts while the body is being read', async () => {
    vi.stubGlobal('fetch', stalledBodyFetch(200));
    const controller = new AbortController();
    const pending = fetchResult.get(URL_, { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('fetchResult — header handling (HeadersInit)', () => {
  const methods = [
    ['post', fetchResult.post],
    ['put', fetchResult.put],
    ['patch', fetchResult.patch],
  ] as const;

  const capture = () => {
    const fetchSpy = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(200, {})),
    );
    vi.stubGlobal('fetch', fetchSpy);
    return () => new Headers(fetchSpy.mock.calls[0]![1]!.headers);
  };

  it.each(methods)('%s preserves headers given as a Headers instance', async (_m, fn) => {
    const sent = capture();
    const input = new Headers({ Authorization: 'Bearer t', 'X-Trace': '1' });
    await fn(URL_, { a: 1 }, { headers: input });
    const headers = sent();
    expect(headers.get('authorization')).toBe('Bearer t');
    expect(headers.get('x-trace')).toBe('1');
    expect(headers.get('content-type')).toBe('application/json');
    expect(input.has('content-type')).toBe(false); // caller's instance not mutated
  });

  it.each(methods)('%s preserves headers given as a tuple array', async (_m, fn) => {
    const sent = capture();
    await fn(URL_, { a: 1 }, { headers: [['X-Api-Key', 'k']] });
    const headers = sent();
    expect(headers.get('x-api-key')).toBe('k');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it.each(methods)('%s does not override a user-supplied Content-Type', async (_m, fn) => {
    const sent = capture();
    await fn(URL_, { a: 1 }, { headers: { 'content-type': 'application/vnd.api+json' } });
    expect(sent().get('content-type')).toBe('application/vnd.api+json');
  });

  it('serialization errors become an Unexpected failure instead of throwing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await fetchResult.post(URL_, { big: 1n });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.code).toBe('TypeError');
      expect(result.errors[0]!.type).toBe(ErrorType.Unexpected);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('fetchResult — error responses', () => {
  it('parses ProblemDetails `errors` into the failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            400,
            {
              title: 'Validation failed',
              errors: [
                { code: 'User.Email', description: 'Invalid email' },
                { code: 'User.Age', description: 'Too young', type: 'Forbidden' },
              ],
            },
            'application/problem+json',
          ),
        ),
      ),
    );
    const result = await fetchResult.post(URL_, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => [e.code, e.description, e.type])).toEqual([
        ['User.Email', 'Invalid email', ErrorType.Validation],
        ['User.Age', 'Too young', ErrorType.Forbidden],
      ]);
    }
  });

  it('parses validation-problem dictionaries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(422, { errors: { Name: ['Required'] } }, 'application/problem+json'),
        ),
      ),
    );
    const result = await fetchResult.get(URL_);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: 'Name',
        description: 'Required',
        type: ErrorType.Validation,
      });
    }
  });

  it('falls back to the status error when the JSON error body is unparseable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('{not json', {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    const result = await fetchResult.get(URL_);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ code: 'Http.503', type: ErrorType.Unexpected });
    }
  });

  it('maps 408 to Unexpected and 412 to Conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 408 }))),
    );
    const r408 = await fetchResult.get(URL_);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 412 }))),
    );
    const r412 = await fetchResult.get(URL_);
    expect(r408.ok || r408.errors[0]!.type).toBe(ErrorType.Unexpected);
    expect(r412.ok || r412.errors[0]!.type).toBe(ErrorType.Conflict);
  });
});

describe('fetchResult — real fetch against a local server', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/fast') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (req.url === '/slow-body') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"ok":');
        return; // never finishes the body
      }
      // '/hang': never responds
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('succeeds normally', async () => {
    const result = await fetchResult.get<{ ok: boolean }>(`${base}/fast`, { timeout: 1_000 });
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it('returns Http.Timeout when the server does not respond in time', async () => {
    const result = await fetchResult.get(`${base}/hang`, { timeout: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('Http.Timeout');
  });

  it('returns Http.Timeout when the body does not finish in time', async () => {
    const result = await fetchResult.get(`${base}/slow-body`, { timeout: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('Http.Timeout');
  });

  it('rejects when the caller aborts', async () => {
    const controller = new AbortController();
    const pending = fetchResult.get(`${base}/hang`, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects with AbortSignal.timeout() reason when the caller uses it (caller-owned signal)', async () => {
    const pending = fetchResult.get(`${base}/hang`, { signal: AbortSignal.timeout(20) });
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
