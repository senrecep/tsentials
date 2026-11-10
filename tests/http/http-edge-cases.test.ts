import { ErrorType } from '../../src/errors/error-type.js';
import { fetchResult } from '../../src/http/fetch-result.js';
import { extractErrorDescription, problemDetailsToErrors } from '../../src/http/status-mapper.js';

const URL_ = 'https://api.example.com/resource';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** fetch mock that rejects with `thrown` once the caller's signal aborts, instead of the reason. */
const fetchRejectingWith = (thrown: unknown) =>
  vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(thrown), { once: true });
      }),
  );

describe('fetchResult caller abort with an error other than the reason', () => {
  it.each([
    ['AbortError', new DOMException('aborted', 'AbortError')],
    ['TimeoutError', { name: 'TimeoutError' }],
  ])('rethrows a %s', async (_name, thrown) => {
    vi.stubGlobal('fetch', fetchRejectingWith(thrown));
    const controller = new AbortController();
    const pending = fetchResult.get(URL_, { signal: controller.signal });
    controller.abort(new Error('reason'));
    await expect(pending).rejects.toBe(thrown);
  });

  it.each([
    ['a non-object', 'boom'],
    ['null', null],
    ['an object with another name', { name: 'TypeError' }],
  ])('returns an Unexpected failure for %s', async (_name, thrown) => {
    vi.stubGlobal('fetch', fetchRejectingWith(thrown));
    const controller = new AbortController();
    const pending = fetchResult.get(URL_, { signal: controller.signal });
    controller.abort(new Error('reason'));
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.type).toBe(ErrorType.Unexpected);
  });
});

describe('status mapper edge cases', () => {
  it('keeps an Unknown error type from a ProblemDetails errors entry', () => {
    const [error] = problemDetailsToErrors(500, {
      errors: [{ code: 'Some.Code', description: 'desc', type: 'Unknown' }],
    });
    expect(error?.type).toBe(ErrorType.Unknown);
  });

  it('extractErrorDescription returns undefined without a content-type header', async () => {
    expect(await extractErrorDescription(new Response(null, { status: 500 }))).toBeUndefined();
  });
});
