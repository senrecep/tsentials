import {
  ConditionalErrorCodes,
  checkIfMatch,
  compareETags,
  computeETag,
  formatETag,
  notModified,
  parseETagList,
} from '../../src/http/conditional.js';

const URL_ = 'https://api.example.com/items/1';
const req = (method: string, headers: Record<string, string> = {}) =>
  new Request(URL_, { method, headers });

describe('formatETag', () => {
  it('quotes an opaque value, weak on request', () => {
    expect(formatETag(7)).toBe('"7"');
    expect(formatETag(12n)).toBe('"12"');
    expect(formatETag('v1', { weak: true })).toBe('W/"v1"');
    expect(formatETag('')).toBe('""');
  });

  it('rejects characters not allowed in an entity tag', () => {
    expect(() => formatETag('a b')).toThrow(RangeError);
    expect(() => formatETag('a"b')).toThrow(RangeError);
    expect(() => formatETag('ü')).toThrow(RangeError);
  });
});

describe('computeETag', () => {
  it('is the base64url SHA-256 of the UTF-8 bytes', async () => {
    // SHA-256("abc") = ba7816bf...
    expect(await computeETag('abc')).toBe('"ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"');
    expect(await computeETag(new TextEncoder().encode('abc'))).toBe(await computeETag('abc'));
    expect(await computeETag('abc', { weak: true })).toBe(`W/${await computeETag('abc')}`);
  });
});

describe('parseETagList', () => {
  it('reads *, lists and missing headers', () => {
    expect(parseETagList(' * ')).toBe('*');
    expect(parseETagList(null)).toEqual([]);
    expect(parseETagList(undefined)).toEqual([]);
    expect(parseETagList('  ')).toEqual([]);
    expect(parseETagList('"a", W/"b",\t""')).toEqual(['"a"', 'W/"b"', '""']);
  });

  it('keeps commas inside a tag and skips empty list elements', () => {
    expect(parseETagList('"a,b", "c"')).toEqual(['"a,b"', '"c"']);
    expect(parseETagList(', "a" , , "b",')).toEqual(['"a"', '"b"']);
  });

  it('rejects malformed headers', () => {
    expect(parseETagList('abc')).toBeUndefined();
    expect(parseETagList('w/"a"')).toBeUndefined();
    expect(parseETagList('"a" "b"')).toBeUndefined();
    expect(parseETagList('"a')).toBeUndefined();
    expect(parseETagList('*, "a"')).toBeUndefined();
    expect(parseETagList('"a", *')).toBeUndefined();
  });
});

describe('compareETags', () => {
  it.each([
    ['W/"1"', 'W/"1"', false, true],
    ['W/"1"', 'W/"2"', false, false],
    ['W/"1"', '"1"', false, true],
    ['"1"', '"1"', true, true],
  ])('%s vs %s: strong %s, weak %s', (a, b, strong, weak) => {
    expect(compareETags(a, b, 'strong')).toBe(strong);
    expect(compareETags(a, b, 'weak')).toBe(weak);
  });
});

