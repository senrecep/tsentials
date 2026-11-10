import { sha256, toBase64Url, utf8 } from '../idempotency/encoding.js';

/**
 * The validators of a resource (RFC 9110 section 8.8): `etag` is a full entity tag such as
 * `"abc"` or `W/"abc"`, `lastModified` is compared with second precision.
 */
export interface ResourceValidators {
  readonly etag?: string | undefined;
  readonly lastModified?: Date | undefined;
}

/** Codes of the problem+json responses of {@link checkIfMatch}. */
export const ConditionalErrorCodes = {
  PreconditionFailed: 'Http.PreconditionFailed',
  PreconditionRequired: 'Http.PreconditionRequired',
  InvalidIfMatch: 'Http.InvalidIfMatch',
} as const;

const OPAQUE_TAG = /^[\x21\x23-\x7E]*$/;
// One list element: optional `W/` (case-sensitive), a quoted run of etagc (commas included), OWS.
const ENTITY_TAG = /(W\/)?"[\x21\x23-\x7E\x80-\xFF]*"/y;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A strong entity tag (or weak with `weak: true`) of an opaque value such as a version number:
 * `formatETag(7)` is `"7"`. Throws `RangeError` when the value has a character not allowed in an
 * entity tag (a space, a quote, a control or non-ASCII character); use {@link computeETag} then.
 */
export function formatETag(
  value: string | number | bigint,
  options: { readonly weak?: boolean } = {},
): string {
  const tag = String(value);
  if (!OPAQUE_TAG.test(tag)) {
    throw new RangeError(`formatETag: ${JSON.stringify(tag)} is not a valid entity tag value`);
  }
  return `${options.weak === true ? 'W/' : ''}"${tag}"`;
}

/**
 * The entity tag of some content: the base64url SHA-256 (Web Crypto) of the bytes, or of the
 * UTF-8 bytes of a string. Strong by default; pass `weak: true` for a tag that only promises
 * semantic equivalence (for example a hash of serialized JSON).
 */
export async function computeETag(
  content: string | BufferSource,
  options: { readonly weak?: boolean } = {},
): Promise<string> {
  const bytes = typeof content === 'string' ? utf8(content) : content;
  return formatETag(toBase64Url(await sha256(bytes)), options);
}

/**
 * Parses an `If-Match` or `If-None-Match` header (RFC 9110 sections 13.1.1 and 13.1.2): `'*'`,
 * the list of entity tags as written (empty list elements are skipped), `[]` for a missing or
 * blank header, or `undefined` when the header is malformed (including `*` mixed with tags).
 */
export function parseETagList(header: string | null | undefined): '*' | string[] | undefined {
  const value = header?.trim() ?? '';
  if (value === '*') return '*';
  const tags: string[] = [];
  let i = 0;
  let expectTag = true;
  while (i < value.length) {
    const c = value[i];
    if (c === ' ' || c === '\t') {
      i++;
    } else if (c === ',') {
      expectTag = true;
      i++;
    } else {
      if (!expectTag) return undefined;
      ENTITY_TAG.lastIndex = i;
      const match = ENTITY_TAG.exec(value);
      if (match === null) return undefined;
      tags.push(match[0]);
      i = ENTITY_TAG.lastIndex;
      expectTag = false;
    }
  }
  return tags;
}

/**
 * Compares two entity tags (RFC 9110 section 8.8.3.2). Strong comparison: both strong with the
 * same opaque tag. Weak comparison: the same opaque tag, `W/` ignored.
 */
export function compareETags(a: string, b: string, comparison: 'strong' | 'weak'): boolean {
  const weakA = a.startsWith('W/');
  const weakB = b.startsWith('W/');
  if (comparison === 'strong' && (weakA || weakB)) return false;
  return (weakA ? a.slice(2) : a) === (weakB ? b.slice(2) : b);
}

