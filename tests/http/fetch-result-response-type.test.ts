import { ErrorType } from '../../src/errors/error-type.js';
import { fetchResult } from '../../src/http/fetch-result.js';
import { RequestBuilder } from '../../src/http/request-builder.js';
import { HttpErrorMetadataKeys } from '../../src/http/response-metadata.js';

const URL_ = 'https://api.example.com/export';

const respond = (response: Response) => {
  const spy = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(response),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
};

/** Headers arrive at once; the body stalls until the request signal aborts. */
const stalledBody = (status: number) =>
  vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    });
    return Promise.resolve(new Response(body, { status, headers: { 'content-type': 'text/csv' } }));
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("responseType: 'text'", () => {
  it('returns a non-JSON 2xx body as a string', async () => {
    respond(new Response('a,b\n1,2', { status: 200, headers: { 'content-type': 'text/csv' } }));
    const result = await fetchResult.get<string>(URL_, { responseType: 'text' });
    expect(result).toEqual({ ok: true, value: 'a,b\n1,2' });
  });

  it('returns a JSON body as raw text without parsing it', async () => {
    respond(
      new Response('{"a":', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const result = await fetchResult.get<string>(URL_, { responseType: 'text' });
    expect(result).toEqual({ ok: true, value: '{"a":' });
  });

  it('returns an empty string for an empty body or 204', async () => {
    respond(new Response('', { status: 200 }));
    expect(await fetchResult.get<string>(URL_, { responseType: 'text' })).toEqual({
      ok: true,
      value: '',
    });
    respond(new Response(null, { status: 204 }));
    expect(await fetchResult.delete<string>(URL_, { responseType: 'text' })).toEqual({
      ok: true,
      value: '',
    });
  });

  it('does not pass responseType to fetch', async () => {
    const spy = respond(new Response('x', { status: 200 }));
    await fetchResult.post<string>(URL_, { a: 1 }, { responseType: 'text' });
    expect(spy.mock.calls[0]![1]).not.toHaveProperty('responseType');
  });

  it('maps a non-2xx response through the problem parsing, as for JSON', async () => {
    respond(
      new Response(JSON.stringify({ title: 'Bad', errors: { name: ['Required'] } }), {
        status: 400,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );
    const text = await fetchResult.get<string>(URL_, { responseType: 'text' });
    respond(
      new Response(JSON.stringify({ title: 'Bad', errors: { name: ['Required'] } }), {
        status: 400,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );
    const json = await fetchResult.get<string>(URL_);
    expect(text).toEqual(json);
    if (!text.ok) {
      expect(text.errors[0]!.type).toBe(ErrorType.Validation);
      expect(text.errors[0]!.metadata?.get(HttpErrorMetadataKeys.HttpStatus)).toBe(400);
    }
  });

  it('turns a body read error into an Unexpected failure with the status', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError('connection reset'));
      },
    });
    respond(new Response(body, { status: 200 }));
    const result = await fetchResult.get<string>(URL_, { responseType: 'text' });
    if (result.ok) throw new Error('expected failure');
    expect(result.errors[0]!.type).toBe(ErrorType.Unexpected);
    expect(result.errors[0]!.code).toBe('TypeError');
    expect(result.errors[0]!.metadata?.get(HttpErrorMetadataKeys.HttpStatus)).toBe(200);
  });

  it('returns Http.Timeout when the body stalls', async () => {
    vi.stubGlobal('fetch', stalledBody(200));
    const result = await fetchResult.get<string>(URL_, { responseType: 'text', timeout: 20 });
    if (result.ok) throw new Error('expected failure');
    expect(result.errors[0]!.code).toBe('Http.Timeout');
    expect(result.errors[0]!.metadata?.get(HttpErrorMetadataKeys.HttpStatus)).toBe(200);
  });

  it('rejects when the caller aborts while the body is being read', async () => {
    vi.stubGlobal('fetch', stalledBody(200));
    const controller = new AbortController();
    const pending = fetchResult.get<string>(URL_, {
      responseType: 'text',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe("responseType: 'blob' and 'arrayBuffer'", () => {
  it('returns the raw bytes as a Blob', async () => {
    respond(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
    const result = await fetchResult.get<Blob>(URL_, { responseType: 'blob' });
    if (!result.ok) throw new Error('expected success');
    expect(result.value).toBeInstanceOf(Blob);
    expect(result.value.type).toBe('application/octet-stream');
    expect([...new Uint8Array(await result.value.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('returns the raw bytes as an ArrayBuffer', async () => {
    respond(new Response(new Uint8Array([4, 5]), { status: 200 }));
    const result = await fetchResult.send<ArrayBuffer>(URL_, {
      method: 'GET',
      responseType: 'arrayBuffer',
    });
    if (!result.ok) throw new Error('expected success');
    expect(result.value).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(result.value)]).toEqual([4, 5]);
  });
});

describe('RequestBuilder.responseType', () => {
  it('reads the body as text', async () => {
    respond(new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const result = await RequestBuilder.get(URL_).responseType('text').send<string>();
    expect(result).toEqual({ ok: true, value: 'hello' });
  });

  it('reads the body as bytes with a JSON request body', async () => {
    const spy = respond(new Response(new Uint8Array([9]), { status: 201 }));
    const result = await RequestBuilder.post(URL_)
      .json({ a: 1 })
      .responseType('arrayBuffer')
      .send<ArrayBuffer>();
    if (!result.ok) throw new Error('expected success');
    expect([...new Uint8Array(result.value)]).toEqual([9]);
    expect(spy.mock.calls[0]![1]?.body).toBe('{"a":1}');
  });

  it("defaults to 'json': a non-JSON body stays a void success", async () => {
    respond(new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } }));
    expect(await RequestBuilder.get(URL_).send<string>()).toEqual({ ok: true, value: undefined });
  });
});