describe('notModified', () => {
  const lastModified = new Date('2024-01-02T03:04:05.678Z');

  it('returns 304 with validators and extra headers when If-None-Match matches weakly', async () => {
    const res = notModified(
      req('GET', { 'if-none-match': '"x", W/"1"' }),
      { etag: '"1"', lastModified },
      { 'cache-control': 'max-age=60', vary: 'Accept' },
    );
    expect(res?.status).toBe(304);
    expect(res?.body).toBeNull();
    expect(res?.headers.get('etag')).toBe('"1"');
    expect(res?.headers.get('last-modified')).toBe('Tue, 02 Jan 2024 03:04:05 GMT');
    expect(res?.headers.get('cache-control')).toBe('max-age=60');
    expect(res?.headers.get('vary')).toBe('Accept');
  });

  it('matches * even without an etag, and HEAD like GET', () => {
    expect(notModified(req('HEAD', { 'if-none-match': '*' }), {})?.status).toBe(304);
  });

  it('does not match another tag, a malformed header or a missing etag', () => {
    expect(notModified(req('GET', { 'if-none-match': '"2"' }), { etag: '"1"' })).toBeUndefined();
    expect(notModified(req('GET', { 'if-none-match': 'bad' }), { etag: '"1"' })).toBeUndefined();
    expect(notModified(req('GET', { 'if-none-match': '"1"' }), {})).toBeUndefined();
  });

  it('ignores If-Modified-Since when If-None-Match is present', () => {
    const request = req('GET', {
      'if-none-match': '"2"',
      'if-modified-since': 'Wed, 01 Jan 2025 00:00:00 GMT',
    });
    expect(notModified(request, { etag: '"1"', lastModified })).toBeUndefined();
  });

  it('uses If-Modified-Since with second precision without If-None-Match', () => {
    const at = (since: string) => req('GET', { 'if-modified-since': since });
    expect(notModified(at('Tue, 02 Jan 2024 03:04:05 GMT'), { lastModified })?.status).toBe(304);
    expect(notModified(at('Tue, 02 Jan 2024 03:04:04 GMT'), { lastModified })).toBeUndefined();
    expect(notModified(at('not a date'), { lastModified })).toBeUndefined();
    expect(notModified(at('Tue, 02 Jan 2024 03:04:05 GMT'), {})).toBeUndefined();
    expect(notModified(req('GET'), { lastModified })).toBeUndefined();
  });

  it('never sends a Last-Modified later than now', () => {
    const future = new Date(Date.now() + 86_400_000);
    const res = notModified(req('GET', { 'if-none-match': '*' }), { lastModified: future });
    const sent = Date.parse(res?.headers.get('last-modified') ?? '');
    expect(sent).toBeLessThanOrEqual(Date.now());
  });

  it('never answers 304 to an unsafe method', () => {
    expect(notModified(req('POST', { 'if-none-match': '*' }), { etag: '"1"' })).toBeUndefined();
  });
});

describe('checkIfMatch', () => {
  const problemOf = async (res: Response | undefined) => {
    expect(res?.headers.get('content-type')).toBe('application/problem+json');
    return res?.json() as Promise<{ status: number; title: string; code: string }>;
  };

  it('does not evaluate safe methods', () => {
    expect(checkIfMatch(req('GET', { 'if-match': '"2"' }), { etag: '"1"' })).toBeUndefined();
  });

  it('proceeds without a header unless required, then 428', async () => {
    expect(checkIfMatch(req('PUT'), { etag: '"1"' })).toBeUndefined();
    expect(checkIfMatch(req('PUT', { 'if-match': ' ' }), { etag: '"1"' })).toBeUndefined();
    const res = checkIfMatch(req('DELETE'), { etag: '"1"' }, { required: true });
    expect(res?.status).toBe(428);
    expect(await problemOf(res)).toMatchObject({
      status: 428,
      title: 'Precondition Required',
      code: ConditionalErrorCodes.PreconditionRequired,
    });
  });

  it('returns 400 for a malformed header', async () => {
    const res = checkIfMatch(req('PATCH', { 'if-match': '*, "1"' }), { etag: '"1"' });
    expect(res?.status).toBe(400);
    expect((await problemOf(res)).code).toBe(ConditionalErrorCodes.InvalidIfMatch);
  });

  it('proceeds when a tag matches strongly', () => {
    expect(checkIfMatch(req('patch', { 'if-match': '"0", "1"' }), { etag: '"1"' })).toBeUndefined();
  });

  it('returns 412 for a mismatch, a weak tag or a missing resource', async () => {
    const res = checkIfMatch(req('PUT', { 'if-match': '"2"' }), { etag: '"1"' });
    expect(res?.status).toBe(412);
    expect(await problemOf(res)).toMatchObject({
      status: 412,
      title: 'Precondition Failed',
      code: ConditionalErrorCodes.PreconditionFailed,
    });
    expect(checkIfMatch(req('PUT', { 'if-match': 'W/"1"' }), { etag: 'W/"1"' })?.status).toBe(412);
    expect(checkIfMatch(req('PUT', { 'if-match': '"1"' }), null)?.status).toBe(412);
    expect(checkIfMatch(req('PUT', { 'if-match': '"1"' }), {})?.status).toBe(412);
  });

  it('* proceeds for any existing resource, even without an etag', () => {
    expect(checkIfMatch(req('POST', { 'if-match': '*' }), {})).toBeUndefined();
    expect(checkIfMatch(req('POST', { 'if-match': '*' }), undefined)?.status).toBe(412);
  });
});