/** Seconds since the epoch, never later than now (RFC 9110 section 8.8.2.1). */
function httpSeconds(date: Date): number {
  return Math.floor(Math.min(date.getTime(), Date.now()) / 1000);
}

/**
 * A `304 Not Modified` response for a `GET` or `HEAD` whose `If-None-Match` matches
 * `current.etag` (weak comparison; `*` matches) or, without `If-None-Match`, whose
 * `If-Modified-Since` is not older than `current.lastModified` (RFC 9110 section 13.2.2).
 * Otherwise `undefined`: send the full response. The 304 carries `ETag`, `Last-Modified` and
 * `headers` (pass the `Cache-Control`, `Vary` and `Content-Location` the 200 would have).
 * `Last-Modified` is sent with second precision and never later than now. A malformed
 * `If-None-Match` or unparseable `If-Modified-Since` never matches.
 */
export function notModified(
  request: Request,
  current: ResourceValidators,
  headers?: HeadersInit,
): Response | undefined {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return undefined;
  const { etag, lastModified } = current;
  const ifNoneMatch = request.headers.get('if-none-match');
  let matches: boolean;
  if (ifNoneMatch !== null && ifNoneMatch.trim() !== '') {
    const tags = parseETagList(ifNoneMatch) ?? [];
    matches =
      tags === '*' || (etag !== undefined && tags.some((tag) => compareETags(tag, etag, 'weak')));
  } else {
    const since = Date.parse(request.headers.get('if-modified-since') ?? '');
    matches = lastModified !== undefined && httpSeconds(lastModified) * 1000 <= since;
  }
  if (!matches) return undefined;
  const out = new Headers(headers);
  if (etag !== undefined) out.set('etag', etag);
  if (lastModified !== undefined) {
    out.set('last-modified', new Date(httpSeconds(lastModified) * 1000).toUTCString());
  }
  return new Response(null, { status: 304, headers: out });
}

function problem(status: number, title: string, detail: string, code: string): Response {
  return new Response(JSON.stringify({ title, status, detail, code }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/**
 * Checks the `If-Match` precondition of a `POST`, `PUT`, `PATCH` or `DELETE` against the current
 * resource (`null` or `undefined` when it does not exist). Returns the problem+json response to
 * send instead of running the write, or `undefined` to proceed:
 * - no (or a blank) `If-Match` → proceeds; with `required: true` → 428 `Http.PreconditionRequired`;
 * - malformed header, or `*` mixed with tags → 400 `Http.InvalidIfMatch`;
 * - `*` → proceeds when the resource exists; a tag list → proceeds when one tag equals
 *   `current.etag` by strong comparison (weak tags never match); otherwise 412
 *   `Http.PreconditionFailed`.
 *
 * Safe methods are not evaluated. The check is not atomic with the write: the resource can
 * change in between, so also pass the version as a concurrency token to the update.
 */
export function checkIfMatch(
  request: Request,
  current: ResourceValidators | null | undefined,
  options: { readonly required?: boolean } = {},
): Response | undefined {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return undefined;
  const header = request.headers.get('if-match');
  if (header === null || header.trim() === '') {
    return options.required === true
      ? problem(
          428,
          'Precondition Required',
          'This request requires an If-Match header with the current ETag of the resource.',
          ConditionalErrorCodes.PreconditionRequired,
        )
      : undefined;
  }
  const tags = parseETagList(header);
  if (tags === undefined) {
    return problem(
      400,
      'Invalid If-Match header',
      "The If-Match header must be '*' or a comma-separated list of entity tags.",
      ConditionalErrorCodes.InvalidIfMatch,
    );
  }
  const etag = current?.etag;
  const matches =
    current != null &&
    (tags === '*' || (etag !== undefined && tags.some((tag) => compareETags(tag, etag, 'strong'))));
  return matches
    ? undefined
    : problem(
        412,
        'Precondition Failed',
        'The resource has changed since it was read. Fetch it again and retry with its current ETag.',
        ConditionalErrorCodes.PreconditionFailed,
      );
}
